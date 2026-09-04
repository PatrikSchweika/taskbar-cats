/**
 * Keeping the Windows app up to date.
 *
 * The GNOME backend has no counterpart to this: an extension is updated by the
 * shell, or by extensions.gnome.org, and code that reached around either would
 * be both unwelcome and useless — the shell caches ES modules, so a replaced
 * extension does not take effect until the session restarts anyway. The
 * Windows app is a normal desktop application that nothing else will update,
 * so it updates itself.
 *
 * electron-updater does the actual work: it reads latest.yml from the GitHub
 * release, downloads the installer and hands off to it. Everything here is the
 * decisions around that — whether this copy of the app can be updated at all,
 * when to look, and what the user is told — and none of it imports electron or
 * electron-updater, so it can be tested without either.
 */

/** How often a running app looks for a new release. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdateSupport =
	| { supported: true }
	| { supported: false; reason: string };

/** What has to be known about this copy of the app to decide if it can update. */
export interface InstallProbe {
	platform: string;
	/** The architecture of this *build*, not of the machine running it. */
	arch: string;
	/** False under `npm run win:dev`, where the code comes from the checkout. */
	packaged: boolean;
	/** The directory the executable sits in. */
	installDir: string;
	/** The names of the files beside the executable. */
	siblings: () => string[];
}

/**
 * What the NSIS installer leaves behind and the portable zip does not.
 *
 * Matching the shape rather than reconstructing electron-builder's exact name
 * for it — productName, sanitised for the filesystem — means renaming the
 * product cannot quietly turn updates off.
 */
const UNINSTALLER = /^Uninstall .+\.exe$/i;

/**
 * The only architecture a release describes.
 *
 * Windows gets one channel file per release. electron-builder gives channel
 * files an architecture suffix on Linux only, so on Windows both builds would
 * write the same `latest.yml` and only one of them can be in it — and the one
 * that is, is x64, the architecture every release is guaranteed to contain.
 * The ARM64 build therefore does not update itself, rather than quietly
 * replacing itself with the emulated x64 one.
 */
const UPDATABLE_ARCH = "x64";

/**
 * Whether this copy of the app can update itself.
 *
 * The interesting case is the portable zip. It is the same `win-unpacked`
 * directory the installer wraps, so it carries the same `app-update.yml` and
 * electron-updater would happily download an installer for it — which would
 * install a *second* copy under %LOCALAPPDATA% while the user carried on
 * running the old one from wherever they unzipped it.
 *
 * The uninstaller is what distinguishes them: the NSIS installer writes one
 * beside the executable, and nothing puts one in the zip.
 */
export function updateSupport(probe: InstallProbe): UpdateSupport {
	if (probe.platform !== "win32")
		return {
			supported: false,
			reason: "Only the Windows build updates itself.",
		};
	// Before the architecture, so that a developer on an ARM64 machine is told
	// the true reason rather than one that would only apply to a release. Also
	// before anything reads the disk: under `win:dev` there is no install
	// directory to read.
	if (!probe.packaged)
		return {
			supported: false,
			reason: "This is a development build — update it with git pull.",
		};
	if (probe.arch !== UPDATABLE_ARCH)
		return {
			supported: false,
			reason:
				"The ARM64 build does not update itself, because a release only " +
				"describes the x64 one. Download a new release to update, or " +
				"install the x64 build, which Windows runs under emulation.",
		};

	let installed = false;
	try {
		installed = probe.siblings().some((name) => UNINSTALLER.test(name));
	} catch {
		// Whatever went wrong, it is not worth failing startup over something
		// this peripheral. No updates is the safe answer.
		installed = false;
	}
	if (!installed)
		return {
			supported: false,
			reason:
				"This copy was unzipped rather than installed, so it cannot update " +
				"itself. Download the installer to get updates automatically.",
		};
	return { supported: true };
}

/** The electron-updater events this uses, and what they carry. */
export interface UpdaterEvents {
	"update-available": { version: string };
	"update-not-available": { version: string };
	"update-downloaded": { version: string };
	error: Error;
}

/** The part of electron-updater's `autoUpdater` this needs. */
export interface UpdaterPort {
	autoDownload: boolean;
	autoInstallOnAppQuit: boolean;
	on<K extends keyof UpdaterEvents>(
		event: K,
		listener: (payload: UpdaterEvents[K]) => void,
	): void;
	checkForUpdates(): Promise<unknown>;
	quitAndInstall(silent: boolean, forceRunAfter: boolean): void;
}

/** Everything user-facing, so this module needs no dialogs of its own. */
export interface UpdaterUi {
	/** Ask whether to restart now. True installs immediately. */
	confirmRestart(version: string): Promise<boolean>;
	/** Tell the user something they are waiting to hear. */
	report(message: string): void;
	log(message: string): void;
}

export interface UpdaterOptions {
	port: UpdaterPort;
	ui: UpdaterUi;
	support: UpdateSupport;
	intervalMs?: number;
}

/**
 * Checks for updates on a timer, and on demand from the tray.
 *
 * A check is either something the user asked for or something the app did on
 * its own, and that decides how loud the outcome is: nobody wants a dialog
 * every six hours saying they are already up to date, and nobody wants their
 * explicit "check for updates" to do nothing visible.
 */
export class Updater {
	private readonly _port: UpdaterPort;
	private readonly _ui: UpdaterUi;
	private readonly _support: UpdateSupport;
	private readonly _intervalMs: number;

	private _timer: ReturnType<typeof setInterval> | null = null;
	/** Whether the check now in flight was asked for by the user. */
	private _interactive = false;
	private _checking = false;
	/** Everything started and not awaited, so it can be waited on. See _track. */
	private _pending: Promise<unknown> = Promise.resolve();

	/**
	 * Wiring the port happens here rather than in `start`, so that a check the
	 * user asks for from the tray behaves the same whether or not the periodic
	 * checks were ever started.
	 */
	constructor(options: UpdaterOptions) {
		this._port = options.port;
		this._ui = options.ui;
		this._support = options.support;
		this._intervalMs = options.intervalMs ?? CHECK_INTERVAL_MS;

		// Download without asking: the installer is a few tens of megabytes and
		// the user is not waiting on it. Installing on quit is the fallback for
		// someone who declines the restart — without it, clicking Later means
		// never.
		this._port.autoDownload = true;
		this._port.autoInstallOnAppQuit = true;

		this._port.on("update-available", (info) =>
			this._ui.log(`downloading ${info.version}`),
		);
		this._port.on("update-not-available", (info) => {
			if (this._interactive)
				this._ui.report(`Ubuntu Cats ${info.version} is the latest version.`);
		});
		this._port.on("error", (error) => this._fail(error));
		this._port.on("update-downloaded", (info) =>
			this._track(this._offerRestart(info.version)),
		);
	}

	/** Begin checking, unless this copy of the app cannot be updated. */
	start(): void {
		if (!this._support.supported) {
			this._ui.log(`updates are off: ${this._support.reason}`);
			return;
		}

		this._track(this.checkNow({ interactive: false }));
		this._timer = setInterval(
			() => this._track(this.checkNow({ interactive: false })),
			this._intervalMs,
		);
		// The tray is what keeps this app alive, not this timer. Left referenced
		// it would also hold a test runner open for six hours.
		this._timer.unref?.();
	}

	stop(): void {
		if (this._timer) clearInterval(this._timer);
		this._timer = null;
	}

	/**
	 * Look for an update now. Interactive by default, because the only caller
	 * that is not is the timer inside this class.
	 */
	async checkNow({ interactive = true }: { interactive?: boolean } = {}) {
		if (!this._support.supported) {
			if (interactive) this._ui.report(this._support.reason);
			return;
		}
		// electron-updater guards concurrent checks itself, but it does not know
		// which of them the user is waiting on. Without this, a timer firing
		// mid-check would flip `_interactive` and the answer to someone's menu
		// click would arrive as silence — or worse, a dialog nobody asked for.
		if (this._checking) return;

		this._checking = true;
		this._interactive = interactive;
		try {
			await this._port.checkForUpdates();
		} catch (error) {
			this._fail(error);
		} finally {
			this._checking = false;
		}
	}

	/** Resolves once everything this updater has started has finished. */
	settled(): Promise<unknown> {
		return this._pending;
	}

	/**
	 * Fold a piece of work into what `settled` waits for.
	 *
	 * Checks are started and not awaited — by a timer, or by a menu click — so
	 * without this there would be no way to know when one had finished, either
	 * to test it or to shut down cleanly.
	 */
	private _track(work: Promise<unknown>): void {
		this._pending = this._pending.then(() => work).catch(() => undefined);
	}

	private async _offerRestart(version: string): Promise<void> {
		if (await this._ui.confirmRestart(version))
			// Silent, and relaunched afterwards: the cats disappearing until the
			// user found the Start menu again would read as a crash.
			this._port.quitAndInstall(true, true);
	}

	/**
	 * A failed check is normal — a laptop wakes up on a captive portal — so it
	 * is only worth a dialog if someone is waiting for the answer.
	 */
	private _fail(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this._ui.log(`update check failed: ${message}`);
		if (this._interactive)
			this._ui.report(`Could not check for updates.\n\n${message}`);
	}
}

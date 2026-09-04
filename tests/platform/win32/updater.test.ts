import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, describe, it, mock } from "node:test";

import {
	Updater,
	type UpdaterEvents,
	type UpdaterPort,
	updateSupport,
} from "../../../src/platform/win32/updater.ts";

/**
 * A stand-in for electron-updater's `autoUpdater`.
 *
 * This is a boundary that cannot be exercised in a unit test: the real one
 * talks to GitHub and hands off to an NSIS installer. What can be checked is
 * everything on this side of it — when a check is made, what the user is told,
 * and whether the install actually gets triggered.
 */
class FakePort implements UpdaterPort {
	autoDownload = false;
	autoInstallOnAppQuit = false;
	checks = 0;
	installs: Array<{ silent: boolean; forceRunAfter: boolean }> = [];
	/** Set to reject the next check, standing in for a network failure. */
	failWith: Error | null = null;

	private _listeners = new Map<string, Array<(payload: never) => void>>();

	on<K extends keyof UpdaterEvents>(
		event: K,
		listener: (payload: UpdaterEvents[K]) => void,
	): void {
		const existing = this._listeners.get(event) ?? [];
		existing.push(listener as (payload: never) => void);
		this._listeners.set(event, existing);
	}

	async checkForUpdates(): Promise<unknown> {
		this.checks++;
		if (this.failWith) throw this.failWith;
		return null;
	}

	quitAndInstall(silent: boolean, forceRunAfter: boolean): void {
		this.installs.push({ silent, forceRunAfter });
	}

	/** Fire an event the way electron-updater would. */
	emit<K extends keyof UpdaterEvents>(
		event: K,
		payload: UpdaterEvents[K],
	): void {
		for (const listener of this._listeners.get(event) ?? [])
			(listener as (p: UpdaterEvents[K]) => void)(payload);
	}
}

class FakeUi {
	reports: string[] = [];
	logs: string[] = [];
	prompts: string[] = [];
	/** What the user clicks in the restart prompt. */
	restartAnswer = true;

	report(message: string): void {
		this.reports.push(message);
	}

	log(message: string): void {
		this.logs.push(message);
	}

	async confirmRestart(version: string): Promise<boolean> {
		this.prompts.push(version);
		return this.restartAnswer;
	}
}

const INSTALL_DIR = join(
	"C:",
	"Users",
	"sam",
	"AppData",
	"Local",
	"Programs",
	"Ubuntu Cats",
);

/** An install that looks like the NSIS installer made it. */
function installedProbe(overrides: Record<string, unknown> = {}) {
	return {
		platform: "win32",
		arch: "x64",
		packaged: true,
		installDir: INSTALL_DIR,
		siblings: () => [
			"Ubuntu Cats.exe",
			"Uninstall Ubuntu Cats.exe",
			"resources",
			"locales",
		],
		...overrides,
	};
}

describe("updateSupport", () => {
	it("accepts an app the NSIS installer put there", () => {
		assert.equal(updateSupport(installedProbe()).supported, true);
	});

	it("refuses a copy that was unzipped rather than installed", () => {
		// The portable zip is the same win-unpacked directory, so it carries
		// app-update.yml too. Updating it would run an installer and leave the
		// user with a second copy in a different place, still running the old
		// one. The uninstaller beside the executable is what tells them apart.
		const support = updateSupport(
			installedProbe({
				siblings: () => ["Ubuntu Cats.exe", "resources", "locales"],
			}),
		);
		assert.equal(support.supported, false);
		assert.match(support.supported ? "" : support.reason, /zip|unzipped/i);
	});

	it("recognises the uninstaller whatever the product is called", () => {
		// electron-builder names it after productName, sanitised for the
		// filesystem. Matching the shape rather than reproducing that rule here
		// means a rename cannot quietly turn updates off.
		const support = updateSupport(
			installedProbe({ siblings: () => ["Uninstall Taskbar Cats 2.exe"] }),
		);
		assert.equal(support.supported, true);
	});

	it("treats an unreadable install directory as not updatable", () => {
		// Better than crashing on startup over something this peripheral.
		const support = updateSupport(
			installedProbe({
				siblings: () => {
					throw new Error("EPERM");
				},
			}),
		);
		assert.equal(support.supported, false);
	});

	it("refuses an unpackaged development build", () => {
		const support = updateSupport(installedProbe({ packaged: false }));
		assert.equal(support.supported, false);
		assert.match(support.supported ? "" : support.reason, /development/i);
	});

	it("refuses the ARM64 build, which no release describes", () => {
		// Windows gets one latest.yml for the whole platform, and it names the
		// x64 installer. An ARM64 copy that checked it would quietly replace
		// itself with the emulated build.
		const support = updateSupport(installedProbe({ arch: "arm64" }));
		assert.equal(support.supported, false);
		assert.match(support.supported ? "" : support.reason, /ARM64|arm64/);
	});

	it("accepts the x64 build even on an ARM machine running it emulated", () => {
		// process.arch is what the build is, not what the CPU is, which is
		// exactly the right question: the x64 installer updates the x64 app.
		assert.equal(
			updateSupport(installedProbe({ arch: "x64" })).supported,
			true,
		);
	});

	it("refuses to update the GNOME backend, which the shell owns", () => {
		const support = updateSupport(installedProbe({ platform: "linux" }));
		assert.equal(support.supported, false);
		assert.match(support.supported ? "" : support.reason, /Windows/i);
	});

	it("does not go looking before it knows the build is even packaged", () => {
		// Under `win:dev` there is no install directory to read.
		let looked = false;
		updateSupport(
			installedProbe({
				packaged: false,
				siblings: () => {
					looked = true;
					return [];
				},
			}),
		);
		assert.equal(looked, false);
	});
});

describe("Updater", () => {
	afterEach(() => mock.timers.reset());

	const HOUR = 60 * 60 * 1000;

	function build(probeOverrides: Record<string, unknown> = {}) {
		const port = new FakePort();
		const ui = new FakeUi();
		const updater = new Updater({
			port,
			ui,
			support: updateSupport(installedProbe(probeOverrides)),
			intervalMs: 6 * HOUR,
		});
		return { port, ui, updater };
	}

	it("checks once as soon as it starts", () => {
		const { port, updater } = build();
		updater.start();
		assert.equal(port.checks, 1);
	});

	it("keeps checking on the interval, because a tray app runs for weeks", async () => {
		mock.timers.enable({ apis: ["setInterval"] });
		const { port, updater } = build();
		updater.start();
		// Each check has to be allowed to finish before the next tick: an
		// overlapping one would be dropped by the in-flight guard, and the test
		// would be measuring that instead of the interval.
		await updater.settled();
		mock.timers.tick(6 * HOUR);
		await updater.settled();
		mock.timers.tick(6 * HOUR);
		await updater.settled();
		assert.equal(port.checks, 3);
	});

	it("never checks when this install cannot update itself", async () => {
		mock.timers.enable({ apis: ["setInterval"] });
		const { port, updater } = build({ siblings: () => [] });
		updater.start();
		mock.timers.tick(24 * HOUR);
		await updater.settled();
		assert.equal(port.checks, 0);
	});

	it("downloads on its own, and installs on quit if the restart is declined", () => {
		// Both are electron-updater settings rather than behaviour of this class,
		// but they decide whether an update ever actually lands: without the
		// second, a user who clicks Later never gets it.
		const { port, updater } = build();
		updater.start();
		assert.equal(port.autoDownload, true);
		assert.equal(port.autoInstallOnAppQuit, true);
	});

	it("tells the user why, when they ask a copy that cannot update itself", async () => {
		const { ui, updater } = build({ siblings: () => [] });
		await updater.checkNow();
		assert.equal(ui.reports.length, 1);
		assert.match(ui.reports[0] ?? "", /zip|unzipped/i);
	});

	it("says so when the user asks and there is no update", async () => {
		const { port, ui, updater } = build();
		await updater.checkNow();
		port.emit("update-not-available", { version: "1.1.0" });
		assert.equal(ui.reports.length, 1);
		assert.match(ui.reports[0] ?? "", /1\.1\.0/);
	});

	it("stays quiet when a background check finds no update", async () => {
		const { port, ui, updater } = build();
		updater.start();
		await updater.settled();
		port.emit("update-not-available", { version: "1.1.0" });
		assert.deepEqual(ui.reports, []);
	});

	it("surfaces a failure the user was waiting on", async () => {
		const { port, ui, updater } = build();
		port.failWith = new Error("net::ERR_INTERNET_DISCONNECTED");
		await updater.checkNow();
		assert.equal(ui.reports.length, 1);
		assert.match(ui.reports[0] ?? "", /ERR_INTERNET_DISCONNECTED/);
	});

	it("only logs a failure nobody was waiting on", async () => {
		const { port, ui, updater } = build();
		port.failWith = new Error("net::ERR_INTERNET_DISCONNECTED");
		updater.start();
		await updater.settled();
		assert.deepEqual(ui.reports, []);
		assert.match(ui.logs.join("\n"), /ERR_INTERNET_DISCONNECTED/);
	});

	it("offers a restart once an update has downloaded", async () => {
		const { port, ui, updater } = build();
		updater.start();
		await updater.settled();
		port.emit("update-downloaded", { version: "1.2.0" });
		await updater.settled();
		assert.deepEqual(ui.prompts, ["1.2.0"]);
	});

	it("restarts into the new version when the user accepts", async () => {
		const { port, ui, updater } = build();
		ui.restartAnswer = true;
		updater.start();
		await updater.settled();
		port.emit("update-downloaded", { version: "1.2.0" });
		await updater.settled();
		assert.equal(port.installs.length, 1);
		// Silent, and relaunched afterwards: a tray app that vanished on update
		// would look to the user like it had crashed.
		assert.deepEqual(port.installs[0], { silent: true, forceRunAfter: true });
	});

	it("leaves the app running when the user picks Later", async () => {
		const { port, ui, updater } = build();
		ui.restartAnswer = false;
		updater.start();
		await updater.settled();
		port.emit("update-downloaded", { version: "1.2.0" });
		await updater.settled();
		assert.deepEqual(port.installs, []);
	});

	it("ignores a second check while one is still running", async () => {
		const { port, updater } = build();
		const first = updater.checkNow();
		const second = updater.checkNow();
		await Promise.all([first, second]);
		assert.equal(port.checks, 1);
	});

	it("can check again once the previous check has finished", async () => {
		const { port, updater } = build();
		await updater.checkNow();
		await updater.checkNow();
		assert.equal(port.checks, 2);
	});
});

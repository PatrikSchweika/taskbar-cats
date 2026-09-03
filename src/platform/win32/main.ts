/**
 * The Windows overlay: an Electron main process that owns a click-through
 * always-on-top strip along the bottom of the taskbar's monitor.
 *
 * Why an overlay at all, when the GNOME version is an extension? Because on
 * Windows the taskbar belongs to explorer.exe. Its buttons can be *found* — UI
 * Automation exposes their bounds — but nothing outside that process can
 * animate them, so this backend draws cats in front of the taskbar and leaves
 * it untouched. The icon-shake the GNOME backend does is therefore not
 * implemented here; see docs/windows.md.
 *
 * Division of labour:
 *   - main (this file) polls the shell and owns the window, tray and settings
 *   - the overlay renderer runs the shared simulation and draws it
 *
 * The expensive half of polling is UI Automation, so the taskbar layout is read
 * a few times a second while the pointer is read on every tick.
 */
import { readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	app,
	BrowserWindow,
	dialog,
	shell as electronShell,
	ipcMain,
	Menu,
	nativeImage,
	net,
	protocol,
	screen,
	Tray,
} from "electron";

import { ACTIVE_INTERVAL_MS } from "../../core/colony.js";
import type { Settings } from "../../core/config.js";
import { parseManifest, type SpriteManifest } from "../../core/sprites.js";
import { ConfigStore } from "./config.js";
import { CHANNELS, type Layout, type SettingsDescription } from "./ipc.js";
import { loadShell, type Win32Shell } from "./native.js";
import {
	type Desktop,
	type Display,
	type DisplayBridge,
	TaskbarTracker,
} from "./taskbarTracker.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
/** The root of the compiled output; everything the renderers load is under it. */
const BUNDLE = resolve(HERE, "..", "..");
/** Where the sprite frames and icons live, relative to the compiled output. */
const ASSETS = join(BUNDLE, "assets");
/** The CommonJS preload; see tsconfig.win32.preload.json for why it is separate. */
const PRELOAD = join(BUNDLE, "cjs", "platform", "win32", "preload.js");

/**
 * The scheme the renderers are served from, instead of file://.
 *
 * Chromium refuses to load an ES-module `<script>` over file:// — the origin is
 * opaque, so the module request fails CORS — and the renderers are ES modules
 * importing the shared core. A registered standard scheme gives them a real
 * origin, which also makes `'self'` mean something in their CSP.
 *
 * This has to run before the app is ready, hence the module scope.
 */
const SCHEME = "cats";
protocol.registerSchemesAsPrivileged([
	{
		scheme: SCHEME,
		privileges: { standard: true, secure: true, supportFetchAPI: true },
	},
]);

/** Serve the compiled output, and nothing above it. */
function handleBundleProtocol(): void {
	protocol.handle(SCHEME, (request) => {
		const path = resolve(BUNDLE, `.${new URL(request.url).pathname}`);
		// A request that escapes the bundle is a bug or an attack; either way it
		// is not something to serve.
		const inside = relative(BUNDLE, path);
		if (inside.startsWith("..") || inside.startsWith(`${sep}..`))
			return new Response("forbidden", { status: 403 });
		return net.fetch(pathToFileURL(path).toString());
	});
}

/** How often the taskbar's shape and icon list are re-read. */
const LAYOUT_INTERVAL_MS = 500;
/** The tallest a cat can be, from the sprite-size setting's maximum. */
const MAX_CAT_HEIGHT = 128;
/** Head-room above the cats so a tall sprite is never clipped. */
const STRIP_SLACK = 24;

interface Overlay {
	window: BrowserWindow;
	/** The window's screen position, for translating into window space. */
	origin: { x: number; y: number };
}

/**
 * Electron's physical/logical conversions, behind the interface the tracker
 * wants.
 *
 * `screenToDipRect` and `screenToDipPoint` are Windows-only. The fallbacks let
 * the app start on another platform — useful for looking at the renderer
 * without a Windows machine — where it degrades to no taskbar and roaming cats.
 */
function electronBridge(): DisplayBridge {
	const toDipRect =
		typeof screen.screenToDipRect === "function"
			? screen.screenToDipRect.bind(screen)
			: null;
	const toDipPoint =
		typeof screen.screenToDipPoint === "function"
			? screen.screenToDipPoint.bind(screen)
			: null;

	return {
		rectToDip: (rect) => {
			if (!toDipRect) return { ...rect };
			const dip = toDipRect(null, {
				x: rect.x,
				y: rect.y,
				width: rect.w,
				height: rect.h,
			});
			return { x: dip.x, y: dip.y, w: dip.width, h: dip.height };
		},
		pointToDip: (point) => (toDipPoint ? toDipPoint(point) : { ...point }),
		displayAt: (point) => {
			const dip = toDipPoint ? toDipPoint(point) : point;
			return asDisplay(screen.getDisplayNearestPoint(dip));
		},
		primaryDisplay: () => asDisplay(screen.getPrimaryDisplay()),
	};
}

function asDisplay(display: Electron.Display | undefined): Display | null {
	if (!display) return null;
	return {
		bounds: {
			x: display.bounds.x,
			y: display.bounds.y,
			w: display.bounds.width,
			h: display.bounds.height,
		},
		scaleFactor: display.scaleFactor,
	};
}

/**
 * The overlay is a strip, not a fullscreen window.
 *
 * A transparent window over the whole screen would work, but it covers every
 * pixel the user is looking at for the sake of the bottom hundred, and a
 * click-through window that large is the kind of thing that gets blamed for
 * unrelated input bugs. The cats only ever occupy the bottom edge, so that is
 * all the window needs to be.
 */
function stripFor(desktop: Desktop): Electron.Rectangle {
	const overTaskbar = desktop.edge === "bottom" ? desktop.taskbar.h : 0;
	const height = Math.min(
		desktop.monitor.h,
		Math.round(overTaskbar + MAX_CAT_HEIGHT + STRIP_SLACK),
	);
	return {
		x: desktop.monitor.x,
		y: desktop.monitor.y + desktop.monitor.h - height,
		width: desktop.monitor.w,
		height,
	};
}

function trayImage(): Electron.NativeImage {
	// Generated by `npm run sprites`; an empty image still gives a working
	// (if blank) tray entry rather than no way to quit the app.
	const image = nativeImage.createFromPath(join(ASSETS, "icons", "tray.png"));
	return image.isEmpty() ? nativeImage.createEmpty() : image;
}

/** The sprite manifest, read once and shared with both renderers. */
function spriteManifest(): SpriteManifest {
	const path = join(ASSETS, "cats", "manifest.json");
	return parseManifest(readFileSync(path, "utf8"), path);
}

class CatsApp {
	private readonly _config: ConfigStore;
	private readonly _shell: Win32Shell;
	private readonly _shellError: string | null;
	private readonly _tracker: TaskbarTracker;
	/**
	 * Read once at startup. A failure here is fatal in the honest sense: with no
	 * manifest there are no frames, and a colony of invisible cats is worse than
	 * a clear error.
	 */
	private readonly _manifest: SpriteManifest;

	private _overlay: Overlay | null = null;
	private _settingsWindow: BrowserWindow | null = null;
	private _tray: Tray | null = null;
	private _timer: NodeJS.Timeout | null = null;
	private _sinceLayout = Number.POSITIVE_INFINITY;
	private _lastLayoutKey = "";
	private _visible = false;

	constructor() {
		this._config = new ConfigStore(app.getPath("userData"));
		const loaded = loadShell({ resourcesPath: process.resourcesPath });
		this._shell = loaded.shell;
		this._shellError = loaded.available ? null : (loaded.reason ?? "unknown");
		if (this._shellError)
			console.error(
				`taskbar-cats: the taskbar helper is unavailable, so the cats will ignore your icons.\n${this._shellError}`,
			);
		this._tracker = new TaskbarTracker(this._shell, electronBridge());
		this._manifest = spriteManifest();
	}

	start(): void {
		handleBundleProtocol();
		this._createOverlay();
		this._createTray();
		this._config.onChange((settings) => {
			for (const window of [this._overlay?.window, this._settingsWindow])
				if (window && !window.isDestroyed())
					window.webContents.send(CHANNELS.settings, settings);
		});

		ipcMain.on(CHANNELS.ready, () => {
			// Anything sent before the renderer finished loading was dropped, so
			// the cached layout key has to be cleared too or _syncOverlay will
			// decide nothing changed and send nothing.
			this._pushSettings();
			this._relayout();
		});
		ipcMain.on(CHANNELS.apply, (_event, patch: Partial<Settings>) => {
			this._config.update(patch);
		});
		ipcMain.handle(
			CHANNELS.describe,
			(): SettingsDescription => ({
				settings: this._config.settings,
				palettes: this._manifest.palettes,
				configPath: this._config.path,
				shellError: this._shellError,
			}),
		);
		ipcMain.handle(CHANNELS.manifest, (): SpriteManifest => this._manifest);

		// The taskbar moves when a display is added, resized or rescaled.
		screen.on("display-metrics-changed", () => this._relayout());
		screen.on("display-added", () => this._relayout());
		screen.on("display-removed", () => this._relayout());

		this._timer = setInterval(() => this._tick(), ACTIVE_INTERVAL_MS);
	}

	stop(): void {
		if (this._timer) clearInterval(this._timer);
		this._timer = null;
		this._shell.dispose();
		this._tray?.destroy();
		this._tray = null;
	}

	// -- windows ------------------------------------------------------------

	private _createOverlay(): void {
		const window = new BrowserWindow({
			show: false,
			frame: false,
			transparent: true,
			// 'toolbar' keeps the overlay out of Alt+Tab and the taskbar itself.
			type: "toolbar",
			skipTaskbar: true,
			focusable: false,
			resizable: false,
			movable: false,
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			hasShadow: false,
			thickFrame: false,
			acceptFirstMouse: false,
			webPreferences: {
				preload: PRELOAD,
				contextIsolation: true,
				nodeIntegration: false,
				// The overlay is never focused, and a throttled renderer would
				// drop the cats to one frame a second.
				backgroundThrottling: false,
			},
		});

		// Clicks, scrolls and hovers all belong to whatever is underneath.
		// `forward` keeps mouse-move events coming so the window is not a dead
		// zone for anything that tracks the pointer.
		window.setIgnoreMouseEvents(true, { forward: true });
		// 'screen-saver' is the level that sits above the taskbar.
		window.setAlwaysOnTop(true, "screen-saver");
		window.setVisibleOnAllWorkspaces(true);

		void window.loadURL(
			`${SCHEME}://bundle/platform/win32/renderer/overlay.html`,
		);
		this._overlay = { window, origin: { x: 0, y: 0 } };
	}

	private _createTray(): void {
		const tray = new Tray(trayImage());
		tray.setToolTip("Ubuntu Cats");
		tray.setContextMenu(
			Menu.buildFromTemplate([
				{ label: "Settings…", click: () => this._openSettings() },
				{
					label: "Start with Windows",
					type: "checkbox",
					checked: app.getLoginItemSettings().openAtLogin,
					click: (item) => {
						app.setLoginItemSettings({ openAtLogin: item.checked });
					},
				},
				{ type: "separator" },
				{
					label: "Open settings file",
					click: () => {
						void electronShell.openPath(this._config.path);
					},
				},
				{ type: "separator" },
				{ label: "Quit", click: () => app.quit() },
			]),
		);
		tray.on("double-click", () => this._openSettings());
		this._tray = tray;
	}

	private _openSettings(): void {
		if (this._settingsWindow && !this._settingsWindow.isDestroyed()) {
			this._settingsWindow.show();
			this._settingsWindow.focus();
			return;
		}
		const window = new BrowserWindow({
			width: 460,
			height: 880,
			title: "Ubuntu Cats",
			icon: join(ASSETS, "icons", "app.ico"),
			autoHideMenuBar: true,
			webPreferences: {
				preload: PRELOAD,
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
		window.setMenuBarVisibility(false);
		void window.loadURL(
			`${SCHEME}://bundle/platform/win32/renderer/settings.html`,
		);
		window.on("closed", () => {
			this._settingsWindow = null;
		});
		this._settingsWindow = window;
	}

	private _pushSettings(): void {
		const window = this._overlay?.window;
		if (window && !window.isDestroyed())
			window.webContents.send(CHANNELS.settings, this._config.settings);
	}

	// -- the tick -----------------------------------------------------------

	private _relayout(): void {
		this._sinceLayout = Number.POSITIVE_INFINITY;
		this._lastLayoutKey = "";
	}

	private _tick(): void {
		const overlay = this._overlay;
		if (!overlay || overlay.window.isDestroyed()) return;

		this._sinceLayout += ACTIVE_INTERVAL_MS;
		if (this._sinceLayout >= LAYOUT_INTERVAL_MS) {
			this._sinceLayout = 0;
			this._tracker.refreshLayout();
			this._syncOverlay(overlay);
		}

		const visible = this._tracker.isUsable();
		if (visible !== this._visible) {
			this._visible = visible;
			if (visible) {
				overlay.window.showInactive();
				// A re-shown window lands wherever Windows puts it in the topmost
				// band — observed: underneath the taskbar, cats and all. Put it
				// back on top now rather than at the next layout refresh.
				overlay.window.setAlwaysOnTop(true, "screen-saver");
			} else overlay.window.hide();
		}
		if (!visible) return;

		const pointer = this._tracker.pointer();
		if (pointer)
			overlay.window.webContents.send(CHANNELS.pointer, {
				x: pointer.x - overlay.origin.x,
				y: pointer.y - overlay.origin.y,
			});
	}

	/**
	 * Move the window to the taskbar's monitor and tell the renderer where the
	 * floor is, but only when something actually changed — resizing a window
	 * every 500ms would fight with the compositor for no reason.
	 */
	private _syncOverlay(overlay: Overlay): void {
		const desktop = this._tracker.desktop;
		if (!desktop) {
			if (this._lastLayoutKey !== "none") {
				this._lastLayoutKey = "none";
				overlay.window.webContents.send(CHANNELS.layout, null);
			}
			return;
		}

		const strip = stripFor(desktop);

		// Another window can be raised above ours at any time — the taskbar
		// itself, when explorer restarts or a flyout closes — and nothing tells
		// us. Re-asserting on every refresh is the Windows equivalent of the
		// GNOME backend re-raising its actor whenever the dock is rediscovered;
		// it is one SetWindowPos with no move, no resize and no repaint. It has
		// to run even when nothing below has changed: the case that lost the
		// cats behind the taskbar left every rect exactly as it was.
		overlay.window.setAlwaysOnTop(true, "screen-saver");

		const key = JSON.stringify([strip, desktop.icons]);
		if (key === this._lastLayoutKey) return;
		this._lastLayoutKey = key;

		const bounds = overlay.window.getBounds();
		if (
			bounds.x !== strip.x ||
			bounds.y !== strip.y ||
			bounds.width !== strip.width ||
			bounds.height !== strip.height
		)
			overlay.window.setBounds(strip);
		overlay.origin = { x: strip.x, y: strip.y };

		const layout: Layout = {
			roam: {
				min: desktop.monitor.x - strip.x,
				max: desktop.monitor.x + desktop.monitor.w - strip.x,
			},
			floorY: desktop.monitor.y + desktop.monitor.h - strip.y,
			icons: desktop.icons.map((icon) => ({
				...icon,
				x: icon.x - strip.x,
				y: icon.y - strip.y,
			})),
		};
		overlay.window.webContents.send(CHANNELS.layout, layout);
	}
}

// -- bootstrap --------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
	// A colony per launch would stack cats on top of each other.
	app.quit();
} else {
	let cats: CatsApp | null = null;

	void app.whenReady().then(() => {
		try {
			cats = new CatsApp();
			cats.start();
		} catch (e) {
			// There is no window yet and, once packaged, no console either. A
			// dialog is the only way a startup failure is anything other than
			// "I double-clicked it and nothing happened".
			dialog.showErrorBox(
				"Ubuntu Cats could not start",
				`${(e as Error).message}\n\nThis usually means the build is incomplete. Try \`npm run win:build\`.`,
			);
			app.exit(1);
		}
	});

	app.on("second-instance", () => {
		// Someone ran it again; treat that as "show me the settings".
		BrowserWindow.getAllWindows()
			.find((w) => w.isVisible() && w.isFocusable())
			?.focus();
	});

	// A tray app outlives its windows.
	app.on("window-all-closed", () => {});
	app.on("before-quit", () => cats?.stop());
}

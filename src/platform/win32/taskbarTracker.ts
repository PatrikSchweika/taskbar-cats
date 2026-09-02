/**
 * Deciding what the taskbar is, from what the shell will admit to.
 *
 * This is the Windows counterpart of dockTracker.ts, and it is the same kind of
 * code: the taskbar exposes no supported way to ask "where are the app icons",
 * so we take every button UI Automation can see and narrow it down. All of that
 * narrowing lives here, in one place, as pure functions over plain data — which
 * is what lets it be tested on any OS against fixtures, rather than only by
 * looking at a real taskbar.
 *
 * Everything the simulation receives is in device-independent pixels, because
 * that is what the renderer draws in. Win32 speaks physical pixels, so the
 * conversion happens on the way through.
 */
import type { IconRect, Rect } from "../../core/types.js";
import type {
	ForegroundWindow,
	PhysicalRect,
	TaskbarButton,
	TaskbarEdge,
	TaskbarInfo,
	Win32Shell,
} from "./native.js";

/** The Windows 11 taskbar's XAML class for an app button. */
const WIN11_APP_BUTTON = "tasklistbutton";

/**
 * Controls on the taskbar that are not app icons, matched case-insensitively
 * against AutomationId and ClassName.
 *
 * Matching identifiers rather than names on purpose: `Name` is the localised
 * window title, so a denylist of English words would quietly stop working on a
 * German desktop, while AutomationId is the same everywhere.
 */
const NOT_AN_APP = [
	"start",
	"search",
	"cortana",
	"taskview",
	"widget",
	"chat",
	"copilot",
	"notification",
	"systemtray",
	"traybutton",
	"trayitem",
	"clock",
	"showdesktop",
	"peek",
	"meetnow",
	"inputindicator",
	"overflow",
	"chevron",
];

function area(r: PhysicalRect): number {
	return Math.max(0, r.w) * Math.max(0, r.h);
}

function intersection(a: PhysicalRect, b: PhysicalRect): number {
	const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
	const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
	return w > 0 && h > 0 ? w * h : 0;
}

function matchesDenylist(button: TaskbarButton): boolean {
	// A Windows 10 app button carries neither an AutomationId nor a ClassName,
	// so blank fields match nothing here and those buttons fall through to the
	// geometry checks. That is the intended path, not an accident of it.
	for (const field of [button.automationId, button.className]) {
		const lower = field.toLowerCase();
		if (NOT_AN_APP.some((bad) => lower.includes(bad))) return true;
	}
	return false;
}

/**
 * The app buttons among everything on the taskbar, left to right.
 *
 * Two strategies, because the taskbar was rewritten in Windows 11:
 *
 *  - Windows 11 exposes app buttons with a distinctive XAML class, so when any
 *    button has it, those buttons *are* the answer and nothing else needs
 *    guessing.
 *  - Windows 10 gives app buttons no class and no AutomationId at all, so they
 *    are identified by elimination: drop the shell's own controls, drop
 *    anything in the notification area, drop anything that is not plausibly an
 *    icon-sized child of the taskbar.
 */
export function selectAppButtons(
	buttons: readonly TaskbarButton[],
	taskbar: PhysicalRect,
	notification: PhysicalRect | null,
): TaskbarButton[] {
	const sized = buttons.filter((b) => b.w > 4 && b.h > 4);

	const win11 = sized.filter((b) =>
		b.className.toLowerCase().includes(WIN11_APP_BUTTON),
	);
	const candidates = win11.length
		? win11
		: sized.filter((b) => !matchesDenylist(b));

	const kept = candidates.filter((b) => {
		// Mostly inside the taskbar: UI Automation also reaches into open
		// flyouts and jump lists, which are not on the bar at all.
		if (intersection(b, taskbar) < area(b) * 0.5) return false;
		if (notification && intersection(b, notification) > area(b) * 0.25)
			return false;
		// A button as wide as half the bar is a container, not an icon.
		if (taskbar.w > 0 && b.w > taskbar.w * 0.5) return false;
		if (taskbar.h > 0 && b.h > taskbar.h * 1.5) return false;
		return true;
	});

	return kept.sort((a, b) => a.x - b.x);
}

/** A display, in the device-independent pixels the renderer draws in. */
export interface Display {
	bounds: Rect;
	scaleFactor: number;
}

/**
 * The physical-to-logical conversions, injected rather than imported.
 *
 * Electron's `screen` module is only available in a running main process, and
 * these five lines of arithmetic are the only thing this file needs from it —
 * so it takes an interface and the tests pass a fake with a fixed scale factor.
 */
export interface DisplayBridge {
	rectToDip(rect: PhysicalRect): Rect;
	pointToDip(point: { x: number; y: number }): { x: number; y: number };
	/** The display a physical point falls on, or null if there is none. */
	displayAt(point: { x: number; y: number }): Display | null;
	/** Somewhere to put the cats when the taskbar cannot be found at all. */
	primaryDisplay(): Display | null;
}

/** Everything about the desktop the simulation needs, in DIP. */
export interface Desktop {
	/** The display the taskbar is on. Bounds the cats' roaming. */
	monitor: Rect;
	display: Display;
	icons: IconRect[];
	/** The taskbar itself, for sizing the overlay strip. */
	taskbar: Rect;
	edge: TaskbarEdge;
	/**
	 * The y the cats' feet rest on, in DIP screen coordinates.
	 *
	 * The bottom of the monitor, so they walk across the taskbar — unless the
	 * taskbar has moved into a z-band above the overlay, where nothing can be
	 * drawn over it. Then it is the taskbar's top edge, and they stand on it.
	 */
	floor: number;
	/**
	 * True when this was assembled without finding a taskbar — the native
	 * helper is missing, or explorer.exe is restarting. The cats roam the
	 * bottom of the primary display and have nothing to claw.
	 */
	fallback: boolean;
}

/**
 * Is the taskbar somewhere the cats can be drawn?
 *
 * Mirrors the intellihide rule from the GNOME backend: an auto-hidden taskbar
 * slides almost entirely off its monitor, and a bar that is off-screen means
 * there is nothing to walk in front of.
 */
export function taskbarOnScreen(
	taskbar: PhysicalRect,
	monitorPhysical: PhysicalRect,
): boolean {
	const visible = intersection(taskbar, monitorPhysical);
	return visible > area(taskbar) * 0.5;
}

/**
 * Top-level window classes the shell uses for its own surfaces.
 *
 * The Start menu, search, the notification centre and — on some Windows 11
 * releases — the tray and calendar flyouts are hosted in windows sized to the
 * whole monitor, of which only a panel is ever drawn. By rect alone they are
 * indistinguishable from a fullscreen game, and treating them as one hid the
 * cats for as long as any taskbar menu was open. None of them ever covers the
 * taskbar, which is the only thing the cats care about.
 *
 * Lower-case, matched case-insensitively: Win32 class names are.
 */
const SHELL_SURFACES = new Set(
	[
		// UWP shell hosts: Start, search, notification centre.
		"Windows.UI.Core.CoreWindow",
		// explorer.exe's XAML islands: Windows 11 tray and calendar flyouts.
		"XamlExplorerHostIslandWindow",
		// Quick settings on Windows 11 24H2 and later.
		"ControlCenterWindow",
		// Invisible windows Windows hands the foreground to during a switch.
		"ForegroundStaging",
		"MultitaskingViewFrame",
		// The taskbar itself, and the desktop behind everything.
		"Shell_TrayWnd",
		"Shell_SecondaryTrayWnd",
		"Progman",
		"WorkerW",
	].map((name) => name.toLowerCase()),
);

/**
 * How long a fullscreen reading has to hold before the cats hide.
 *
 * Windows briefly gives the foreground to monitor-sized windows during quite
 * ordinary transitions — a console host starting, a flyout animating in — for
 * a few hundred milliseconds at a time. Hiding on the first reading made the
 * cats blink out for no reason anyone could see. A game that has just started
 * is not spoiled by cats for three quarters of a second.
 */
export const FULLSCREEN_GRACE_MS = 750;

/**
 * How long the taskbar has to sit in a higher z-band than the overlay before
 * the cats climb onto it.
 *
 * Windows 11 lifts the taskbar into a higher band for the length of a menu's
 * animation, and drops it back when the menu closes. The cats are covered for
 * that moment whatever we do; hopping up and back down would only add to it.
 * A taskbar that stays up there — observed to happen, indefinitely — is a
 * different matter: on it, the cats are at least visible.
 */
export const ELEVATED_GRACE_MS = 1000;

/**
 * Does this window take over its whole monitor?
 *
 * The rect test is the obvious part. The exclusions are why this lives here
 * rather than in the addon: which windows are "really" fullscreen is a policy
 * about the shell, and one that has to be checked against fixtures.
 */
export function coversMonitor(fg: ForegroundWindow | null): boolean {
	if (!fg || fg.cloaked) return false;
	if (SHELL_SURFACES.has(fg.className.toLowerCase())) return false;
	const m = fg.monitor;
	// A pixel of slack: some players sit a hair outside the monitor rect.
	return (
		fg.x <= m.x + 1 &&
		fg.y <= m.y + 1 &&
		fg.x + fg.w >= m.x + m.w - 1 &&
		fg.y + fg.h >= m.y + m.h - 1
	);
}

export class TaskbarTracker {
	private readonly _shell: Win32Shell;
	private readonly _bridge: DisplayBridge;
	private readonly _now: () => number;
	private _desktop: Desktop | null = null;
	private _onScreen = false;
	/** When the current run of fullscreen readings began, or null if not in one. */
	private _coveredSince: number | null = null;
	/** When the taskbar was first seen above the overlay, or null if it is not. */
	private _elevatedSince: number | null = null;
	/**
	 * The overlay's HWND, once there is one. Until main sets it the bands are
	 * not asked about, because there is nothing to compare the taskbar to.
	 */
	overlayHandle: number | null = null;

	constructor(
		shell: Win32Shell,
		bridge: DisplayBridge,
		now: () => number = Date.now,
	) {
		this._shell = shell;
		this._bridge = bridge;
		this._now = now;
	}

	/**
	 * Re-read the taskbar and its icons.
	 *
	 * Kept separate from the tick because it is the expensive half: every UI
	 * Automation property is a cross-process call, so this runs a few times a
	 * second while the cats themselves run at thirty.
	 */
	refreshLayout(): void {
		const taskbar = this._shell.taskbar();
		if (!taskbar) {
			// No taskbar is not the same as a hidden one. It means nobody could
			// tell us where it is — usually because the native helper was never
			// built — and the cats should still have a floor to walk on.
			this._desktop = this._fallbackDesktop();
			this._onScreen = this._desktop !== null;
			return;
		}

		const display = this._bridge.displayAt(centreOf(taskbar));
		if (!display) {
			this._desktop = this._fallbackDesktop();
			this._onScreen = this._desktop !== null;
			return;
		}

		this._onScreen = taskbarOnScreen(taskbar, physicalBoundsOf(display));

		// Scratching only makes sense against a taskbar along the bottom edge.
		// The cats walk the bottom of the screen whatever the taskbar does, and
		// a cat's "am I under an icon" test is purely horizontal — so with a
		// side or top taskbar it would claw at empty floor beneath icons metres
		// away. Reporting no icons is the honest answer; they still roam and nap.
		const buttons =
			taskbar.edge === "bottom"
				? selectAppButtons(
						this._shell.taskbarButtons(),
						taskbar,
						this._shell.notificationArea(),
					)
				: [];

		const taskbarDip = this._bridge.rectToDip(taskbar);
		// Standing on a side or top bar makes no sense; the cats walk the bottom
		// of the screen whatever such a bar does, as they do for icons.
		const floor =
			taskbar.edge === "bottom" && this._taskbarAbove()
				? taskbarDip.y
				: display.bounds.y + display.bounds.h;

		this._desktop = {
			monitor: display.bounds,
			display,
			taskbar: taskbarDip,
			edge: taskbar.edge,
			floor,
			fallback: false,
			icons: buttons.map((button) => {
				const rect = this._bridge.rectToDip(button);
				return {
					...rect,
					handle: button.id,
					// The whole button, not the glyph inside it: UI Automation
					// does not expose the glyph. It runs a little larger than a
					// dock icon, which is the right ballpark for cat size.
					logicalSize: Math.round(Math.min(rect.w, rect.h)),
				};
			}),
		};
	}

	/**
	 * The bottom of the primary display, with no taskbar and no icons.
	 *
	 * Null only if Electron cannot name a display either, at which point there
	 * is genuinely nowhere to draw.
	 */
	private _fallbackDesktop(): Desktop | null {
		const display = this._bridge.primaryDisplay();
		if (!display) return null;
		return {
			monitor: display.bounds,
			display,
			// A zero-height bar at the floor: the overlay strip is then sized
			// for the cats alone, which is all there is.
			taskbar: {
				x: display.bounds.x,
				y: display.bounds.y + display.bounds.h,
				w: display.bounds.w,
				h: 0,
			},
			edge: "bottom",
			floor: display.bounds.y + display.bounds.h,
			icons: [],
			fallback: true,
		};
	}

	/**
	 * Has the taskbar been in a higher z-band than the overlay for a while?
	 *
	 * Read once per layout refresh, not per tick: it changes on the timescale
	 * of menus opening, and it is one more cross-process question each time.
	 */
	private _taskbarAbove(): boolean {
		const bands =
			this.overlayHandle === null ? null : this._shell.bands(this.overlayHandle);
		if (!bands || bands.taskbar <= bands.overlay) {
			this._elevatedSince = null;
			return false;
		}
		this._elevatedSince ??= this._now();
		return this._now() - this._elevatedSince >= ELEVATED_GRACE_MS;
	}

	/** The last layout read, or null if there was nothing to read. */
	get desktop(): Desktop | null {
		return this._desktop;
	}

	/**
	 * Whether to draw the cats at all. Cheap enough for every tick.
	 *
	 * Deliberately *not* hiding for a maximised window: the taskbar is still
	 * visible then, so the cats should be too. Only a window covering its whole
	 * monitor — a game, a video, a presentation — takes the screen over, and
	 * only once it has done so for FULLSCREEN_GRACE_MS. Coming back is instant:
	 * the grace period exists to ignore transients, not to keep a bare taskbar.
	 */
	isUsable(): boolean {
		if (!this._desktop || !this._onScreen) return false;
		if (!coversMonitor(this._shell.foreground())) {
			this._coveredSince = null;
			return true;
		}
		this._coveredSince ??= this._now();
		return this._now() - this._coveredSince < FULLSCREEN_GRACE_MS;
	}

	/** The pointer in DIP, or null when Windows will not say. */
	pointer(): { x: number; y: number } | null {
		const physical = this._shell.cursor();
		return physical ? this._bridge.pointToDip(physical) : null;
	}
}

function centreOf(rect: PhysicalRect): { x: number; y: number } {
	return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * A display's bounds back in physical pixels.
 *
 * Needed because the taskbar rect arrives physical and the display arrives
 * logical, and asking whether one is inside the other requires both in the same
 * units.
 */
function physicalBoundsOf(display: Display): PhysicalRect {
	const scale = display.scaleFactor || 1;
	return {
		x: Math.round(display.bounds.x * scale),
		y: Math.round(display.bounds.y * scale),
		w: Math.round(display.bounds.w * scale),
		h: Math.round(display.bounds.h * scale),
	};
}

export type { TaskbarButton, TaskbarEdge, TaskbarInfo };

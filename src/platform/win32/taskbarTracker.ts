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

export class TaskbarTracker {
	private readonly _shell: Win32Shell;
	private readonly _bridge: DisplayBridge;
	private _desktop: Desktop | null = null;
	private _onScreen = false;

	constructor(shell: Win32Shell, bridge: DisplayBridge) {
		this._shell = shell;
		this._bridge = bridge;
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

		this._desktop = {
			monitor: display.bounds,
			display,
			taskbar: this._bridge.rectToDip(taskbar),
			edge: taskbar.edge,
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
			icons: [],
			fallback: true,
		};
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
	 * monitor — a game, a video, a presentation — takes the screen over.
	 */
	isUsable(): boolean {
		if (!this._desktop || !this._onScreen) return false;
		return !this._shell.foregroundFullscreen();
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

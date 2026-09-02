/**
 * Fakes for the Windows backend.
 *
 * The Win32 side of the port is two thin layers — a C++ addon that reports what
 * the shell says, and TypeScript that decides what it means. Only the second
 * layer holds decisions, and it takes both the shell and the display maths as
 * interfaces, so all of it can be driven from here on any OS.
 */
import type {
	ForegroundWindow,
	PhysicalRect,
	TaskbarButton,
	TaskbarEdge,
	TaskbarInfo,
	Win32Shell,
	ZBands,
} from "../../../src/platform/win32/native.ts";
import type {
	Display,
	DisplayBridge,
} from "../../../src/platform/win32/taskbarTracker.ts";

export interface FakeShellState {
	taskbar: TaskbarInfo | null;
	buttons: TaskbarButton[];
	notification: PhysicalRect | null;
	cursor: { x: number; y: number } | null;
	/** The window in front, or null when Windows has no foreground window. */
	foreground: ForegroundWindow | null;
	/** Z-bands of the taskbar and the overlay; null when Windows will not say. */
	bands: ZBands | null;
	/** What bands() was last asked about, so a test can check the handle got through. */
	bandsAskedFor: number | null;
	disposed: boolean;
}

export function fakeShell(over: Partial<FakeShellState> = {}): {
	shell: Win32Shell;
	state: FakeShellState;
} {
	const state: FakeShellState = {
		taskbar: taskbarInfo(),
		buttons: [],
		notification: null,
		cursor: { x: 0, y: 0 },
		foreground: null,
		bands: { taskbar: 1, overlay: 1 },
		bandsAskedFor: null,
		disposed: false,
		...over,
	};
	const shell: Win32Shell = {
		taskbar: () => state.taskbar,
		taskbarButtons: () => state.buttons,
		notificationArea: () => state.notification,
		cursor: () => state.cursor,
		foreground: () => state.foreground,
		bands: (overlay) => {
			state.bandsAskedFor = overlay;
			return state.bands;
		},
		dispose: () => {
			state.disposed = true;
		},
	};
	return { shell, state };
}

/** The 1920x1080 monitor every fixture here lives on, in physical px. */
export const MONITOR: PhysicalRect = { x: 0, y: 0, w: 1920, h: 1080 };

/**
 * A foreground window covering the whole monitor: a game, a video, a slide
 * show. Anything a cat should not walk across.
 */
export function fullscreenWindow(
	over: Partial<ForegroundWindow> = {},
): ForegroundWindow {
	return {
		...MONITOR,
		className: "UnrealWindow",
		monitor: MONITOR,
		cloaked: false,
		...over,
	};
}

/** A 1920x1080 display with a 48px taskbar along the bottom, in physical px. */
export function taskbarInfo(over: Partial<TaskbarInfo> = {}): TaskbarInfo {
	return {
		x: 0,
		y: 1032,
		w: 1920,
		h: 48,
		edge: "bottom" as TaskbarEdge,
		autoHide: false,
		...over,
	};
}

/** A Windows 11 app button: identified by its XAML class. */
export function win11Button(
	x: number,
	over: Partial<TaskbarButton> = {},
): TaskbarButton {
	return {
		x,
		y: 1036,
		w: 44,
		h: 40,
		automationId: "",
		className: "Taskbar.TaskListButton",
		name: "Some App",
		id: `runtime-${x}`,
		...over,
	};
}

/** A Windows 10 app button: no class, no automation id, only geometry. */
export function win10Button(
	x: number,
	over: Partial<TaskbarButton> = {},
): TaskbarButton {
	return {
		x,
		y: 1036,
		w: 40,
		h: 40,
		automationId: "",
		className: "",
		name: "Some App",
		id: `runtime-${x}`,
		...over,
	};
}

/**
 * A display bridge with a fixed scale factor, dividing physical pixels by it.
 *
 * That is what Windows does for a single display, and it is the only part of
 * Electron's screen module the tracker uses.
 */
export function fakeBridge(
	scaleFactor = 1,
	bounds = { x: 0, y: 0, w: 1920, h: 1080 },
): DisplayBridge & { display: Display | null } {
	const display: Display = {
		bounds: {
			x: bounds.x / scaleFactor,
			y: bounds.y / scaleFactor,
			w: bounds.w / scaleFactor,
			h: bounds.h / scaleFactor,
		},
		scaleFactor,
	};
	return {
		display,
		rectToDip: (rect) => ({
			x: rect.x / scaleFactor,
			y: rect.y / scaleFactor,
			w: rect.w / scaleFactor,
			h: rect.h / scaleFactor,
		}),
		pointToDip: (point) => ({
			x: point.x / scaleFactor,
			y: point.y / scaleFactor,
		}),
		displayAt: () => display,
		primaryDisplay: () => display,
	};
}

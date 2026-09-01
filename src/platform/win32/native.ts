/**
 * The boundary with native/win32-shell.
 *
 * Two jobs: give the addon a type, and make its absence survivable. A missing
 * or unloadable addon leaves the cats walking the bottom of the screen with no
 * taskbar awareness, which is a degraded but working app — the same shape of
 * failure as the GNOME backend not finding a dock, and much better than a
 * startup crash.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A rect in physical pixels, as every Win32 API reports them. */
export interface PhysicalRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export type TaskbarEdge = "left" | "top" | "right" | "bottom";

export interface TaskbarInfo extends PhysicalRect {
	edge: TaskbarEdge;
	autoHide: boolean;
}

/** One button on the taskbar, before anything decides whether it is an app. */
export interface TaskbarButton extends PhysicalRect {
	/** Locale-independent identifier, where the control has one. */
	automationId: string;
	/** The XAML or Win32 class, e.g. 'Taskbar.TaskListButton' on Windows 11. */
	className: string;
	/** Usually the window title. Localised — never matched against. */
	name: string;
	/** UIA runtime id, stable for as long as the button exists. */
	id: string;
}

export interface Win32Shell {
	taskbar(): TaskbarInfo | null;
	taskbarButtons(): TaskbarButton[];
	notificationArea(): PhysicalRect | null;
	cursor(): { x: number; y: number } | null;
	foregroundFullscreen(): boolean;
	dispose(): void;
}

/** What a shell that knows nothing reports. */
const UNAVAILABLE: Win32Shell = {
	taskbar: () => null,
	taskbarButtons: () => [],
	notificationArea: () => null,
	cursor: () => null,
	foregroundFullscreen: () => false,
	dispose: () => {},
};

export interface LoadedShell {
	shell: Win32Shell;
	available: boolean;
	/** Why it is unavailable, for the log. */
	reason?: string;
}

/**
 * Where the compiled addon might be, in the order worth trying.
 *
 * Running from source it sits under native/, a few directories up from the
 * compiled main.js. In a package, electron-builder's `extraResources` drops it
 * straight into resources/ — outside the asar archive, because a .node file has
 * to be a real file on disk for LoadLibrary to open it.
 *
 * Every layout is tried rather than resolved from configuration, so none of
 * them needs the others to know about it. Exported so the packaged locations
 * can be tested somewhere other than inside an installer.
 */
export function candidatePaths(
	fromDir: string,
	resourcesPath?: string,
): string[] {
	const built = join(
		"native",
		"win32-shell",
		"build",
		"Release",
		"win32_shell.node",
	);
	const paths = [
		join(fromDir, "..", "..", "..", built),
		join(fromDir, "..", "..", "..", "..", built),
	];
	if (resourcesPath) {
		// Where electron-builder.yml puts it.
		paths.push(join(resourcesPath, "win32_shell.node"));
		// Fallbacks for an asar-packed layout, should the config ever change.
		paths.push(join(resourcesPath, "app.asar.unpacked", built));
		paths.push(join(resourcesPath, built));
	}
	return paths;
}

export function loadShell(
	options: { resourcesPath?: string } = {},
): LoadedShell {
	if (process.platform !== "win32")
		return {
			shell: UNAVAILABLE,
			available: false,
			reason: `win32-shell is only built on Windows (running on ${process.platform})`,
		};

	const require_ = createRequire(import.meta.url);
	const here = dirname(fileURLToPath(import.meta.url));
	const tried: string[] = [];

	for (const path of candidatePaths(here, options.resourcesPath)) {
		tried.push(path);
		try {
			const addon = require_(path) as Win32Shell;
			if (typeof addon.taskbar !== "function")
				throw new Error("addon does not export taskbar()");
			return { shell: addon, available: true };
		} catch (e) {
			// Missing is the common case (never built); anything else is worth
			// reporting, but not worth failing over.
			const code = (e as NodeJS.ErrnoException).code;
			if (code !== "MODULE_NOT_FOUND" && code !== "ENOENT")
				return {
					shell: UNAVAILABLE,
					available: false,
					reason: `${path} failed to load: ${(e as Error).message}`,
				};
		}
	}

	return {
		shell: UNAVAILABLE,
		available: false,
		reason: `win32_shell.node not found. Run \`npm run win:native\`. Looked in:\n  ${tried.join("\n  ")}`,
	};
}

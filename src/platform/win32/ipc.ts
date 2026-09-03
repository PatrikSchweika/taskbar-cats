/**
 * The contract between the Electron main process and its two renderers.
 *
 * Named in one place so the overlay, the settings window and main cannot drift
 * apart on a channel name or a payload shape.
 */
import type { Settings } from "../../core/config.js";
import type { SpriteManifest } from "../../core/sprites.js";
import type { IconRect } from "../../core/types.js";

/**
 * Where the cats may walk, in the overlay window's own coordinates.
 *
 * Translated out of screen space by main, so the renderer never has to know
 * about monitor offsets or which display it is on.
 */
export interface Layout {
	/** Horizontal range the cats roam, window-local. */
	roam: { min: number; max: number };
	/** The y their feet rest on, window-local. */
	floorY: number;
	icons: IconRect[];
}

/**
 * A `const enum` rather than an `as const` object, and that matters.
 *
 * The preload runs in a sandboxed renderer, where `require` resolves only
 * Electron's own allowlist — a relative `require("./ipc.js")` throws, the
 * preload dies before `exposeInMainWorld`, and both windows come up with no
 * `cats` global at all. A const enum makes tsc inline these strings at every
 * use site and emit no import, so the preload stays self-contained while this
 * file remains the only place a channel is named.
 *
 * Consequently: do not add `isolatedModules`, `verbatimModuleSyntax`, or a
 * bundler to the preload build without also giving the preload another way to
 * be self-contained. Any of them stops the inlining, and the failure is a
 * runtime one in a window that has no way to report it.
 *
 * Biome's noConstEnum rule wants a regular enum here, and its fix is not safe
 * to take: a regular enum emits runtime code, which puts `require("./ipc.js")`
 * back into the preload and reintroduces exactly the failure above. The
 * suppression has to sit on the line directly below this comment, because that
 * is the only place Biome reads one from.
 */
// biome-ignore lint/suspicious/noConstEnum: the inlining is the point; see above.
export const enum CHANNELS {
	/** main -> overlay: the desktop changed shape. */
	layout = "cats:layout",
	/** main -> overlay: a fresh pointer sample, window-local. */
	pointer = "cats:pointer",
	/** main -> overlay and settings: the settings changed. */
	settings = "cats:settings",
	/** overlay -> main: the renderer is up and wants the current state. */
	ready = "cats:ready",
	/** settings -> main: change these settings. */
	apply = "cats:apply",
	/** settings -> main (invoke): everything the settings window needs. */
	describe = "cats:describe",
	/**
	 * overlay -> main (invoke): the sprite manifest.
	 *
	 * Passed across rather than fetched by the renderer. Main has to read it
	 * anyway — the settings window needs the palette list — and a missing or
	 * malformed manifest then fails once, at startup, with a message, instead of
	 * inside a renderer that has no way to show one.
	 */
	manifest = "cats:manifest",
}

export type { SpriteManifest };

/** The one-shot payload the settings window builds its form from. */
export interface SettingsDescription {
	settings: Settings;
	/** Palette names that actually exist on disk. */
	palettes: string[];
	/** Where the settings file lives, shown in the window. */
	configPath: string;
	/**
	 * Null when the native addon loaded. Otherwise why it did not, so the user
	 * is told why the cats are ignoring the taskbar instead of guessing.
	 */
	shellError: string | null;
}

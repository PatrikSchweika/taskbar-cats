/**
 * The vocabulary the cat simulation is written in.
 *
 * Nothing here mentions a windowing system. GNOME speaks in Clutter actors and
 * stage pixels, Windows in HWNDs and device pixels; both narrow to these
 * shapes before the simulation sees them, which is what lets one copy of the
 * physics drive both.
 */

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * One app icon on the dock or taskbar, in the coordinate space the cats are
 * positioned in.
 */
export interface IconRect extends Rect {
	/**
	 * Opaque platform identity for this icon, compared only with `===`.
	 *
	 * The simulation holds one of these across ticks (the icon a cat is
	 * clawing) and re-resolves it against the next tick's list. It must never
	 * dereference it: on GNOME the handle is a Clutter actor that the dock can
	 * destroy underneath us, where reading any property is a hard error in GJS.
	 * Reference identity is the only safe operation, so it is the only one used.
	 */
	handle: unknown;
	/**
	 * The icon's size in *logical* pixels, as opposed to `w`/`h` which are in
	 * the positioning space. The two differ by the display's scale factor.
	 */
	logicalSize: number;
}

/** An opaque, platform-specific handle to one drawable animation frame. */
export type FrameHandle = unknown;

/**
 * A source of animation frames.
 *
 * GNOME hands out `Gio.Icon`s backed by St's texture cache; the Windows
 * renderer hands out preloaded `HTMLImageElement`s. The simulation only ever
 * passes them back to a {@link CatView}, so it does not care which.
 */
export interface SpriteSource {
	readonly palettes: readonly string[];
	/** Frames for one animation, falling back to 'idle' for unknown names. */
	frames(palette: string, animation: string): readonly FrameHandle[];
}

/**
 * The surface one cat is drawn on.
 *
 * This is the entire rendering contract: the simulation computes where a cat is
 * and which frame it should show, and pushes that through here once per tick.
 */
export interface CatView {
	/**
	 * Resize the drawn sprite. @param logical size in logical pixels, the way
	 * the settings and the dock's own icon size mean it.
	 */
	setSize(logical: number): void;
	/**
	 * The sprite's actual on-screen height, in the positioning space.
	 *
	 * Differs from the logical size wherever the platform scales UI for a HiDPI
	 * display. Return 0 when it cannot be measured yet — the simulation keeps
	 * using the logical size as a placeholder and asks again next tick.
	 */
	pixelSize(): number;
	/** Show a frame previously obtained from a {@link SpriteSource}. */
	setFrame(frame: FrameHandle): void;
	/**
	 * Place the sprite's top-left corner.
	 * @param facing 1 for right, -1 for left (a horizontal flip).
	 */
	place(x: number, y: number, facing: number): void;
	destroy(): void;
}

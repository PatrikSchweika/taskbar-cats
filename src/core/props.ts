/**
 * Furniture: the beds and scratching posts standing on the floor.
 *
 * A prop is a sprite with a fixed place on the floor that the cats know about —
 * a bed is somewhere to sleep, a post is something to claw. Where they stand is
 * decided here too, by {@link layoutProps}, so both platforms put them in the
 * same place for the same dock.
 */
import type { Cat } from "./cat.js";
import type { CatView, IconRect, SpriteSource } from "./types.js";

export type PropKind = "bed" | "scratcher";

/** How fast a clawed post rocks, relative to the configured frame rate. */
const WOBBLE_RATE_SCALE = 1.3;

interface PropOptions {
	kind: PropKind;
	view: CatView;
	sprites: SpriteSource;
	size: number;
	x: number;
}

export class Prop {
	readonly kind: PropKind;
	readonly view: CatView;
	/** Centre of the prop along the floor, in the positioning space. */
	x: number;
	/** Logical size handed to the view; the same as the cats'. */
	iconSize: number;
	/** On-screen size in the positioning space (see {@link Cat.size}). */
	size: number;
	/** Beds only: the cat that has claimed it, asleep or on its way. */
	occupant: Cat | null = null;

	private readonly _sprites: SpriteSource;
	private _frame = 0;
	private _frameTime = 0;

	constructor({ kind, view, sprites, size, x }: PropOptions) {
		this.kind = kind;
		this.view = view;
		this._sprites = sprites;
		this.iconSize = size;
		this.size = size;
		this.x = x;
		this.view.setSize(size);
		this._syncPixelSize();
		this._applyFrame();
	}

	destroy(): void {
		this.occupant = null;
		this.view.destroy();
	}

	/** @param size logical pixels, as the dock and the prefs dialog mean it. */
	setSize(size: number): void {
		if (size === this.iconSize) return;
		this.iconSize = size;
		this.view.setSize(size);
		this._syncPixelSize();
	}

	private _syncPixelSize(): void {
		const measured = this.view.pixelSize();
		if (measured > 0) this.size = measured;
	}

	private _applyFrame(): void {
		const frames = this._sprites.propFrames(this.kind);
		if (!frames.length) return;
		this.view.setFrame(frames[this._frame % frames.length]);
	}

	/**
	 * Advance one tick.
	 *
	 * @param active true while a cat is using the prop — a post rocks under
	 * the claws; a bed has no animation and ignores it.
	 */
	update(dt: number, floorY: number, fps: number, active: boolean): void {
		this._syncPixelSize();

		if (active) {
			this._frameTime += dt;
			const step = 1 / (fps * WOBBLE_RATE_SCALE);
			if (this._frameTime >= step) {
				this._frameTime -= step;
				this._frame++;
				this._applyFrame();
			}
		} else if (this._frame !== 0) {
			this._frame = 0;
			this._frameTime = 0;
			this._applyFrame();
		}

		// Props stand on the floor exactly as the cats do.
		this.view.place(
			Math.round(this.x - this.size * 0.5),
			Math.round(floorY - this.size),
			1,
		);
	}
}

// -- placement --------------------------------------------------------------

export interface Span {
	min: number;
	max: number;
}

/** The horizontal extent of the dock's icons, or null when there are none. */
export function iconSpan(icons: readonly IconRect[]): Span | null {
	if (!icons.length) return null;
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const icon of icons) {
		min = Math.min(min, icon.x);
		max = Math.max(max, icon.x + icon.w);
	}
	return { min, max };
}

/**
 * Where `count` props should stand.
 *
 * The free floor is the monitor's width minus the dock's icons: a bed in front
 * of the browser icon would hide it, and a cat sleeping on it would block the
 * click. So the props are spread over the stretches to either side of the
 * icons, in proportion to how much room each side has, and evenly within a
 * stretch. With no icons (a dock that has not appeared yet, or a side dock) the
 * whole floor is one stretch.
 *
 * @param size the props' on-screen size; sets the margins.
 * @returns x centres, left to right, one per prop.
 */
export function layoutProps(
	count: number,
	roam: Span,
	icons: Span | null,
	size: number,
): number[] {
	if (count <= 0) return [];
	const margin = size * 0.6;
	const gap = size * 0.5;

	let segments: Span[] = [];
	if (icons)
		segments = [
			{ min: roam.min + margin, max: icons.min - gap },
			{ min: icons.max + gap, max: roam.max - margin },
		].filter((s) => s.max - s.min >= size);
	if (!segments.length)
		segments = [{ min: roam.min + margin, max: roam.max - margin }];

	// Share the props out in proportion to length, largest remainder first, so
	// a wide empty side gets more than a sliver beside the screen edge.
	const lengths = segments.map((s) => Math.max(0, s.max - s.min));
	const total = lengths.reduce((a, b) => a + b, 0) || 1;
	const exact = lengths.map((l) => (count * l) / total);
	const quota = exact.map(Math.floor);
	let left = count - quota.reduce((a, b) => a + b, 0);
	const byRemainder = exact
		.map((e, i) => ({ i, r: e - Math.floor(e) }))
		.sort((a, b) => b.r - a.r || a.i - b.i);
	for (const { i } of byRemainder) {
		if (left <= 0) break;
		quota[i]++;
		left--;
	}

	const out: number[] = [];
	segments.forEach((s, i) => {
		const n = quota[i] ?? 0;
		for (let k = 0; k < n; k++)
			out.push(s.min + ((s.max - s.min) * (k + 1)) / (n + 1));
	});
	return out;
}

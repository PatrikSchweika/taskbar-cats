/**
 * The mouse: prey that turns up now and then and runs along the floor until a
 * cat catches it or it finds its way off the screen.
 *
 * Like a cat it lives in one dimension, feet on the floor. Unlike a cat it has
 * no state machine to speak of: it scurries, it freezes, and when a cat gets
 * close it bolts away from it — into the screen edge if need be, where it has
 * to turn back into the chase. Only once it has been out for a while does an
 * edge become an exit.
 */
import type { CatView, SpriteSource } from "./types.js";

/** Top speed relative to the cats': slower, or they would never catch it. */
export const MOUSE_SPEED = 0.8;
/** How close a cat may come, in cat sizes, before the mouse bolts. */
export const MOUSE_FLEE_RADIUS = 5;
/** Seconds out before the mouse leaves at the next screen edge it reaches. */
export const MOUSE_ESCAPE_AFTER = 12;
/** How fast the run animation plays, relative to the configured frame rate. */
const FRAME_RATE_SCALE = 1.6;
const SCURRY_SPEED = 0.6; // of its top speed, when nothing is chasing it

export interface MouseContext {
	roam: { min: number; max: number };
	floorY: number;
	/** Whatever might eat it; only positions matter. */
	cats: readonly { x: number }[];
	/** The cats' configured top speed, in logical pixels per second. */
	topSpeed: number;
	fps: number;
}

interface MouseOptions {
	view: CatView;
	sprites: SpriteSource;
	size: number;
	x: number;
	/** Which way it sets off: 1 for right, -1 for left. */
	facing: number;
}

export class Mouse {
	readonly view: CatView;
	x: number;
	vx = 0;
	facing: number;
	/** Seconds since it appeared. */
	age = 0;
	/** Set by the cat that got it; the colony removes the mouse after the tick. */
	caught = false;
	/** Set once it has left the screen. */
	gone = false;
	iconSize: number;
	size: number;

	private readonly _sprites: SpriteSource;
	private _dir: number;
	private _dartIn = 0;
	private _frame = 0;
	private _frameTime = 0;

	constructor({ view, sprites, size, x, facing }: MouseOptions) {
		this.view = view;
		this._sprites = sprites;
		this.iconSize = size;
		this.size = size;
		this.x = x;
		this.facing = facing;
		this._dir = facing;
		this.view.setSize(size);
		this._syncPixelSize();
		this._applyFrame();
	}

	destroy(): void {
		this.view.destroy();
	}

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
		const frames = this._sprites.propFrames("mouse");
		if (!frames.length) return;
		this.view.setFrame(frames[this._frame % frames.length]);
	}

	update(dt: number, ctx: MouseContext): void {
		if (this.caught || this.gone) return;
		this._syncPixelSize();
		this.age += dt;

		const half = this.size * 0.5;
		const minX = ctx.roam.min + half;
		const maxX = ctx.roam.max - half;
		// Speeds are logical-pixel settings; positions are in the drawing space.
		const scale = this.iconSize > 0 ? this.size / this.iconSize : 1;
		const topSpeed = ctx.topSpeed * scale * MOUSE_SPEED;

		// --- Anything after me? ---------------------------------------------
		let nearest: { x: number } | null = null;
		for (const cat of ctx.cats)
			if (!nearest || Math.abs(cat.x - this.x) < Math.abs(nearest.x - this.x))
				nearest = cat;
		const threat =
			nearest && Math.abs(nearest.x - this.x) < this.size * MOUSE_FLEE_RADIUS
				? nearest
				: null;

		let speed: number;
		if (threat) {
			// Bolt straight away from it, and keep going.
			const away = Math.sign(this.x - threat.x) || this.facing;
			this._dir = away;
			this._dartIn = 0.4;
			speed = topSpeed;
		} else if (this.age > MOUSE_ESCAPE_AFTER) {
			// Time to go: make for the nearer edge.
			this._dir = this.x - minX < maxX - this.x ? -1 : 1;
			speed = topSpeed;
		} else {
			// Scurry a bit, stop and sniff, scurry on — sometimes the other way.
			this._dartIn -= dt;
			if (this._dartIn <= 0) {
				const roll = Math.random();
				if (roll < 0.3) this._dir = 0;
				else if (roll < 0.5) this._dir = -this._dir || this.facing;
				else this._dir = this._dir || this.facing;
				this._dartIn = 0.4 + Math.random() * 1.2;
			}
			speed = topSpeed * SCURRY_SPEED;
		}

		// --- Move -------------------------------------------------------------
		const desired = this._dir * speed;
		this.vx += (desired - this.vx) * Math.min(1, dt * 14);
		if (Math.abs(this.vx) < 2) this.vx = 0;
		this.x += this.vx * dt;

		if (this.x <= minX || this.x >= maxX) {
			if (this.age > MOUSE_ESCAPE_AFTER) {
				this.gone = true;
				return;
			}
			// Cornered: nothing for it but to run back past the cats.
			this.x = this.x <= minX ? minX : maxX;
			this._dir = this.x <= minX ? 1 : -1;
			this.vx = 0;
		}

		if (Math.abs(this.vx) > 2) this.facing = Math.sign(this.vx);

		// --- Draw -------------------------------------------------------------
		if (Math.abs(this.vx) > 2) {
			this._frameTime += dt;
			const step = 1 / (ctx.fps * FRAME_RATE_SCALE);
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

		this.view.place(
			Math.round(this.x - half),
			Math.round(ctx.floorY - this.size),
			this.facing,
		);
	}
}

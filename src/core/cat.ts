import type { Mouse } from "./mouse.js";
import type { Prop } from "./props.js";
import type { CatView, IconRect, SpriteSource } from "./types.js";

export const State = Object.freeze({
	IDLE: "idle",
	WALK: "walk",
	RUN: "run",
	SIT: "sit",
	ALERT: "alert",
	SCRATCH: "scratch",
	SLEEP: "sleep",
	POUNCE: "pounce",
});

export type CatState = (typeof State)[keyof typeof State];

/** The subset of settings the cats care about. */
export interface CatConfig {
	maxSpeed: number;
	attraction: number;
	attractRadius: number;
	scratchIcons: boolean;
	sleepAfter: number;
	fps: number;
}

export interface CatContext {
	/**
	 * How far the cats may wander. This is the monitor's width, not the dock's:
	 * they are free to leave the dock and roam the whole bottom edge, and are
	 * only drawn back to it by the wander bias.
	 */
	roam: { min: number; max: number };
	/** y the cats' feet rest on — the bottom of the dock's monitor. */
	floorY: number;
	icons: IconRect[];
	pointer: { x: number; y: number; idleTime: number };
	neighbours: Cat[];
	/** Beds on the floor. A sleepy cat claims a free one and curls up in it. */
	beds: readonly Prop[];
	/** Scratching posts on the floor, clawed the way icons are. */
	scratchers: readonly Prop[];
	/** The mouse, if one is out. Every cat drops what it is doing to hunt it. */
	mouse: Mouse | null;
	cfg: CatConfig;
}

// How fast each animation plays, relative to the configured frame rate.
const FRAME_RATE_SCALE: Record<CatState, number> = {
	[State.IDLE]: 0.25,
	[State.WALK]: 1.0,
	[State.RUN]: 1.6,
	[State.SIT]: 0.2,
	[State.ALERT]: 0.2,
	[State.SCRATCH]: 1.3,
	[State.SLEEP]: 0.12,
	// Two frames over the whole pounce: the crouch, then the spring.
	[State.POUNCE]: 0.18,
};

const ARRIVE_PX = 7; // close enough to the target to stop
export const SCRATCH_SECONDS = 1.7;
export const POUNCE_SECONDS = 0.9;
const SCRATCH_COOLDOWN = 4.0;
const FOOT_LIFT = 0; // nudge the feet up off the floor, if a dock needs it
/** How high the bed's cushion lifts a sleeping cat, as a fraction of its size. */
export const BED_LIFT = 0.09;
/** How close a cat has to get, in cat sizes, to catch the mouse. */
const CATCH_REACH = 0.35;
/** How far from a post, in cat sizes, a cat can still claw it. */
const SCRATCHER_REACH = 0.6;
/** Where beside a post a cat stands to claw it, in cat sizes. */
const SCRATCHER_STANCE = 0.35;

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

interface CatOptions {
	view: CatView;
	sprites: SpriteSource;
	palette: string;
	size: number;
	x: number;
	index?: number;
}

/**
 * One cat: a sprite view, a 1D position along the dock, and a state machine.
 *
 * Movement is purely horizontal — the cat's feet always rest on the floor (the
 * bottom of the dock's monitor), so vertical position is derived from the
 * context each frame rather than simulated.
 */
export class Cat {
	readonly view: CatView;
	palette: string;
	index: number;
	/** Logical size handed to the view. */
	iconSize: number;
	/**
	 * On-screen size in the positioning space. Equal to iconSize only at scale
	 * factor 1 — on a HiDPI display the platform allocates more than that, and
	 * every position we set is in that space, so all geometry uses this.
	 */
	size: number;

	x: number;
	vx = 0;
	facing: number;
	state: CatState = State.IDLE;
	stateTime = 0;

	private readonly _sprites: SpriteSource;
	private _frame = 0;
	private _frameTime = 0;
	private _target: number;
	private _wanderIn: number;
	private _scratchIcon: IconRect | null = null;
	private _scratchProp: Prop | null = null;
	private _scratchCooldown = 0;
	private _sitFor = 5;
	private _bed: Prop | null = null;

	constructor({ view, sprites, palette, size, x, index = 0 }: CatOptions) {
		this.view = view;
		this._sprites = sprites;
		this.palette = palette;
		this.iconSize = size;
		this.size = size;
		this.index = index;

		this.x = x;
		this.facing = Math.random() < 0.5 ? -1 : 1;
		this._target = x;
		this._wanderIn = Math.random() * 3;

		this.view.setSize(size);
		this._syncPixelSize();
		this._applyFrame();
	}

	destroy(): void {
		this._scratchIcon = null;
		this._scratchProp = null;
		this._releaseBed();
		this.view.destroy();
	}

	/** @param size logical pixels, as the dock and the prefs dialog mean it. */
	setSize(size: number): void {
		if (size === this.iconSize) return;
		this.iconSize = size;
		this.view.setSize(size);
		this._syncPixelSize();
	}

	/**
	 * Refresh the on-screen size from the view's own measurement, which already
	 * accounts for the scale factor. Asking the view beats multiplying by a
	 * scale factor ourselves — it also picks up any padding a theme adds.
	 */
	private _syncPixelSize(): void {
		// A view cannot always measure itself yet (on GNOME a preferred height
		// needs a theme node, which only exists once the actor is on the
		// stage). Until it can we keep the logical size as a placeholder; the
		// first update() after parenting corrects it.
		const measured = this.view.pixelSize();
		if (measured > 0) this.size = measured;
	}

	/** The dock icon this cat is currently clawing, if any. */
	get scratchTarget(): IconRect | null {
		return this.state === State.SCRATCH ? this._scratchIcon : null;
	}

	/** The scratching post this cat is currently clawing, if any. */
	get scratchingProp(): Prop | null {
		return this.state === State.SCRATCH ? this._scratchProp : null;
	}

	/** The bed this cat has claimed — asleep in it, or on the way. */
	get bed(): Prop | null {
		return this._bed;
	}

	private _setState(next: CatState): void {
		if (next === this.state) return;
		if (this.state === State.SCRATCH) {
			this._scratchIcon = null;
			this._scratchProp = null;
		}
		this.state = next;
		this.stateTime = 0;
		this._frame = 0;
		this._frameTime = 0;
		this._applyFrame();
	}

	private _applyFrame(): void {
		const frames = this._sprites.frames(this.palette, this.state);
		if (!frames.length) return;
		this.view.setFrame(frames[this._frame % frames.length]);
	}

	private _advanceAnimation(dt: number, fps: number): void {
		const rate = fps * (FRAME_RATE_SCALE[this.state] ?? 1);
		if (rate <= 0) return;
		this._frameTime += dt;
		const step = 1 / rate;
		if (this._frameTime < step) return;
		this._frameTime -= step;
		this._frame++;
		this._applyFrame();
	}

	private _iconUnder(icons: IconRect[]): IconRect | null {
		for (const icon of icons) {
			if (this.x >= icon.x && this.x <= icon.x + icon.w) return icon;
		}
		return null;
	}

	private _postInReach(scratchers: readonly Prop[]): Prop | null {
		const reach = this.size * SCRATCHER_REACH;
		return scratchers.find((p) => Math.abs(p.x - this.x) <= reach) ?? null;
	}

	/**
	 * Where to amble to next.
	 *
	 * A fixed bottom dock spans the whole screen while its icons occupy a
	 * fraction of it, so a uniformly random target would leave the cats
	 * wandering empty shelf and almost never reaching anything to scratch.
	 * Most of the time we aim at an actual icon — or a scratching post, which
	 * is the same kind of destination — instead.
	 */
	private _pickWanderTarget(
		icons: IconRect[],
		scratchers: readonly Prop[],
		minX: number,
		maxX: number,
	): number {
		const spots = icons.length + scratchers.length;
		if (spots && Math.random() < 0.7) {
			const pick = Math.floor(Math.random() * spots);
			if (pick < icons.length) {
				const icon = icons[pick];
				const jitter = (Math.random() - 0.5) * icon.w;
				return clamp(icon.x + icon.w * 0.5 + jitter, minX, maxX);
			}
			// Stand beside the post, on whichever side is nearer, facing it.
			const post = scratchers[pick - icons.length];
			const side = Math.sign(this.x - post.x) || 1;
			return clamp(post.x + side * this.size * SCRATCHER_STANCE, minX, maxX);
		}
		return minX + Math.random() * Math.max(1, maxX - minX);
	}

	// -- beds -----------------------------------------------------------------

	/** Take the nearest bed nobody else has, if there is one. */
	private _claimBed(beds: readonly Prop[]): Prop | null {
		let best: Prop | null = null;
		for (const bed of beds) {
			if (bed.occupant && bed.occupant !== this) continue;
			if (!best || Math.abs(bed.x - this.x) < Math.abs(best.x - this.x))
				best = bed;
		}
		if (best) best.occupant = this;
		return best;
	}

	private _releaseBed(): void {
		if (!this._bed) return;
		if (this._bed.occupant === this) this._bed.occupant = null;
		this._bed = null;
	}

	update(dt: number, ctx: CatContext): void {
		const { icons, pointer, neighbours, beds, scratchers, cfg } = ctx;
		// Cheap, and self-corrects if the scale factor changes under us.
		this._syncPixelSize();
		this.stateTime += dt;
		this._scratchCooldown = Math.max(0, this._scratchCooldown - dt);

		// The dock destroys and recreates icon handles whenever the app list
		// changes. Holding one across ticks and then reading a property off it
		// is a hard error on GNOME, so re-resolve against this tick's live list
		// by reference identity (which never touches the handle itself).
		if (this._scratchIcon) {
			const held = this._scratchIcon;
			this._scratchIcon = icons.find((i) => i.handle === held.handle) ?? null;
		}
		// Props are ours, but the settings can remove them between ticks.
		if (this._scratchProp && !scratchers.includes(this._scratchProp))
			this._scratchProp = null;
		if (this._bed && !beds.includes(this._bed)) this._bed = null;

		const half = this.size * 0.5;
		const minX = ctx.roam.min + half;
		const maxX = ctx.roam.max - half;

		// Settings are in logical pixels, the way the settings UI and the dock's
		// own icon size mean them; everything here is in the positioning space.
		// Without this a 2x display halves the attraction radius and the speed.
		const scale = this.iconSize > 0 ? this.size / this.iconSize : 1;
		const attractRadius = cfg.attractRadius * scale;
		const topSpeed = cfg.maxSpeed * scale;

		// --- Is there a mouse? ---------------------------------------------
		// A mouse trumps everything: the pointer is forgotten and sleepers wake.
		const mouse =
			ctx.mouse && !ctx.mouse.caught && !ctx.mouse.gone ? ctx.mouse : null;
		const hunting = mouse !== null && this.state !== State.POUNCE;

		// --- Is the pointer interesting? -----------------------------------
		const attract = cfg.attraction / 100;
		const interested =
			!hunting &&
			attract > 0.05 &&
			pointer.y > ctx.floorY - attractRadius &&
			pointer.y <= ctx.floorY &&
			pointer.x > minX - 200 &&
			pointer.x < maxX + 200;

		const sleepy =
			!mouse && cfg.sleepAfter > 0 && pointer.idleTime > cfg.sleepAfter;

		// --- Somewhere to sleep? -------------------------------------------
		if (sleepy) {
			if (!this._bed) this._bed = this._claimBed(beds);
		} else this._releaseBed();
		const bed = this._bed;
		const bedReached = !bed || Math.abs(bed.x - this.x) <= ARRIVE_PX * 2;

		// --- Pick a target -------------------------------------------------
		if (hunting) {
			this._target = clamp(mouse.x, minX, maxX);
			this._wanderIn = 0.5 + Math.random();
		} else if (interested) {
			// Fan out around the pointer instead of all aiming at the exact
			// same pixel — otherwise the whole colony piles into one stack.
			const count = Math.max(1, neighbours.length);
			const slot = this.index - (count - 1) / 2;
			this._target = clamp(pointer.x + slot * this.size * 0.85, minX, maxX);
			this._wanderIn = 0.5 + Math.random();
		} else if (sleepy) {
			// Asleep: stay where you are — unless there is a bed to get to.
			this._target = bed ? clamp(bed.x, minX, maxX) : this.x;
		} else if (this.state !== State.SCRATCH) {
			this._wanderIn -= dt;
			if (this._wanderIn <= 0) {
				this._wanderIn = 3 + Math.random() * 6;
				this._target = this._pickWanderTarget(icons, scratchers, minX, maxX);
			}
		}

		// Only a scratch or a pounce commits the cat in place. Sitting,
		// watching and even sleeping all yield to somewhere it would rather be,
		// or a cat that once sat down would never get up again.
		const rooted = this.state === State.SCRATCH || this.state === State.POUNCE;

		// --- Steering ------------------------------------------------------
		const speedScale = hunting ? 1 : interested ? 0.4 + 0.6 * attract : 0.55;
		const maxSpeed = topSpeed * speedScale;
		const delta = this._target - this.x;

		let desiredVx = 0;
		if (!rooted && Math.abs(delta) > ARRIVE_PX)
			desiredVx = clamp(delta * 4, -maxSpeed, maxSpeed);

		// Soft separation so cats do not stack on the same pixel.
		for (const other of neighbours) {
			if (other === this) continue;
			const gap = this.x - other.x;
			const room = this.size * 0.95;
			if (Math.abs(gap) < room && Math.abs(gap) > 0.001)
				desiredVx += Math.sign(gap) * (room - Math.abs(gap)) * 3;
		}
		desiredVx = clamp(desiredVx, -topSpeed, topSpeed);

		this.vx += (desiredVx - this.vx) * Math.min(1, dt * 9);
		if (Math.abs(this.vx) < 2) this.vx = 0;
		this.x = clamp(this.x + this.vx * dt, minX, maxX);

		const speed = Math.abs(this.vx);
		if (speed > 6) this.facing = Math.sign(this.vx);

		// --- Got it? -------------------------------------------------------
		if (
			hunting &&
			!rooted &&
			Math.abs(mouse.x - this.x) < this.size * CATCH_REACH
		) {
			mouse.caught = true;
			const dx = mouse.x - this.x;
			if (Math.abs(dx) > 1) this.facing = Math.sign(dx);
			this._setState(State.POUNCE);
		}

		// --- State machine -------------------------------------------------
		if (this.state === State.SCRATCH) {
			// Stay put until the swipe finishes, or the thing goes away.
			const clawing = this._scratchIcon ?? this._scratchProp;
			if (this.stateTime >= SCRATCH_SECONDS || !clawing) {
				this._scratchCooldown = SCRATCH_COOLDOWN;
				this._setState(State.IDLE);
			}
		} else if (this.state === State.POUNCE) {
			if (this.stateTime >= POUNCE_SECONDS) this._setState(State.IDLE);
		} else if (speed > 6) {
			this._setState(speed > topSpeed * 0.5 ? State.RUN : State.WALK);
		} else if (interested && pointer.idleTime < 2.0) {
			// Pointer is hovering right above: sit up and watch it.
			this._setState(State.ALERT);
		} else if (hunting) {
			// Held up — another cat in the way — so sit up and track the mouse.
			this._setState(State.ALERT);
		} else if (sleepy && bedReached) {
			this._setState(State.SLEEP);
		} else if (
			this.state === State.ALERT ||
			this.state === State.SLEEP ||
			this.state === State.WALK ||
			this.state === State.RUN
		) {
			// Whatever we were doing no longer applies.
			this._setState(State.IDLE);
		} else if (this.state === State.SIT && this.stateTime > this._sitFor) {
			this._setState(State.IDLE);
		} else if (this.state === State.IDLE && this.stateTime > 0.6) {
			this._chooseRestingBehaviour(icons, scratchers, cfg, dt);
		}

		// Face whatever we are clawing at.
		if (this.state === State.SCRATCH) {
			const cx = this._scratchIcon
				? this._scratchIcon.x + this._scratchIcon.w * 0.5
				: this._scratchProp?.x;
			if (cx !== undefined && Math.abs(cx - this.x) > 1)
				this.facing = Math.sign(cx - this.x);
		}

		this._advanceAnimation(dt, cfg.fps);
		this._render(ctx.floorY);
	}

	private _chooseRestingBehaviour(
		icons: IconRect[],
		scratchers: readonly Prop[],
		cfg: CatConfig,
		dt: number,
	): void {
		// Probabilities are per second, scaled by the tick length.
		if (this._scratchCooldown <= 0) {
			const post = this._postInReach(scratchers);
			if (post && Math.random() < 0.9 * dt) {
				this._scratchProp = post;
				this._setState(State.SCRATCH);
				return;
			}
			const icon = cfg.scratchIcons ? this._iconUnder(icons) : null;
			if (icon && Math.random() < 0.9 * dt) {
				this._scratchIcon = icon;
				this._setState(State.SCRATCH);
				return;
			}
		}
		if (Math.random() < 0.3 * dt) {
			this._sitFor = 3 + Math.random() * 6;
			this._setState(State.SIT);
		}
	}

	private _render(floorY: number): void {
		// Feet on the floor: the cats walk along the bottom edge of the screen,
		// in front of the dock, rather than perching on its top lip. A cat
		// asleep in a bed sits up on the cushion instead.
		const lift =
			this.state === State.SLEEP && this._bed ? this.size * BED_LIFT : 0;
		this.view.place(
			Math.round(this.x - this.size * 0.5),
			Math.round(floorY - this.size - FOOT_LIFT - lift),
			this.facing,
		);
	}
}

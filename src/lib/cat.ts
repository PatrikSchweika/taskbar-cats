import type Gio from "gi://Gio";
import St from "gi://St";

import type { IconRect, Rect } from "./dockTracker.js";
import type { SpriteSet } from "./sprites.js";

export const State = Object.freeze({
	IDLE: "idle",
	WALK: "walk",
	RUN: "run",
	SIT: "sit",
	ALERT: "alert",
	SCRATCH: "scratch",
	SLEEP: "sleep",
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
	bar: Rect;
	/** y the cats' feet rest on — the bottom of the dock's monitor. */
	floorY: number;
	icons: IconRect[];
	pointer: { x: number; y: number; idleTime: number };
	neighbours: Cat[];
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
};

const ARRIVE_PX = 7; // close enough to the target to stop
const SCRATCH_SECONDS = 1.7;
const SCRATCH_COOLDOWN = 4.0;
const FOOT_LIFT = 0; // nudge the feet up off the floor, if a dock needs it

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

interface CatOptions {
	sprites: SpriteSet;
	palette: string;
	size: number;
	x: number;
	index?: number;
}

/**
 * One cat: a sprite actor, a 1D position along the dock, and a state machine.
 *
 * Movement is purely horizontal — the cat's feet always rest on the floor (the
 * bottom of the dock's monitor), so vertical position is derived from the
 * context each frame rather than simulated.
 */
export class Cat {
	readonly actor: St.Icon;
	palette: string;
	size: number;
	index: number;

	x: number;
	vx = 0;
	facing: number;
	state: CatState = State.IDLE;
	stateTime = 0;

	private readonly _sprites: SpriteSet;
	private _frame = 0;
	private _frameTime = 0;
	private _target: number;
	private _wanderIn: number;
	private _scratchIcon: IconRect | null = null;
	private _scratchCooldown = 0;
	private _sitFor = 5;

	constructor({ sprites, palette, size, x, index = 0 }: CatOptions) {
		this._sprites = sprites;
		this.palette = palette;
		this.size = size;
		this.index = index;

		this.x = x;
		this.facing = Math.random() < 0.5 ? -1 : 1;
		this._target = x;
		this._wanderIn = Math.random() * 3;

		this.actor = new St.Icon({
			style_class: "ubuntu-cats-cat",
			icon_size: size,
			reactive: false, // never intercept clicks meant for the dock
			can_focus: false,
			track_hover: false,
		});
		this.actor.set_pivot_point(0.5, 0.5);
		this._applyFrame();
	}

	destroy(): void {
		this._scratchIcon = null;
		this.actor.destroy();
	}

	setSize(size: number): void {
		if (size === this.size) return;
		this.size = size;
		this.actor.icon_size = size;
	}

	/** The dock icon this cat is currently clawing, if any. */
	get scratchTarget(): IconRect | null {
		return this.state === State.SCRATCH ? this._scratchIcon : null;
	}

	private _setState(next: CatState): void {
		if (next === this.state) return;
		if (this.state === State.SCRATCH) this._scratchIcon = null;
		this.state = next;
		this.stateTime = 0;
		this._frame = 0;
		this._frameTime = 0;
		this._applyFrame();
	}

	private _applyFrame(): void {
		const frames: Gio.Icon[] = this._sprites.frames(this.palette, this.state);
		if (!frames.length) return;
		this.actor.gicon = frames[this._frame % frames.length];
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

	/**
	 * Where to amble to next.
	 *
	 * A fixed bottom dock spans the whole screen while its icons occupy a
	 * fraction of it, so a uniformly random target would leave the cats
	 * wandering empty shelf and almost never reaching anything to scratch.
	 * Most of the time we aim at an actual icon instead.
	 */
	private _pickWanderTarget(
		icons: IconRect[],
		minX: number,
		maxX: number,
	): number {
		if (icons.length && Math.random() < 0.7) {
			const icon = icons[Math.floor(Math.random() * icons.length)];
			const jitter = (Math.random() - 0.5) * icon.w;
			return clamp(icon.x + icon.w * 0.5 + jitter, minX, maxX);
		}
		return minX + Math.random() * Math.max(1, maxX - minX);
	}

	update(dt: number, ctx: CatContext): void {
		const { bar, icons, pointer, neighbours, cfg } = ctx;
		this.stateTime += dt;
		this._scratchCooldown = Math.max(0, this._scratchCooldown - dt);

		// The dock destroys and recreates icon actors whenever the app list
		// changes. Holding one across ticks and then reading a property off it
		// is a hard error in GJS, so re-resolve against this tick's live list
		// by reference identity (which never touches the object itself).
		if (this._scratchIcon) {
			const held = this._scratchIcon;
			this._scratchIcon = icons.find((i) => i.actor === held.actor) ?? null;
		}

		const half = this.size * 0.5;
		const minX = bar.x + half;
		const maxX = bar.x + bar.w - half;

		// --- Is the pointer interesting? -----------------------------------
		const attract = cfg.attraction / 100;
		const interested =
			attract > 0.05 &&
			pointer.y > bar.y - cfg.attractRadius &&
			pointer.y < bar.y + bar.h + 120 &&
			pointer.x > bar.x - 200 &&
			pointer.x < bar.x + bar.w + 200;

		const sleepy = cfg.sleepAfter > 0 && pointer.idleTime > cfg.sleepAfter;

		// --- Pick a target -------------------------------------------------
		if (interested) {
			// Fan out around the pointer instead of all aiming at the exact
			// same pixel — otherwise the whole colony piles into one stack.
			const count = Math.max(1, neighbours.length);
			const slot = this.index - (count - 1) / 2;
			this._target = clamp(pointer.x + slot * this.size * 0.85, minX, maxX);
			this._wanderIn = 0.5 + Math.random();
		} else if (sleepy) {
			this._target = this.x; // asleep: stay where you are
		} else if (this.state !== State.SCRATCH) {
			this._wanderIn -= dt;
			if (this._wanderIn <= 0) {
				this._wanderIn = 3 + Math.random() * 6;
				this._target = this._pickWanderTarget(icons, minX, maxX);
			}
		}

		// Only a scratch commits the cat in place. Sitting, watching and even
		// sleeping all yield to somewhere it would rather be, or a cat that
		// once sat down would never get up again.
		const rooted = this.state === State.SCRATCH;

		// --- Steering ------------------------------------------------------
		const speedScale = interested ? 0.4 + 0.6 * attract : 0.55;
		const maxSpeed = cfg.maxSpeed * speedScale;
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
		desiredVx = clamp(desiredVx, -cfg.maxSpeed, cfg.maxSpeed);

		this.vx += (desiredVx - this.vx) * Math.min(1, dt * 9);
		if (Math.abs(this.vx) < 2) this.vx = 0;
		this.x = clamp(this.x + this.vx * dt, minX, maxX);

		const speed = Math.abs(this.vx);
		if (speed > 6) this.facing = Math.sign(this.vx);

		// --- State machine -------------------------------------------------
		if (this.state === State.SCRATCH) {
			// Stay put until the swipe finishes, or the icon goes away.
			if (this.stateTime >= SCRATCH_SECONDS || !this._scratchIcon) {
				this._scratchCooldown = SCRATCH_COOLDOWN;
				this._setState(State.IDLE);
			}
		} else if (speed > 6) {
			this._setState(speed > cfg.maxSpeed * 0.5 ? State.RUN : State.WALK);
		} else if (interested && pointer.idleTime < 2.0) {
			// Pointer is hovering right above: sit up and watch it.
			this._setState(State.ALERT);
		} else if (sleepy) {
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
			this._chooseRestingBehaviour(icons, cfg, dt);
		}

		// Face whatever we are clawing at.
		if (this.state === State.SCRATCH && this._scratchIcon) {
			const cx = this._scratchIcon.x + this._scratchIcon.w * 0.5;
			if (Math.abs(cx - this.x) > 1) this.facing = Math.sign(cx - this.x);
		}

		this._advanceAnimation(dt, cfg.fps);
		this._render(ctx.floorY);
	}

	private _chooseRestingBehaviour(
		icons: IconRect[],
		cfg: CatConfig,
		dt: number,
	): void {
		// Probabilities are per second, scaled by the tick length.
		const icon =
			cfg.scratchIcons && this._scratchCooldown <= 0
				? this._iconUnder(icons)
				: null;

		if (icon && Math.random() < 0.9 * dt) {
			this._scratchIcon = icon;
			this._setState(State.SCRATCH);
			return;
		}
		if (Math.random() < 0.3 * dt) {
			this._sitFor = 3 + Math.random() * 6;
			this._setState(State.SIT);
		}
	}

	private _render(floorY: number): void {
		// Feet on the floor: the cats walk along the bottom edge of the screen,
		// in front of the dock, rather than perching on its top lip.
		this.actor.set_position(
			Math.round(this.x - this.size * 0.5),
			Math.round(floorY - this.size - FOOT_LIFT),
		);
		this.actor.scale_x = this.facing;
	}
}

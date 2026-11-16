import type { Mouse } from "./mouse.js";
import type { Prop } from "./props.js";
import type { PlayRole } from "./social.js";
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
	/** Play-fighting: reared up, swatting at the cat it tussles with. */
	PLAY: "play",
	/** Grooming the cat it plays with. */
	GROOM: "groom",
	/** Eating from a bowl. */
	EAT: "eat",
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
	/** Seconds after a meal before a cat is hungry again. */
	hungerAfter: number;
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
	/**
	 * Food bowls on the floor. A hungry cat claims a free one with food in it
	 * and eats. Without any, the cats never get hungry.
	 */
	bowls: readonly Prop[];
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
	[State.PLAY]: 1.2,
	[State.GROOM]: 0.5,
	[State.EAT]: 0.6,
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
/** How close two tussling cats get, in cat sizes, before they rear up. */
export const TUSSLE_REACH = 0.7;
/** Where a grooming cat stands from the other one, in cat sizes. */
export const GROOM_GAP = 0.6;
/** How fast a chased cat runs away, as a fraction of top speed. */
export const FLEE_SPEED = 0.8;
/** How long a meal takes. */
export const EAT_SECONDS = 4;
/** How long a hungry cat sits by an empty bowl asking for food. */
export const ASK_SECONDS = 8;
/** How long a cat that asked in vain ignores its hunger before asking again. */
export const ASK_COOLDOWN = 60;
/** Where beside a bowl a cat stands to eat from it, in cat sizes. */
export const BOWL_STANCE = 0.45;

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

/** The states that hold a cat in place until they finish. */
function isRooted(state: CatState): boolean {
	return (
		state === State.SCRATCH ||
		state === State.POUNCE ||
		state === State.PLAY ||
		state === State.GROOM ||
		state === State.EAT
	);
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
	/** The game this cat is in, if any. Set only by the Playground. */
	play: PlayRole | null = null;
	/**
	 * How hungry this cat is: rises from 0 by 1 every `hungerAfter` seconds
	 * while there are bowls, and goes back to 0 after a meal.
	 */
	hunger: number;

	private readonly _sprites: SpriteSource;
	private _palette = "";
	private _frame = 0;
	private _frameTime = 0;
	private _target: number;
	private _wanderIn: number;
	private _scratchIcon: IconRect | null = null;
	private _scratchProp: Prop | null = null;
	private _scratchCooldown = 0;
	private _sitFor = 5;
	private _bed: Prop | null = null;
	private _bowl: Prop | null = null;
	/** Seconds until a cat that asked in vain asks again. */
	private _askCooldown = 0;
	private _interrupted = false;
	/** Cornered while fleeing a chase: dashing past the chaser. */
	private _dashing = false;
	/** Which side the chaser was on when the dash began. */
	private _dashSide = 1;

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
		// Spread out, so the colony does not all get hungry at once.
		this.hunger = Math.random() * 0.5;

		this.view.setSize(size);
		this._syncPixelSize();
		this._applyFrame();
	}

	destroy(): void {
		this._scratchIcon = null;
		this._scratchProp = null;
		this._releaseBed();
		this._releaseBowl();
		this.view.destroy();
	}

	get palette(): string {
		return this._palette;
	}

	/**
	 * A new coat shows at once rather than at the next animation step, which
	 * for a sleeping cat could be most of a second away.
	 */
	set palette(palette: string) {
		if (palette === this._palette) return;
		this._palette = palette;
		this._applyFrame();
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

	/** The bowl this cat has claimed — eating from it, or on the way. */
	get bowl(): Prop | null {
		return this._bowl;
	}

	/** True once hunger reaches 1. Only bowls make a cat hungry. */
	get hungry(): boolean {
		return this.hunger >= 1;
	}

	/** Where this cat is heading along the floor. */
	get target(): number {
		return this._target;
	}

	/** True while a scratch, a pounce, a game or a meal holds the cat in place. */
	get rooted(): boolean {
		return isRooted(this.state);
	}

	/**
	 * Whether, on the last tick, something more important than play had this
	 * cat's attention: a mouse, hunger, the pointer, or sleepiness. A game
	 * ends as soon as either cat is interrupted.
	 */
	get interrupted(): boolean {
		return this._interrupted;
	}

	/**
	 * Whether this cat could start a game: not playing, not busy, just idling
	 * or wandering. A wandering cat cruises fast enough to show RUN, so that
	 * counts too; a hunt or the pointer already counts as `interrupted`.
	 */
	get free(): boolean {
		return (
			!this._interrupted &&
			this.play === null &&
			(this.state === State.IDLE ||
				this.state === State.SIT ||
				this.state === State.WALK ||
				this.state === State.RUN)
		);
	}

	/**
	 * Whether this cat is on its way past `other`: heading that way, bound for
	 * somewhere well beyond it, and not merely following it along.
	 *
	 * Cats walk a single line, so without this the separation below would make
	 * them bounce off each other and keep the colony in the order it started
	 * in for ever. A cat that is passing ignores the one it passes, and vice
	 * versa, so neither is shoved; they overlap for a moment and carry on. Two
	 * cats walking the same way still queue rather than pile up.
	 */
	private _isPassing(other: Cat): boolean {
		if (this.rooted) return false;
		const dir = Math.sign(this._target - this.x);
		const toOther = other.x - this.x;
		if (dir === 0 || Math.sign(toOther) !== dir) return false;
		// Bound for the far side of the other cat, not for this side of it. A
		// target only just beyond still counts: once there, separation resumes
		// and nudges the two apart.
		if (Math.abs(this._target - this.x) <= Math.abs(toOther) + ARRIVE_PX)
			return false;
		// Walking the same way: fall in behind instead.
		if (Math.abs(other.vx) > 6 && Math.sign(other.vx) === dir) return false;
		return true;
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

	// -- bowls ----------------------------------------------------------------

	/**
	 * Take the nearest bowl with food in it that nobody else has, if there is
	 * one.
	 */
	private _claimBowl(bowls: readonly Prop[]): Prop | null {
		let best: Prop | null = null;
		for (const bowl of bowls) {
			if (bowl.food <= 0 || (bowl.eater && bowl.eater !== this)) continue;
			if (!best || Math.abs(bowl.x - this.x) < Math.abs(best.x - this.x))
				best = bowl;
		}
		if (best) best.eater = this;
		return best;
	}

	private _releaseBowl(): void {
		if (!this._bowl) return;
		if (this._bowl.eater === this) this._bowl.eater = null;
		this._bowl = null;
	}

	/** The nearest of `bowls` that `ok` accepts, or null. */
	private _nearestBowl(
		bowls: readonly Prop[],
		ok: (bowl: Prop) => boolean = () => true,
	): Prop | null {
		let best: Prop | null = null;
		for (const bowl of bowls) {
			if (!ok(bowl)) continue;
			if (!best || Math.abs(bowl.x - this.x) < Math.abs(best.x - this.x))
				best = bowl;
		}
		return best;
	}

	update(dt: number, ctx: CatContext): void {
		const { icons, pointer, neighbours, beds, scratchers, bowls, cfg } = ctx;
		// Cheap, and self-corrects if the scale factor changes under us.
		this._syncPixelSize();
		this.stateTime += dt;
		this._scratchCooldown = Math.max(0, this._scratchCooldown - dt);
		this._askCooldown = Math.max(0, this._askCooldown - dt);
		// No bowls, no hunger: the cats are never made to want what is not there.
		if (bowls.length) this.hunger += dt / cfg.hungerAfter;

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
		// A meal whose bowl went away is over, even if another bowl took its
		// place: the cat walks to that one and starts afresh.
		if (this._bowl && !bowls.includes(this._bowl)) {
			this._bowl = null;
			if (this.state === State.EAT) this._setState(State.IDLE);
		}

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

		// --- Hungry? -------------------------------------------------------
		// Outranks the pointer and sleep, so a cat eats first and naps after.
		// A cat that asked at an empty bowl gives up for a while.
		const seekingFood =
			!hunting && this.hungry && bowls.length > 0 && this._askCooldown <= 0;

		// --- Is the pointer interesting? -----------------------------------
		const attract = cfg.attraction / 100;
		const interested =
			!hunting &&
			!seekingFood &&
			attract > 0.05 &&
			pointer.y > ctx.floorY - attractRadius &&
			pointer.y <= ctx.floorY &&
			pointer.x > minX - 200 &&
			pointer.x < maxX + 200;

		const sleepy =
			!mouse &&
			!seekingFood &&
			cfg.sleepAfter > 0 &&
			pointer.idleTime > cfg.sleepAfter;

		// --- Playing? ------------------------------------------------------
		// Every drive above play in the chain. A new drive that outranks play
		// joins this expression, and the Playground then ends the game.
		this._interrupted = hunting || seekingFood || interested || sleepy;
		const play = this._interrupted ? null : this.play;
		if (!play || play.lead) this._dashing = false;

		// --- Somewhere to sleep? -------------------------------------------
		if (sleepy) {
			if (!this._bed) this._bed = this._claimBed(beds);
		} else this._releaseBed();
		const bed = this._bed;
		const bedReached = !bed || Math.abs(bed.x - this.x) <= ARRIVE_PX * 2;

		// --- Something to eat? ---------------------------------------------
		// A meal cut short, by a mouse or the bowl going away, uses no food.
		if (seekingFood) {
			if (!this._bowl) this._bowl = this._claimBowl(bowls);
		} else this._releaseBowl();
		if (this.state === State.EAT && !this._bowl) this._setState(State.IDLE);
		const meal = this._bowl;
		// With no free bowl to eat from, go and wait by the nearest one that
		// has food, or else ask at the nearest one.
		const empty = !bowls.some((b) => b.food > 0);
		const foodBowl = seekingFood
			? (meal ??
				(empty
					? this._nearestBowl(bowls)
					: this._nearestBowl(bowls, (b) => b.food > 0)))
			: null;
		const asking = seekingFood && !meal && empty;

		// --- Pick a target -------------------------------------------------
		if (hunting) {
			this._target = clamp(mouse.x, minX, maxX);
			this._wanderIn = 0.5 + Math.random();
		} else if (foodBowl) {
			// Beside the bowl, on whichever side is nearer.
			const side = Math.sign(this.x - foodBowl.x) || 1;
			this._target = clamp(
				foodBowl.x + side * this.size * BOWL_STANCE,
				minX,
				maxX,
			);
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
		} else if (play) {
			this._target = this._playTarget(play, minX, maxX);
			// Pick somewhere new to go soon after the game.
			this._wanderIn = 0.5 + Math.random();
		} else if (this.state !== State.SCRATCH) {
			this._wanderIn -= dt;
			if (this._wanderIn <= 0) {
				this._wanderIn = 3 + Math.random() * 6;
				this._target = this._pickWanderTarget(icons, scratchers, minX, maxX);
			}
		}

		// Only a scratch, a pounce, a game or a meal commits the cat in place.
		// Sitting, watching and even sleeping all yield to somewhere it would
		// rather be, or a cat that once sat down would never get up again.
		const rooted = isRooted(this.state);

		// --- Steering ------------------------------------------------------
		const speedScale = hunting
			? 1
			: interested
				? 0.4 + 0.6 * attract
				: play?.kind === "chase"
					? play.lead
						? 1
						: FLEE_SPEED
					: 0.55;
		const maxSpeed = topSpeed * speedScale;
		const delta = this._target - this.x;

		let desiredVx = 0;
		if (!rooted && Math.abs(delta) > ARRIVE_PX)
			desiredVx = clamp(delta * 4, -maxSpeed, maxSpeed);

		// Soft separation so cats do not stack on the same pixel — except
		// between a cat and one it is walking past, or they could never swap
		// places.
		for (const other of neighbours) {
			if (other === this || other === this.play?.partner) continue;
			const gap = this.x - other.x;
			const room = this.size * 0.95;
			if (Math.abs(gap) >= room || Math.abs(gap) <= 0.001) continue;
			if (this._isPassing(other) || other._isPassing(this)) continue;
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

		// Standing beside the bowl it is after.
		const foodReached =
			foodBowl !== null && Math.abs(this._target - this.x) <= ARRIVE_PX * 2;

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
		} else if (this.state === State.EAT) {
			if (this.stateTime >= EAT_SECONDS && meal) {
				meal.food = Math.max(0, meal.food - 1);
				this.hunger = 0;
				this._releaseBowl();
				this._setState(State.IDLE);
			}
		} else if (meal && foodReached && speed <= 6) {
			this._setState(State.EAT);
			this._face(meal.x);
		} else if (asking && foodBowl && foodReached && speed <= 6) {
			// Sit up by the empty bowl and look at it, then give up for a while.
			if (this.state === State.ALERT && this.stateTime >= ASK_SECONDS) {
				this._askCooldown = ASK_COOLDOWN;
				this._wanderIn = 0;
				this._setState(State.IDLE);
			} else {
				this._setState(State.ALERT);
				this._face(foodBowl.x);
			}
		} else if (
			play?.kind === "tussle" &&
			(this.state === State.PLAY ||
				Math.abs(play.partner.x - this.x) <= TUSSLE_REACH * this.size)
		) {
			this._setState(State.PLAY);
			this._face(play.partner.x);
		} else if (
			play?.kind === "groom" &&
			play.lead &&
			(this.state === State.GROOM ||
				Math.abs(this._target - this.x) <= ARRIVE_PX)
		) {
			this._setState(State.GROOM);
			this._face(play.partner.x);
		} else if (
			play?.kind === "groom" &&
			!play.lead &&
			speed <= 6 &&
			Math.abs(play.partner.x - this.x) <=
				GROOM_GAP * play.partner.size + ARRIVE_PX
		) {
			// Being groomed: sit still for it, however long it takes.
			this._setState(State.SIT);
			this._face(play.partner.x);
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
			this.state === State.RUN ||
			this.state === State.PLAY ||
			this.state === State.GROOM
		) {
			// Whatever we were doing no longer applies.
			this._setState(State.IDLE);
		} else if (this.state === State.SIT && this.stateTime > this._sitFor) {
			this._setState(State.IDLE);
		} else if (this.state === State.IDLE && this.stateTime > 0.6 && !play) {
			// In a game the game decides; no wandering off to claw something.
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
		// And the bowl we are eating from, even if a neighbour jostles us.
		if (this.state === State.EAT && this._bowl) this._face(this._bowl.x);

		this._advanceAnimation(dt, cfg.fps);
		this._render(ctx.floorY);
	}

	/** Where a game sends this cat. */
	private _playTarget(play: PlayRole, minX: number, maxX: number): number {
		const partner = play.partner;
		const side = Math.sign(partner.x - this.x) || 1;
		switch (play.kind) {
			case "chase": {
				// Aim a little beyond the other cat: aiming at it, the steering
				// would ease off as it closed in and never quite catch it.
				if (play.lead) return clamp(partner.x + side * this.size, minX, maxX);
				// Dash past a chaser that cornered us, until we are past it.
				if (this._dashing) {
					if (side > 0 === this._dashSide > 0)
						return clamp(partner.x + side * 2 * this.size, minX, maxX);
					this._dashing = false;
				}
				const away = clamp(this.x - side * 3 * this.size, minX, maxX);
				if (Math.abs(away - this.x) > ARRIVE_PX) return away;
				this._dashing = true;
				this._dashSide = side;
				return clamp(partner.x + side * 2 * this.size, minX, maxX);
			}
			case "tussle":
				return clamp(partner.x - side * 0.55 * this.size, minX, maxX);
			case "groom":
				if (play.lead)
					return clamp(partner.x - side * GROOM_GAP * this.size, minX, maxX);
				return this.x;
		}
	}

	private _face(x: number): void {
		if (Math.abs(x - this.x) > 1) this.facing = Math.sign(x - this.x);
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

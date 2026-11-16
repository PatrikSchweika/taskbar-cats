/**
 * Recognises the pointer rubbing back and forth over one target.
 *
 * Pure logic, no platform API: feed it the pointer's x every tick along with
 * whatever the pointer is over, and `rubbing` names the target being rubbed.
 * A rub is a few quick direction changes over the same target; a single sweep
 * across it, or tiny jitter, is not.
 */

/** Direction changes needed to count as a rub. */
export const RUB_REVERSALS = 3;
/** The direction changes must all fall within this many seconds. */
export const RUB_WINDOW = 1.2;
/** A stroke must cover at least this fraction of the target's size. */
export const RUB_MIN_STROKE = 0.15;

export class RubDetector {
	private clock = 0;
	private target: object | null = null;
	private extreme = 0;
	private dir: -1 | 0 | 1 = 0;
	private reversals: number[] = [];
	private active = false;

	/** Advance by `dt` seconds with the pointer at `x` over `target` (or null). */
	update(dt: number, x: number, target: object | null, size: number): void {
		this.clock += dt;
		if (target !== this.target) {
			this.reset();
			this.target = target;
			this.extreme = x;
		}
		if (target === null) return;

		const min = RUB_MIN_STROKE * size;
		if (this.dir === 0) {
			if (Math.abs(x - this.extreme) >= min) {
				this.dir = x > this.extreme ? 1 : -1;
				this.extreme = x;
			}
		} else if ((x - this.extreme) * this.dir >= 0) {
			this.extreme = x;
		} else if ((this.extreme - x) * this.dir >= min) {
			this.reversals.push(this.clock);
			this.dir = this.dir === 1 ? -1 : 1;
			this.extreme = x;
		}

		this.reversals = this.reversals.filter((t) => this.clock - t <= RUB_WINDOW);
		if (this.reversals.length >= RUB_REVERSALS) this.active = true;
		else if (this.reversals.length === 0) this.active = false;
	}

	/** The target being rubbed right now, or null. */
	get rubbing(): object | null {
		return this.active ? this.target : null;
	}

	/** Forget everything, including the current target. */
	reset(): void {
		this.target = null;
		this.dir = 0;
		this.reversals = [];
		this.active = false;
	}
}

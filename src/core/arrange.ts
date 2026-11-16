/**
 * Arrange mode's drag logic: picking up a bed, post or bowl and working out
 * where it should stand.
 *
 * Nothing here knows about a pointer device or a window. The platforms feed
 * {@link Arranger} presses, moves and releases in the positioning space and
 * get back a settings patch to save, so GNOME and Windows drag furniture the
 * same way.
 */

import type { Colony } from "./colony.js";
import { propUnderPointer } from "./colony.js";
import { AUTO_POSITION, type Settings } from "./config.js";
import type { Prop, PropKind, Span } from "./props.js";

/** How far the pointer must travel before a press becomes a drag, in px. */
export const DRAG_THRESHOLD = 4;
/** The longest gap between two presses on one prop that counts as a double-click. */
export const DOUBLE_CLICK_SECONDS = 0.4;
/** Arrange mode ends by itself after this long with no press. */
export const ARRANGE_TIMEOUT = 120;

/** The arrange toolbar's hint, on both platforms. */
export const ARRANGE_HINT =
	"Drag the furniture. Double-click one to place it automatically.";
/** The toolbar's hint when there is no furniture to drag. */
export const ARRANGE_EMPTY_HINT = "Add a bed, post or bowl first";

export type PositionList =
	| "bedPositions"
	| "scratcherPositions"
	| "bowlPositions";

/** The settings list that holds where props of each kind stand. */
export const POSITION_LISTS: Readonly<Record<PropKind, PositionList>> = {
	bed: "bedPositions",
	scratcher: "scratcherPositions",
	bowl: "bowlPositions",
};

/** The settings to save after a drop. */
export type PositionPatch = Partial<Pick<Settings, PositionList>>;

/** A position on the floor as a whole percentage: the inverse of `pinnedX`. */
export function percentAt(x: number, roam: Span): number {
	const width = roam.max - roam.min;
	if (width <= 0) return 0;
	const percent = Math.round(((x - roam.min) / width) * 100);
	return Math.min(100, Math.max(0, percent));
}

/** A copy of `list` with `index` set to `value`, padded with automatic slots. */
export function withPosition(
	list: readonly number[],
	index: number,
	value: number,
): number[] {
	const out = [...list];
	while (out.length <= index) out.push(AUTO_POSITION);
	out[index] = value;
	return out;
}

/** The patch that sets every prop back to automatic placement. */
export function resetAllPositions(): PositionPatch {
	return { bedPositions: [], scratcherPositions: [], bowlPositions: [] };
}

export class Arranger {
	private readonly _colony: Colony;
	private _pressed: Prop | null = null;
	private _dragging = false;
	private _pressX = 0;
	private _pressTime = 0;
	/** Pointer to prop centre when it was picked up, so it doesn't jump. */
	private _grabOffset = 0;
	/** The previous click-without-drag, waiting for a partner. */
	private _lastClick: { prop: Prop; time: number } | null = null;
	private _idle = 0;

	constructor(colony: Colony) {
		this._colony = colony;
	}

	/** The prop under a press that hasn't been released yet. */
	get pressed(): Prop | null {
		return this._pressed;
	}

	/** The prop being dragged: only once the pointer has passed the threshold. */
	get dragging(): Prop | null {
		return this._dragging ? this._pressed : null;
	}

	/** @returns true when the press landed on a prop. */
	press(time: number, x: number, y: number, floorY: number): boolean {
		const prop = propUnderPointer(this._colony.props, { x, y }, floorY);
		this._pressed = prop;
		this._dragging = false;
		if (!prop) {
			this._lastClick = null;
			return false;
		}
		// Only a press on the furniture counts as arranging.
		this._idle = 0;
		this._pressX = x;
		this._pressTime = time;
		this._grabOffset = prop.x - x;
		return true;
	}

	move(x: number, roam: Span): void {
		const prop = this._pressed;
		if (!prop) return;
		if (!this._dragging) {
			if (Math.abs(x - this._pressX) <= DRAG_THRESHOLD) return;
			this._dragging = true;
		}
		const half = prop.size * 0.5;
		prop.x = Math.min(
			roam.max - half,
			Math.max(roam.min + half, x + this._grabOffset),
		);
	}

	/**
	 * Finish the press.
	 *
	 * @returns the settings to save: where a dragged prop was dropped, or
	 * automatic placement after a double-click. Null for a plain click.
	 */
	release(time: number, settings: Settings, roam: Span): PositionPatch | null {
		void time;
		const prop = this._pressed;
		const dragged = this._dragging;
		this._pressed = null;
		this._dragging = false;
		// A long drag counts as arranging the whole time it is held.
		if (prop) this._idle = 0;
		if (!prop || !this._colony.props.includes(prop)) {
			this._lastClick = null;
			return null;
		}

		const key = POSITION_LISTS[prop.kind];
		const index = this._colony.props
			.filter((p) => p.kind === prop.kind)
			.indexOf(prop);

		if (dragged) {
			this._lastClick = null;
			return {
				[key]: withPosition(settings[key], index, percentAt(prop.x, roam)),
			};
		}

		const last = this._lastClick;
		if (
			last &&
			last.prop === prop &&
			this._pressTime - last.time <= DOUBLE_CLICK_SECONDS
		) {
			this._lastClick = null;
			return { [key]: withPosition(settings[key], index, AUTO_POSITION) };
		}
		this._lastClick = { prop, time: this._pressTime };
		return null;
	}

	/** Forget any press in progress, leaving the prop where it is. */
	cancel(): void {
		this._pressed = null;
		this._dragging = false;
		this._lastClick = null;
	}

	/**
	 * @returns false once {@link ARRANGE_TIMEOUT} passes with no press on the
	 * furniture. Presses that miss it don't count.
	 */
	tick(dt: number): boolean {
		this._idle += dt;
		return this._idle < ARRANGE_TIMEOUT;
	}
}

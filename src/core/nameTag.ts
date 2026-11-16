/**
 * The name tag: a small label that appears above a cat the pointer rests on.
 *
 * It waits a moment before appearing so sweeping the pointer across the cats
 * does not flash tags, and lingers briefly after the pointer leaves so the
 * name can be read.
 */

import type { Cat } from "./cat.js";
import { resolveCatName } from "./colony.js";
import type { Settings } from "./config.js";
import type { LabelView } from "./types.js";

/** Seconds the pointer must rest on a cat before its tag appears. */
export const NAME_TAG_DELAY = 0.4;
/** Seconds a tag stays after the pointer leaves. */
export const NAME_TAG_LINGER = 0.8;
/** Pixels between the top of the cat and the bottom of the tag. */
export const NAME_TAG_GAP = 2;
/** Longest name shown in full, counted in code points. */
export const NAME_TAG_MAX_CHARS = 24;

/** The name as drawn: plain text, cut short with an ellipsis when long. */
export function tagText(name: string): string {
	const chars = Array.from(name);
	if (chars.length <= NAME_TAG_MAX_CHARS) return name;
	return `${chars.slice(0, NAME_TAG_MAX_CHARS).join("")}…`;
}

export class NameTag {
	private readonly _view: LabelView;
	private _shown: Cat | null = null;
	private _candidate: Cat | null = null;
	private _hoverTime = 0;
	private _linger = 0;

	constructor(view: LabelView) {
		this._view = view;
		view.setVisible(false);
	}

	/** The cat whose tag is on screen, if any. */
	get shownFor(): Cat | null {
		return this._shown;
	}

	update(
		dt: number,
		hovered: Cat | null,
		cats: readonly Cat[],
		floorY: number,
		settings: Pick<Settings, "nameTags" | "catNames">,
	): void {
		if (!settings.nameTags || (this._shown && !cats.includes(this._shown))) {
			this._hide();
			if (!settings.nameTags) return;
		}

		if (hovered) {
			if (this._shown) {
				this._shown = hovered;
				this._linger = NAME_TAG_LINGER;
			} else {
				if (this._candidate !== hovered) {
					this._candidate = hovered;
					this._hoverTime = 0;
				}
				this._hoverTime += dt;
				if (this._hoverTime >= NAME_TAG_DELAY) {
					this._shown = hovered;
					this._linger = NAME_TAG_LINGER;
				}
			}
		} else {
			this._candidate = null;
			this._hoverTime = 0;
			if (this._shown) {
				this._linger -= dt;
				if (this._linger <= 0) this._hide();
			}
		}

		const cat = this._shown;
		if (!cat) return;
		this._view.setText(tagText(resolveCatName(settings, cat.index)));
		this._view.place(cat.x, floorY - cat.size - NAME_TAG_GAP);
		this._view.setVisible(true);
	}

	destroy(): void {
		this._view.destroy();
	}

	private _hide(): void {
		this._shown = null;
		this._candidate = null;
		this._hoverTime = 0;
		this._linger = 0;
		this._view.setVisible(false);
	}
}

import St from "gi://St";

import type { LabelView } from "../../core/types.js";

/**
 * The name tag, drawn as a plain `St.Label`.
 *
 * Never reactive, in arrange mode or out of it: the tag must not catch a click
 * meant for the dock below. Names are user-written, so the text is set as
 * plain text and never parsed as markup.
 */
export class GnomeLabelView implements LabelView {
	readonly actor: St.Label;

	constructor() {
		this.actor = new St.Label({
			style_class: "taskbar-cats-tag",
			reactive: false,
			can_focus: false,
			track_hover: false,
		});
		this.actor.hide();
	}

	setText(text: string): void {
		this.actor.text = text;
	}

	/** Put the bottom centre of the tag at the given stage point. */
	place(centreX: number, bottomY: number): void {
		const [, w] = this.actor.get_preferred_width(-1);
		const [, h] = this.actor.get_preferred_height(-1);
		this.actor.set_position(
			Math.round(centreX - w / 2),
			Math.round(bottomY - h),
		);
	}

	setVisible(visible: boolean): void {
		if (visible) {
			this.actor.show();
			// Above every cat, whatever was added since. Restacking queues a
			// relayout, and this runs every tick the tag is up, so only do it
			// when something actually covers the tag.
			const parent = this.actor.get_parent();
			if (parent && parent.get_last_child() !== this.actor)
				parent.set_child_above_sibling(this.actor, null);
		} else {
			this.actor.hide();
		}
	}

	destroy(): void {
		this.actor.destroy();
	}
}

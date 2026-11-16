import type Clutter from "gi://Clutter";
import St from "gi://St";

const HINT = "Drag the furniture. Double-click one to place it automatically.";
const EMPTY_HINT = "Add a bed, post or bowl first";

export interface ArrangeBarHandlers {
	/** Put every bed, post and bowl back to automatic placement. */
	reset(): void;
	/** Leave arrange mode. */
	done(): void;
}

/**
 * The toolbar that stands above the floor in arrange mode: a hint, **Reset
 * all** and **Done**. Apart from the furniture it is the only thing on the
 * overlay that takes the mouse, and only while arranging.
 */
export class ArrangeBar {
	readonly actor: St.BoxLayout;
	private readonly _hint: St.Label;
	private _empty = false;

	constructor(parent: Clutter.Actor, handlers: ArrangeBarHandlers) {
		this.actor = new St.BoxLayout({
			style_class: "taskbar-cats-arrange-bar",
			reactive: true,
		});
		this._hint = new St.Label({
			style_class: "taskbar-cats-arrange-hint",
			text: HINT,
		});
		this.actor.add_child(this._hint);
		this.actor.add_child(this._button("Reset all", () => handlers.reset()));
		this.actor.add_child(this._button("Done", () => handlers.done()));
		parent.add_child(this.actor);
	}

	/**
	 * Stand the bar centred on `centreX` with its bottom edge at `bottomY`,
	 * in front of any cat added since.
	 */
	place(centreX: number, bottomY: number): void {
		const parent = this.actor.get_parent();
		if (parent && parent.get_last_child() !== this.actor)
			parent.set_child_above_sibling(this.actor, null);
		this.actor.set_position(
			Math.round(centreX - this.actor.width / 2),
			Math.round(bottomY - this.actor.height),
		);
	}

	/** With no furniture there is nothing to drag, so say how to get some. */
	setEmpty(empty: boolean): void {
		if (empty === this._empty) return;
		this._empty = empty;
		this._hint.text = empty ? EMPTY_HINT : HINT;
	}

	destroy(): void {
		this.actor.destroy();
	}

	private _button(label: string, onClick: () => void): St.Button {
		const button = new St.Button({
			style_class: "button taskbar-cats-arrange-button",
			label,
			can_focus: true,
		});
		button.connect("clicked", onClick);
		return button;
	}
}

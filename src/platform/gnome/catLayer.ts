import Clutter from "gi://Clutter";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { GnomeCatView } from "./catView.js";

/**
 * The input-transparent surface the cats are drawn on.
 *
 * Deliberately added with `Main.uiGroup.add_child()` rather than
 * `Main.layoutManager.addChrome()`: chrome participates in struts and input
 * regions, and a cat overlay must affect neither. `reactive: false` here and on
 * every cat means clicks pass straight through to the dock underneath.
 */
export class CatLayer {
	actor: St.Widget;
	private _overviewIds: number[];

	constructor() {
		this.actor = new St.Widget({
			style_class: "taskbar-cats-layer",
			reactive: false,
			// Fixed layout so children honour the positions the cats set.
			layout_manager: new Clutter.FixedLayout(),
		});
		this.actor.set_position(0, 0);
		this.syncSize();

		Main.uiGroup.add_child(this.actor);
		this.raise();

		this._overviewIds = [
			Main.overview.connect("showing", () => this.actor.hide()),
			Main.overview.connect("hidden", () => this.actor.show()),
		];
	}

	syncSize(): void {
		this.actor.set_size(global.stage.width, global.stage.height);
	}

	/**
	 * Keep the cats above the dock. Other extensions can insert chrome above us
	 * at any time, so this is re-applied whenever the dock is rediscovered
	 * rather than only once at startup.
	 */
	raise(): void {
		try {
			Main.uiGroup.set_child_above_sibling(this.actor, null);
		} catch {
			// Not parented yet; the next call will do it.
		}
	}

	/** A view for one more cat, parented into the overlay. */
	createView(): GnomeCatView {
		const view = new GnomeCatView();
		this.actor.add_child(view.actor);
		return view;
	}

	/**
	 * A view for a prop or the mouse, parented *under* every cat so a cat
	 * sleeps on its bed rather than behind it. Clutter paints children in
	 * order, so the bottom of the list is the back.
	 */
	createPropView(): GnomeCatView {
		const view = new GnomeCatView("taskbar-cats-prop");
		this.actor.insert_child_at_index(view.actor, 0);
		return view;
	}

	show(): void {
		this.actor.show();
	}

	hide(): void {
		this.actor.hide();
	}

	destroy(): void {
		for (const id of this._overviewIds) Main.overview.disconnect(id);
		this._overviewIds = [];
		this.actor.destroy();
	}
}

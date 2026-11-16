import Clutter from "gi://Clutter";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import type { CatView } from "../../core/types.js";
import { GnomeCatView } from "./catView.js";
import { GnomeLabelView } from "./labelView.js";

/** Where a press on a piece of furniture landed, in stage pixels. */
export type PressHandler = (x: number, y: number) => void;

const ARRANGING_CLASS = "taskbar-cats-arranging";
const PINNED_CLASS = "taskbar-cats-pinned";

/**
 * The input-transparent surface the cats are drawn on.
 *
 * Deliberately added with `Main.uiGroup.add_child()` rather than
 * `Main.layoutManager.addChrome()`: chrome participates in struts and input
 * regions, and a cat overlay must affect neither. `reactive: false` here and on
 * every cat means clicks pass straight through to the dock underneath.
 *
 * The one exception is arrange mode ({@link setArranging}), when the furniture
 * — and only the furniture — takes presses so it can be dragged. For that
 * span each prop is tracked as chrome with `trackChrome()`: on X11 the stage
 * only receives clicks inside the chrome input region, so a reactive actor
 * that isn't tracked would still pass its clicks to the window underneath.
 * (Wayland picks through the stage and doesn't need it.)
 */
export class CatLayer {
	actor: St.Widget;
	private _overviewIds: number[];
	/** Every live prop view, with its press handler while arranging. */
	private readonly _propViews = new Map<GnomeCatView, number>();
	private _onPress: PressHandler | null = null;

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
	 * A view for a bed, post or bowl, parented *under* every cat so a cat
	 * sleeps on its bed rather than behind it. Clutter paints children in
	 * order, so the bottom of the list is the back.
	 */
	createPropView(): GnomeCatView {
		const view = this.createToyView();
		this._propViews.set(view, 0);
		view.actor.connect("destroy", () => this._propViews.delete(view));
		// Props are rebuilt when a count changes, which can happen mid-arrange.
		if (this._onPress) this._arrange(view, this._onPress);
		return view;
	}

	/**
	 * A view for the mouse toy: drawn like a prop, under the cats, but never
	 * part of arrange mode, so it stays click-through throughout.
	 */
	createToyView(): GnomeCatView {
		const view = new GnomeCatView("taskbar-cats-prop");
		this.actor.insert_child_at_index(view.actor, 0);
		return view;
	}

	/**
	 * The name tag: added last so it is above the cats, and kept out of
	 * `_propViews` so arrange mode never makes it reactive.
	 */
	createLabelView(): GnomeLabelView {
		const view = new GnomeLabelView();
		this.actor.add_child(view.actor);
		return view;
	}

	/**
	 * Let the furniture be dragged, or stop.
	 *
	 * While on, every prop view — including any made later — is reactive,
	 * outlined, in the input region, and hands primary-button presses to
	 * `onPress`, stopping them there so the dock underneath never sees them.
	 * Cats stay click-through. Turning it off undoes all of it.
	 */
	setArranging(on: boolean, onPress?: PressHandler): void {
		for (const view of this._propViews.keys()) this._unarrange(view);
		this._onPress = on ? (onPress ?? (() => {})) : null;
		if (this._onPress)
			for (const view of this._propViews.keys())
				this._arrange(view, this._onPress);
	}

	/** Show which props stand where the user put them. Arrange mode only. */
	markPinned(view: CatView, pinned: boolean): void {
		if (!this._onPress || !(view instanceof GnomeCatView)) return;
		if (!this._propViews.has(view)) return;
		if (pinned) view.actor.add_style_class_name(PINNED_CLASS);
		else view.actor.remove_style_class_name(PINNED_CLASS);
	}

	private _arrange(view: GnomeCatView, onPress: PressHandler): void {
		view.actor.reactive = true;
		view.actor.add_style_class_name(ARRANGING_CLASS);
		const id = view.actor.connect(
			"button-press-event",
			(_actor: Clutter.Actor, event: Clutter.Event) => {
				if (event.get_button() === Clutter.BUTTON_PRIMARY) {
					const [x, y] = event.get_coords();
					onPress(x, y);
				}
				return Clutter.EVENT_STOP;
			},
		);
		this._propViews.set(view, id);
		// A prop destroyed while tracked needs no untracking here: the
		// LayoutManager untracks an actor itself when it is destroyed.
		Main.layoutManager.trackChrome(view.actor, { affectsInputRegion: true });
	}

	private _unarrange(view: GnomeCatView): void {
		const id = this._propViews.get(view);
		if (id) {
			view.actor.disconnect(id);
			Main.layoutManager.untrackChrome(view.actor);
		}
		this._propViews.set(view, 0);
		view.actor.reactive = false;
		view.actor.remove_style_class_name(ARRANGING_CLASS);
		view.actor.remove_style_class_name(PINNED_CLASS);
	}

	show(): void {
		this.actor.show();
	}

	hide(): void {
		this.actor.hide();
	}

	destroy(): void {
		this.setArranging(false);
		for (const id of this._overviewIds) Main.overview.disconnect(id);
		this._overviewIds = [];
		this.actor.destroy();
	}
}

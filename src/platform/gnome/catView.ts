import St from "gi://St";

import type { CatView, FrameHandle } from "../../core/types.js";

/**
 * A cat drawn as an `St.Icon` on the shell's stage.
 *
 * The one platform subtlety worth its own type: St sizes icons in *logical*
 * pixels but Clutter positions them in stage pixels, and on a HiDPI display
 * those differ by the scale factor. Rather than multiply by `scale_factor`
 * ourselves, {@link pixelSize} asks St what it actually allocated — which also
 * picks up any padding the theme adds.
 */
export class GnomeCatView implements CatView {
	readonly actor: St.Icon;

	constructor() {
		this.actor = new St.Icon({
			style_class: "taskbar-cats-cat",
			reactive: false, // never intercept clicks meant for the dock
			can_focus: false,
			track_hover: false,
		});
		this.actor.set_pivot_point(0.5, 0.5);
	}

	setSize(logical: number): void {
		this.actor.icon_size = logical;
	}

	pixelSize(): number {
		// A preferred height needs a theme node, which only exists once the
		// actor is on the stage. 0 tells the caller to keep waiting.
		if (!this.actor.get_stage()) return 0;
		const [, natural] = this.actor.get_preferred_height(-1);
		return natural > 0 ? natural : 0;
	}

	setFrame(frame: FrameHandle): void {
		this.actor.gicon = frame as St.Icon["gicon"];
	}

	place(x: number, y: number, facing: number): void {
		this.actor.set_position(x, y);
		this.actor.scale_x = facing;
	}

	destroy(): void {
		this.actor.destroy();
	}
}

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { GnomeCatView } from "../src/platform/gnome/catView.ts";
import { asFake } from "./support/cast.ts";
import { resetEnv } from "./support/env.ts";

/**
 * The GNOME half of the HiDPI story.
 *
 * The physics tests drive a fake view with an explicit scale factor, which
 * leaves one platform-specific claim untested: that this view really does
 * report what St allocated rather than what it was asked for. That is the
 * regression that once sank half of every cat below the floor on a 2x display,
 * so it gets its own test here.
 */
describe("GnomeCatView", () => {
	beforeEach(() => resetEnv());

	function onStage(view: GnomeCatView): void {
		(
			globalThis as unknown as { stage: { add_child(a: unknown): void } }
		).stage.add_child(view.actor);
	}

	it("cannot measure itself before it is on the stage", () => {
		// Until then the simulation keeps using the logical size.
		const view = new GnomeCatView();
		view.setSize(48);
		assert.equal(view.pixelSize(), 0);
	});

	it("reports the logical size at a 1x scale factor", () => {
		const view = new GnomeCatView();
		onStage(view);
		view.setSize(48);
		assert.equal(view.pixelSize(), 48);
	});

	it("reports what St allocated, not what it was asked for, at 2x", () => {
		resetEnv(2);
		const view = new GnomeCatView();
		onStage(view);
		view.setSize(48);
		assert.equal(view.actor.icon_size, 48, "St is told the logical size");
		assert.equal(view.pixelSize(), 96, "but allocates twice that");
	});

	it("never intercepts a click meant for the dock", () => {
		const view = new GnomeCatView();
		assert.equal(view.actor.reactive, false);
	});

	it("flips horizontally about its centre", () => {
		// A pivot anywhere else makes a turning cat slide sideways.
		const view = new GnomeCatView();
		assert.deepEqual(asFake(view.actor).pivot_point, { x: 0.5, y: 0.5 });

		view.place(10, 20, -1);
		assert.equal(view.actor.x, 10);
		assert.equal(view.actor.y, 20);
		assert.equal(view.actor.scale_x, -1);
	});

	it("destroys its actor", () => {
		const view = new GnomeCatView();
		onStage(view);
		view.destroy();
		assert.equal(asFake(view.actor).destroyed, true);
	});
});

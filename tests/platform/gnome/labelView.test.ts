import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { CatLayer } from "../../../src/platform/gnome/catLayer.ts";
import { GnomeLabelView } from "../../../src/platform/gnome/labelView.ts";
import { asFake } from "../../support/gnome/cast.ts";
import { resetEnv } from "../../support/gnome/env.ts";
import type { Label } from "../../support/gnome/stubs/St.ts";

function sized(view: GnomeLabelView, w: number, h: number): Label {
	const label = asFake(view.actor) as Label;
	label.__setPreferredSize(w, h);
	return label;
}

describe("GnomeLabelView", () => {
	beforeEach(() => resetEnv());

	it("is an unreactive label with the tag style", () => {
		const view = new GnomeLabelView();
		assert.equal(view.actor.reactive, false);
		assert.equal(view.actor.style_class, "taskbar-cats-tag");
		assert.equal(asFake(view.actor).visible, false);
	});

	it("sets plain text, never markup", () => {
		const view = new GnomeLabelView();
		view.setText("<b>x</b>");
		const label = asFake(view.actor) as Label;
		assert.equal(label.text, "<b>x</b>");
		assert.notEqual(label.clutter_text.use_markup, true);
	});

	it("anchors its bottom centre at the given point", () => {
		const view = new GnomeLabelView();
		const label = sized(view, 60, 18);
		view.place(400, 850);
		assert.deepEqual([label.x, label.y], [370, 832]);
	});

	it("raises itself above the cats when shown", () => {
		const layer = new CatLayer();
		const view = layer.createLabelView();
		layer.createView();
		layer.createView();
		const label = asFake(view.actor) as Label;
		assert.notEqual(label.parent?.get_last_child(), label);
		view.setVisible(true);
		assert.equal(label.visible, true);
		assert.equal(label.parent?.get_last_child(), label);
		view.setVisible(false);
		assert.equal(label.visible, false);
	});

	it("stays unreactive in and out of arrange mode", () => {
		const layer = new CatLayer();
		const before = layer.createLabelView();
		layer.setArranging(true, () => {});
		const after = layer.createLabelView();
		assert.equal(before.actor.reactive, false);
		assert.equal(after.actor.reactive, false);
		layer.setArranging(false);
		assert.equal(before.actor.reactive, false);
		assert.equal(after.actor.reactive, false);
	});
});

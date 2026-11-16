import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Cat } from "../../src/core/cat.ts";
import { resolveCatName } from "../../src/core/colony.ts";
import { NAME_TAG_GAP, NameTag, tagText } from "../../src/core/nameTag.ts";
import {
	FakeCatView,
	FakeLabelView,
	fakeSprites,
	makeSettings,
} from "../support/core/harness.ts";

function makeCat(x = 400, index = 0): Cat {
	return new Cat({
		view: new FakeCatView(),
		sprites: fakeSprites(),
		palette: "tabby-orange",
		size: 48,
		x,
		index,
	});
}

const FLOOR = 900;

/** Run the tag for `seconds` in 10 ms ticks. */
function tick(
	tag: NameTag,
	seconds: number,
	hovered: Cat | null,
	cats: readonly Cat[],
	settings = makeSettings(),
): void {
	for (let t = 0; t < Math.round(seconds * 100); t++)
		tag.update(0.01, hovered, cats, FLOOR, settings);
}

describe("tagText", () => {
	it("cuts long names", () => {
		assert.equal(tagText("x".repeat(40)), `${"x".repeat(24)}…`);
	});
	it("shows markup literally", () => {
		assert.equal(tagText("<b>&amp;</b>"), "<b>&amp;</b>");
	});
});

describe("resolveCatName", () => {
	it("uses the cat's name, trimmed, or Cat N", () => {
		const s = makeSettings({ catNames: ["  Miso ", ""] });
		assert.equal(resolveCatName(s, 0), "Miso");
		assert.equal(resolveCatName(s, 1), "Cat 2");
		assert.equal(resolveCatName(s, 4), "Cat 5");
	});
});

describe("NameTag", () => {
	function setup(): { view: FakeLabelView; tag: NameTag; a: Cat; b: Cat } {
		const view = new FakeLabelView();
		return {
			view,
			tag: new NameTag(view),
			a: makeCat(400, 0),
			b: makeCat(700, 1),
		};
	}

	it("appears after 0.4 s of hover, above the cat's head", () => {
		const { view, tag, a } = setup();
		tick(tag, 0.37, a, [a]);
		assert.equal(view.visible, false);
		tick(tag, 0.06, a, [a]);
		assert.equal(view.visible, true);
		assert.equal(view.text, "Cat 1");
		assert.equal(view.centreX, 400);
		assert.equal(view.bottomY, FLOOR - 48 - NAME_TAG_GAP);
		assert.equal(tag.shownFor, a);
	});

	it("restarts the delay when the pointer goes to another cat first", () => {
		const { view, tag, a, b } = setup();
		tick(tag, 0.3, a, [a, b]);
		tick(tag, 0.3, b, [a, b]);
		assert.equal(view.visible, false);
		tick(tag, 0.15, b, [a, b]);
		assert.equal(view.visible, true);
		assert.equal(view.text, "Cat 2");
	});

	it("follows the cat as it moves", () => {
		const { view, tag, a } = setup();
		tick(tag, 0.5, a, [a]);
		a.x = 450;
		tick(tag, 0.02, a, [a]);
		assert.equal(view.centreX, 450);
	});

	it("lingers 0.8 s after the pointer leaves, then hides", () => {
		const { view, tag, a } = setup();
		tick(tag, 0.5, a, [a]);
		tick(tag, 0.7, null, [a]);
		assert.equal(view.visible, true);
		tick(tag, 0.15, null, [a]);
		assert.equal(view.visible, false);
		assert.equal(tag.shownFor, null);
	});

	it("moves straight to another cat while showing, without a new delay", () => {
		const { view, tag, a, b } = setup();
		tick(tag, 0.5, a, [a, b]);
		tick(tag, 0.01, b, [a, b]);
		assert.equal(view.visible, true);
		assert.equal(view.text, "Cat 2");
		assert.equal(view.centreX, 700);
		assert.equal(tag.shownFor, b);
	});

	it("stays hidden when name tags are off, and hides at once when switched off", () => {
		const { view, tag, a } = setup();
		const off = makeSettings({ nameTags: false });
		tick(tag, 1, a, [a], off);
		assert.equal(view.visible, false);
		tick(tag, 0.5, a, [a]);
		assert.equal(view.visible, true);
		tick(tag, 0.01, a, [a], off);
		assert.equal(view.visible, false);
		assert.equal(tag.shownFor, null);
	});

	it("hides the tag when its cat is gone", () => {
		const { view, tag, a } = setup();
		tick(tag, 0.5, a, [a]);
		tick(tag, 0.01, null, []);
		assert.equal(view.visible, false);
	});

	it("destroys its view", () => {
		const { view, tag } = setup();
		tag.destroy();
		assert.equal(view.destroyed, true);
	});
});

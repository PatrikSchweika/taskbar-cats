import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { iconSpan, layoutProps } from "../../src/core/props.ts";
import {
	type FakeCatView,
	makeIcon,
	makeProp,
	shownPropFrame,
} from "../support/core/harness.ts";

describe("iconSpan", () => {
	it("is null with no icons", () => {
		assert.equal(iconSpan([]), null);
	});

	it("covers the leftmost edge to the rightmost edge", () => {
		assert.deepEqual(iconSpan([makeIcon(500), makeIcon(700, 60)]), {
			min: 500,
			max: 760,
		});
	});
});

describe("layoutProps", () => {
	const roam = { min: 0, max: 1200 };

	it("places nothing for a count of zero", () => {
		assert.deepEqual(layoutProps(0, roam, null, 40), []);
	});

	it("spreads evenly across the floor when there is no dock", () => {
		// Margins of 0.6 sizes keep a prop off the very edge of the screen.
		assert.deepEqual(layoutProps(3, roam, null, 40), [312, 600, 888]);
	});

	it("keeps clear of the dock's icons", () => {
		// A bed in front of the browser icon would hide it, and a cat asleep in
		// it would block the click.
		const span = { min: 500, max: 700 };
		const xs = layoutProps(4, roam, span, 40);
		assert.equal(xs.length, 4);
		for (const x of xs)
			assert.ok(x < 480 || x > 720, `${x} is on the dock's icons`);
	});

	it("puts one of each on opposite sides of a centred dock", () => {
		const xs = layoutProps(2, roam, { min: 500, max: 700 }, 40);
		assert.ok(xs[0] < 500, `first at ${xs[0]}`);
		assert.ok(xs[1] > 700, `second at ${xs[1]}`);
	});

	it("gives the roomier side more", () => {
		// A dock hugging the left edge leaves almost nothing on that side.
		const xs = layoutProps(4, roam, { min: 100, max: 200 }, 40);
		assert.equal(xs.length, 4);
		for (const x of xs) assert.ok(x > 200, `${x} squeezed beside the edge`);
	});

	it("falls back to the whole floor when the icons fill the screen", () => {
		const xs = layoutProps(2, roam, { min: 0, max: 1200 }, 40);
		assert.equal(xs.length, 2);
		for (const x of xs) assert.ok(x > 0 && x < 1200);
	});

	it("comes out left to right", () => {
		const xs = layoutProps(5, roam, { min: 400, max: 800 }, 40);
		assert.deepEqual(
			xs,
			[...xs].sort((a, b) => a - b),
		);
	});
});

describe("Prop", () => {
	it("stands on the floor, centred on its position", () => {
		const bed = makeProp("bed", 400, 48);
		bed.update(1 / 30, 900, 12, false);
		const view = bed.view as FakeCatView;
		assert.equal(view.y + bed.size, 900);
		assert.equal(view.x, 400 - 24);
	});

	it("shows its first frame at rest", () => {
		const post = makeProp("scratcher", 400);
		post.update(1 / 30, 900, 12, false);
		assert.equal(shownPropFrame(post), 0);
	});

	it("rocks while a cat is clawing it, and settles afterwards", () => {
		const post = makeProp("scratcher", 400);
		const seen = new Set<number>();
		for (let t = 0; t < 1; t += 1 / 30) {
			post.update(1 / 30, 900, 12, true);
			seen.add(shownPropFrame(post));
		}
		assert.ok(seen.size > 1, "never moved");

		post.update(1 / 30, 900, 12, false);
		assert.equal(shownPropFrame(post), 0);
	});

	it("resizes, keeping its feet down", () => {
		const bed = makeProp("bed", 400, 48);
		bed.setSize(64);
		bed.update(1 / 30, 900, 12, false);
		assert.equal(bed.size, 64);
		assert.equal((bed.view as FakeCatView).y + 64, 900);
	});

	it("destroys its view", () => {
		const bed = makeProp("bed", 400);
		bed.destroy();
		assert.equal((bed.view as FakeCatView).destroyed, true);
	});
});

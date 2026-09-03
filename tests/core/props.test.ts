import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { iconSpan, layoutProps, pinnedX } from "../../src/core/props.ts";
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
		assert.deepEqual(layoutProps(0, roam, [], 40), []);
	});

	it("spreads evenly across the floor when there is no dock", () => {
		// Margins of 0.6 sizes keep a prop off the very edge of the screen.
		assert.deepEqual(layoutProps(3, roam, [], 40), [312, 600, 888]);
	});

	it("keeps clear of the dock's icons", () => {
		// A bed in front of the browser icon would hide it, and a cat asleep in
		// it would block the click.
		const span = { min: 500, max: 700 };
		const xs = layoutProps(4, roam, [span], 40);
		assert.equal(xs.length, 4);
		for (const x of xs)
			assert.ok(x < 480 || x > 720, `${x} is on the dock's icons`);
	});

	it("puts one of each on opposite sides of a centred dock", () => {
		const xs = layoutProps(2, roam, [{ min: 500, max: 700 }], 40);
		assert.ok(xs[0] < 500, `first at ${xs[0]}`);
		assert.ok(xs[1] > 700, `second at ${xs[1]}`);
	});

	it("gives the roomier side more", () => {
		// A dock hugging the left edge leaves almost nothing on that side.
		const xs = layoutProps(4, roam, [{ min: 100, max: 200 }], 40);
		assert.equal(xs.length, 4);
		for (const x of xs) assert.ok(x > 200, `${x} squeezed beside the edge`);
	});

	it("falls back to the whole floor when the icons fill the screen", () => {
		const xs = layoutProps(2, roam, [{ min: 0, max: 1200 }], 40);
		assert.equal(xs.length, 2);
		for (const x of xs) assert.ok(x > 0 && x < 1200);
	});

	it("keeps clear of everything blocked, not just the dock", () => {
		// A pinned bed is an obstacle for the automatic ones, wherever it is.
		const blocked = [
			{ min: 500, max: 700 },
			{ min: 900, max: 940 },
			{ min: 100, max: 140 },
		];
		const xs = layoutProps(6, roam, blocked, 40);
		assert.equal(xs.length, 6);
		for (const x of xs)
			for (const b of blocked)
				assert.ok(x < b.min - 20 || x > b.max + 20, `${x} is on ${b.min}`);
	});

	it("copes with blocked stretches that overlap", () => {
		const xs = layoutProps(
			2,
			roam,
			[
				{ min: 500, max: 700 },
				{ min: 600, max: 800 },
			],
			40,
		);
		assert.equal(xs.length, 2);
		for (const x of xs) assert.ok(x < 480 || x > 820, `${x} is on the dock`);
	});

	it("comes out left to right", () => {
		const xs = layoutProps(5, roam, [{ min: 400, max: 800 }], 40);
		assert.deepEqual(
			xs,
			[...xs].sort((a, b) => a - b),
		);
	});
});

describe("pinnedX", () => {
	const roam = { min: 200, max: 1400 };

	it("is a percentage of the floor from the left edge", () => {
		assert.equal(pinnedX(0, roam, 40), 220, "0% stops at the margin");
		assert.equal(pinnedX(25, roam, 40), 500);
		assert.equal(pinnedX(100, roam, 40), 1380, "100% stops at the margin");
	});

	it("keeps the whole prop on the monitor", () => {
		// Half a prop's width in from each edge, whatever the percentage.
		assert.equal(pinnedX(0, roam, 80), 240);
		assert.equal(pinnedX(100, roam, 80), 1360);
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

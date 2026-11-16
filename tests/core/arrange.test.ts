import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ARRANGE_TIMEOUT,
	Arranger,
	percentAt,
	resetAllPositions,
	withPosition,
} from "../../src/core/arrange.ts";
import { Colony } from "../../src/core/colony.ts";
import type { Settings } from "../../src/core/config.ts";
import { fakeHost, makeBounds, makeSettings } from "../support/core/harness.ts";

const roam = { min: 0, max: 1200 };
const floorY = 900;

function setup(over: Partial<Settings> = {}) {
	const colony = new Colony(fakeHost());
	const settings = makeSettings({ count: 0, beds: 1, ...over });
	colony.sync(settings, [], makeBounds());
	return { colony, settings, arranger: new Arranger(colony) };
}

describe("percentAt", () => {
	it("rounds and clamps to 0-100", () => {
		assert.equal(percentAt(120, roam), 10);
		assert.equal(percentAt(126, roam), 11);
		assert.equal(percentAt(-50, roam), 0);
		assert.equal(percentAt(5000, roam), 100);
	});
});

describe("withPosition", () => {
	it("pads with automatic slots", () => {
		assert.deepEqual(withPosition([], 2, 40), [-1, -1, 40]);
	});

	it("returns a copy", () => {
		const list = [10, 20];
		assert.deepEqual(withPosition(list, 0, -1), [-1, 20]);
		assert.deepEqual(list, [10, 20]);
	});
});

describe("resetAllPositions", () => {
	it("empties all three lists", () => {
		assert.deepEqual(resetAllPositions(), {
			bedPositions: [],
			scratcherPositions: [],
			bowlPositions: [],
		});
	});
});

describe("Arranger", () => {
	it("a press on bare floor is not a press", () => {
		const { arranger } = setup();
		assert.equal(arranger.press(0, 5, floorY - 10, floorY), false);
		assert.equal(arranger.pressed, null);
		assert.equal(arranger.dragging, null);
	});

	it("a click without a drag changes nothing", () => {
		const { colony, settings, arranger } = setup();
		const bed = colony.props[0];
		const x = bed.x;
		assert.equal(arranger.press(0, x, floorY - 10, floorY), true);
		assert.equal(arranger.pressed, bed);
		arranger.move(x + 3, roam);
		assert.equal(arranger.dragging, null);
		assert.equal(arranger.release(0.1, settings, roam), null);
		assert.equal(bed.x, x);
	});

	it("dragging a bed pins it where it is dropped", () => {
		const { colony, settings, arranger } = setup({ beds: 2 });
		const bed = colony.props[1];
		const old = bed.x;
		arranger.press(0, old + 10, floorY - 10, floorY);
		arranger.move(old + 250, roam);
		assert.equal(arranger.dragging, bed);
		assert.equal(bed.x, old + 240);
		assert.deepEqual(arranger.release(0.5, settings, roam), {
			bedPositions: withPosition([], 1, percentAt(bed.x, roam)),
		});
		assert.equal(arranger.pressed, null);
	});

	it("writes the list for the prop's own kind", () => {
		const { colony, settings, arranger } = setup({ beds: 0, bowls: 1 });
		const bowl = colony.props[0];
		arranger.press(0, bowl.x, floorY - 10, floorY);
		arranger.move(bowl.x + 100, roam);
		const patch = arranger.release(0.5, settings, roam);
		assert.deepEqual(Object.keys(patch ?? {}), ["bowlPositions"]);
	});

	it("keeps the dragged prop on the floor", () => {
		const { colony, settings, arranger } = setup();
		const prop = colony.props[0];
		arranger.press(0, prop.x, floorY - 10, floorY);
		arranger.move(99999, roam);
		assert.equal(prop.x, 1200 - prop.size * 0.5);
		const patch = arranger.release(0.5, settings, roam);
		assert.ok((patch?.bedPositions?.[0] ?? 999) <= 100);
	});

	it("double-clicking sets a prop back to automatic", () => {
		const { colony, settings, arranger } = setup({ bedPositions: [25] });
		const x = colony.props[0].x;
		const click = (t: number) => {
			arranger.press(t, x, floorY - 10, floorY);
			return arranger.release(t + 0.05, settings, roam);
		};
		assert.equal(click(0), null);
		assert.deepEqual(click(0.3), { bedPositions: [-1] });
		assert.equal(click(0.6), null, "a third click starts fresh");

		assert.equal(click(10), null);
		assert.equal(click(10.6), null, "too slow");
	});

	it("drops a drag whose prop was rebuilt", () => {
		const { colony, settings, arranger } = setup();
		const bed = colony.props[0];
		arranger.press(0, bed.x, floorY - 10, floorY);
		arranger.move(bed.x + 50, roam);
		colony.sync(makeSettings({ count: 0, beds: 3 }), [], makeBounds());
		assert.equal(arranger.release(0.5, settings, roam), null);
		assert.equal(arranger.pressed, null);
	});

	it("ends after 120 s without a press", () => {
		const { colony, settings, arranger } = setup();
		assert.equal(ARRANGE_TIMEOUT, 120);
		assert.equal(arranger.tick(119), true);
		arranger.press(0, colony.props[0].x, floorY - 10, floorY);
		arranger.release(0.1, settings, roam);
		assert.equal(arranger.tick(119), true);
		assert.equal(arranger.tick(2), false);
	});
});

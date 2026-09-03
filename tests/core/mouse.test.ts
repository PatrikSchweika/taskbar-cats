import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	MOUSE_ESCAPE_AFTER,
	type Mouse,
	type MouseContext,
} from "../../src/core/mouse.ts";
import {
	type FakeCatView,
	makeMouse,
	shownPropFrame,
	withRandom,
} from "../support/core/harness.ts";

function makeContext(over: Partial<MouseContext> = {}): MouseContext {
	return {
		roam: { min: 0, max: 1600 },
		floorY: 900,
		cats: [],
		topSpeed: 220,
		fps: 12,
		...over,
	};
}

function run(mouse: Mouse, ctx: MouseContext, seconds: number): void {
	for (let t = 0; t < seconds; t += 1 / 30) mouse.update(1 / 30, ctx);
}

describe("Mouse", () => {
	it("runs along the floor", () => {
		const mouse = makeMouse(800, 1);
		// 0.9 keeps it scurrying the way it is facing rather than pausing.
		withRandom([0.9], () => run(mouse, makeContext(), 2));
		const view = mouse.view as FakeCatView;
		assert.ok(mouse.x > 850, `only got to ${mouse.x}`);
		assert.equal(view.y + mouse.size, 900, "feet on the floor");
		assert.equal(view.facing, 1);
	});

	it("is slower than a cat at full stretch", () => {
		const mouse = makeMouse(100, 1);
		withRandom([0.9], () => run(mouse, makeContext({ topSpeed: 220 }), 1));
		assert.ok(mouse.x - 100 < 220, `covered ${mouse.x - 100}px in a second`);
	});

	it("bolts away from a cat that comes close", () => {
		const mouse = makeMouse(800, 1);
		run(mouse, makeContext({ cats: [{ x: 850 }] }), 1);
		assert.ok(mouse.x < 700, `did not flee, at ${mouse.x}`);
		assert.equal(mouse.facing, -1);
	});

	it("turns back at the edge while it is still fresh", () => {
		// Cornered against the screen edge, it has to run back past the cat.
		const mouse = makeMouse(100, -1);
		run(mouse, makeContext({ cats: [{ x: 200 }] }), 1.5);
		assert.equal(mouse.gone, false);
		assert.ok(mouse.x >= mouse.size / 2, `escaped the screen at ${mouse.x}`);

		const cornered = mouse.x;
		run(mouse, makeContext({ cats: [] }), 0.3);
		assert.ok(mouse.x > cornered, "did not turn round");
	});

	it("leaves at the edge once it has been out long enough", () => {
		const mouse = makeMouse(100, -1);
		mouse.age = MOUSE_ESCAPE_AFTER + 1;
		run(mouse, makeContext(), 3);
		assert.equal(mouse.gone, true);
	});

	it("heads for the nearer edge when its time is up", () => {
		const mouse = makeMouse(1400, -1);
		mouse.age = MOUSE_ESCAPE_AFTER + 1;
		run(mouse, makeContext(), 0.5);
		assert.ok(mouse.x > 1400, `went the long way, to ${mouse.x}`);
	});

	it("stops dead once caught", () => {
		const mouse = makeMouse(800, 1);
		mouse.caught = true;
		run(mouse, makeContext(), 1);
		assert.equal(mouse.x, 800);
	});

	it("animates its legs while running", () => {
		const mouse = makeMouse(800, 1);
		const frames = new Set<number>();
		withRandom([0.9], () => {
			for (let t = 0; t < 1; t += 1 / 30) {
				mouse.update(1 / 30, makeContext());
				frames.add(shownPropFrame(mouse));
			}
		});
		assert.ok(frames.size > 1, `stuck on frame ${[...frames]}`);
	});

	it("stands on the floor at a 2x scale factor", () => {
		const mouse = makeMouse(800, 1, 24);
		(mouse.view as FakeCatView).scale = 2;
		run(mouse, makeContext(), 0.1);
		assert.equal(mouse.size, 48);
		assert.equal((mouse.view as FakeCatView).y + 48, 900);
	});
});

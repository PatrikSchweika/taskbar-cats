import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RubDetector } from "../../src/core/rub.ts";

/** Feed the detector one x per 1/30 s tick, all over `target`. */
function feed(
	d: RubDetector,
	target: object | null,
	xs: number[],
	size = 48,
): void {
	for (const x of xs) d.update(1 / 30, x, target, size);
}
/** Back and forth between a and b, `strokes` times, 6 ticks per stroke. */
function rub(a: number, b: number, strokes: number): number[] {
	const out: number[] = [];
	for (let s = 0; s < strokes; s++)
		for (let i = 1; i <= 6; i++) {
			const t = i / 6;
			out.push(s % 2 === 0 ? a + (b - a) * t : b + (a - b) * t);
		}
	return out;
}

describe("RubDetector", () => {
	const cat = {};
	it("recognises three direction changes over one target within 1.2 s", () => {
		const d = new RubDetector();
		feed(d, cat, rub(100, 120, 4)); // 4 strokes = 3 reversals, 0.8 s
		assert.equal(d.rubbing, cat);
	});
	it("a single sweep across the target is not a rub", () => {
		const d = new RubDetector();
		feed(
			d,
			cat,
			Array.from({ length: 30 }, (_, i) => 80 + i * 2),
		);
		assert.equal(d.rubbing, null);
	});
	it("ignores strokes shorter than 15% of the target's size", () => {
		const d = new RubDetector();
		feed(d, cat, rub(100, 106, 8), 48); // 6 px < 7.2 px
		assert.equal(d.rubbing, null);
	});
	it("does not count reversals spread over more than 1.2 s", () => {
		const d = new RubDetector();
		// Each stroke takes 0.8 s, so the three reversals span ~1.6 s.
		const slow = rub(100, 120, 4).flatMap((x) => [x, x, x, x]);
		feed(d, cat, slow);
		assert.equal(d.rubbing, null);
	});
	it("starts over when the pointer moves to another target", () => {
		const d = new RubDetector();
		feed(d, cat, rub(100, 120, 3));
		feed(d, {}, rub(120, 100, 2));
		assert.equal(d.rubbing, null);
	});
	it("keeps rubbing while strokes continue and stops 1.2 s after the last", () => {
		const d = new RubDetector();
		feed(d, cat, rub(100, 120, 8));
		assert.equal(d.rubbing, cat);
		// The last reversal came ~0.1–0.2 s before the final stroke ended.
		feed(d, cat, Array(20).fill(100)); // +0.67 s: still within 1.2 s
		assert.equal(d.rubbing, cat);
		feed(d, cat, Array(30).fill(100)); // +1.0 s more: well past it
		assert.equal(d.rubbing, null);
	});
	it("forgets everything when the pointer leaves every target", () => {
		const d = new RubDetector();
		feed(d, cat, rub(100, 120, 4));
		d.update(1 / 30, 500, null, 48);
		assert.equal(d.rubbing, null);
	});
});

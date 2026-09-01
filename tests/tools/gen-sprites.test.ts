/**
 * The sprite generator was ported from Python, and the committed frames were
 * produced by the original. These pin the two numeric conventions that differ
 * between the languages: get either wrong and every frame shifts by a pixel.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pyInt, pyRound } from "../../tools/gen-sprites.ts";

describe("Python numeric semantics", () => {
	describe("pyRound", () => {
		it("rounds halves to even, unlike Math.round", () => {
			assert.equal(pyRound(0.5), 0);
			assert.equal(pyRound(1.5), 2);
			assert.equal(pyRound(2.5), 2);
			assert.equal(pyRound(3.5), 4);
			// the whole point: Math.round would give 1, 2, 3, 4
			assert.notEqual(pyRound(2.5), Math.round(2.5));
		});

		it("rounds negative halves to even too", () => {
			assert.equal(pyRound(-0.5), 0);
			assert.equal(pyRound(-1.5), -2);
			assert.equal(pyRound(-2.5), -2);
		});

		it("rounds ordinary values the usual way", () => {
			assert.equal(pyRound(0.4), 0);
			assert.equal(pyRound(0.6), 1);
			assert.equal(pyRound(-0.4), 0);
			assert.equal(pyRound(-0.6), -1);
			assert.equal(pyRound(7), 7);
		});
	});

	describe("pyInt", () => {
		it("truncates towards zero, unlike Math.floor", () => {
			assert.equal(pyInt(1.9), 1);
			assert.equal(pyInt(-1.9), -1);
			assert.notEqual(pyInt(-1.9), Math.floor(-1.9));
			assert.equal(pyInt(0), 0);
		});
	});
});

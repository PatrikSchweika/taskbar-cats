import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripHeight } from "../../../src/platform/win32/strip.ts";

describe("stripHeight", () => {
	it("leaves room for a name tag above the largest cat", () => {
		assert.equal(stripHeight(48, 1080), 48 + 128 + 24 + 24);
	});
	it("never exceeds the monitor", () => {
		assert.equal(stripHeight(48, 150), 150);
	});
});

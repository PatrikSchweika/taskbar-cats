import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	eachPropFrame,
	FrameTable,
	isSpriteManifest,
	parseManifest,
	propFramePath,
} from "../../src/core/sprites.ts";

const MANIFEST = {
	palettes: ["a", "b"],
	animations: { idle: 2, walk: 1 },
	props: { bed: 1, mouse: 2 },
};

describe("sprite manifest", () => {
	it("accepts a manifest with props", () => {
		assert.equal(isSpriteManifest(MANIFEST), true);
	});

	it("still accepts a manifest from before there were props", () => {
		// An older install simply has no furniture for the cats to use.
		const { palettes, animations } = MANIFEST;
		assert.equal(isSpriteManifest({ palettes, animations }), true);
	});

	it("rejects props that are not frame counts", () => {
		assert.equal(
			isSpriteManifest({ ...MANIFEST, props: { bed: "one" } }),
			false,
		);
	});

	it("parses from text and names the file when it cannot", () => {
		assert.deepEqual(
			parseManifest(JSON.stringify(MANIFEST), "m.json"),
			MANIFEST,
		);
		assert.throws(() => parseManifest("{", "m.json"), /m\.json is not valid/);
		assert.throws(
			() => parseManifest('{"palettes":[]}', "m.json"),
			/m\.json is not a sprite manifest/,
		);
	});

	it("lists every prop frame", () => {
		assert.deepEqual(
			[...eachPropFrame(MANIFEST)],
			[
				{ name: "bed", frame: 0 },
				{ name: "mouse", frame: 0 },
				{ name: "mouse", frame: 1 },
			],
		);
	});

	it("keeps the prop frames in their own directory", () => {
		assert.equal(propFramePath("mouse", 1), "props/mouse_1.svg");
	});
});

describe("FrameTable", () => {
	it("loads prop frames alongside the cats'", () => {
		const loaded: string[] = [];
		const table = new FrameTable(MANIFEST, (path) => {
			loaded.push(path);
			return path;
		});
		assert.deepEqual(table.propFrames("mouse"), [
			"props/mouse_0.svg",
			"props/mouse_1.svg",
		]);
		assert.deepEqual(table.frames("a", "idle"), [
			"a/idle_0.svg",
			"a/idle_1.svg",
		]);
		assert.equal(loaded.length, 2 * 3 + 3, "every frame loaded exactly once");
	});

	it("hands out nothing for a prop it does not have", () => {
		// Unlike an unknown cat animation, which falls back to idle: a missing
		// bed should not be drawn as a mouse.
		const table = new FrameTable(MANIFEST, (path) => path);
		assert.deepEqual(table.propFrames("scratcher"), []);
	});

	it("copes with a manifest that has no props at all", () => {
		const { palettes, animations } = MANIFEST;
		const table = new FrameTable({ palettes, animations }, (path) => path);
		assert.deepEqual(table.propFrames("bed"), []);
		assert.deepEqual(table.props, {});
	});
});

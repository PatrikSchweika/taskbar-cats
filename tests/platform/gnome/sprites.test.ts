import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SpriteSet } from "../../../src/platform/gnome/sprites.ts";

const SRC = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"src",
);

describe("SpriteSet", () => {
	it("loads the generated manifest", () => {
		const set = new SpriteSet(SRC);
		assert.ok(set.palettes.length >= 1);
		assert.ok(set.palettes.includes("tabby-orange"));
		for (const animation of [
			"idle",
			"walk",
			"run",
			"sit",
			"scratch",
			"sleep",
			"pounce",
		])
			assert.ok(set.animations[animation] >= 1, `missing ${animation}`);
	});

	it("hands out one icon per frame, pointing at the right file", () => {
		const set = new SpriteSet(SRC);
		const frames = set.frames("tabby-orange", "walk");
		assert.equal(frames.length, set.animations.walk);
		const paths = frames.map((f) => (f as unknown as { path: string }).path);
		assert.ok(paths[0].endsWith("tabby-orange/walk_0.svg"), paths[0]);
		assert.equal(new Set(paths).size, paths.length, "frames must be distinct");
	});

	it("hands out the prop frames too", () => {
		const set = new SpriteSet(SRC);
		const bed = set.propFrames("bed");
		assert.equal(bed.length, 1);
		assert.ok(
			(bed[0] as unknown as { path: string }).path.endsWith("props/bed_0.svg"),
		);
		assert.equal(set.propFrames("mouse").length, 2);
		assert.equal(set.propFrames("scratcher").length, 2);
	});

	it("falls back to idle for an animation it does not have", () => {
		const set = new SpriteSet(SRC);
		const fallback = set.frames("tabby-orange", "moonwalk");
		assert.deepEqual(fallback, set.frames("tabby-orange", "idle"));
	});

	it("returns nothing for a palette it does not have", () => {
		assert.deepEqual(new SpriteSet(SRC).frames("chartreuse", "walk"), []);
	});

	describe("resolvePalettes", () => {
		it("keeps only palettes that exist", () => {
			const set = new SpriteSet(SRC);
			assert.deepEqual(set.resolvePalettes(["black", "chartreuse"]), ["black"]);
		});

		it("treats an empty choice as 'all of them'", () => {
			const set = new SpriteSet(SRC);
			assert.deepEqual(set.resolvePalettes([]), set.palettes);
		});

		it("falls back to all when nothing requested is valid", () => {
			const set = new SpriteSet(SRC);
			assert.deepEqual(set.resolvePalettes(["nope"]), set.palettes);
		});
	});

	it("fails loudly when the assets are missing", () => {
		assert.throws(
			() => new SpriteSet("/nonexistent/path"),
			/cannot read .*manifest\.json/,
		);
	});
});

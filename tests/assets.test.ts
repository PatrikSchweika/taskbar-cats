/**
 * Invariants of the generated art. These guard the sprite generator, which is
 * the only place the cats' geometry is decided.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CATS = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"src",
	"assets",
	"cats",
);
const manifest = JSON.parse(
	readFileSync(join(CATS, "manifest.json"), "utf8"),
) as { palettes: string[]; animations: Record<string, number> };

const GRID = 32;

interface Rect {
	x: number;
	y: number;
	w: number;
}

function paintedRects(svg: string): Rect[] {
	const out: Rect[] = [];
	const re = /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1"\/>/g;
	for (const m of svg.matchAll(re))
		out.push({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]) });
	return out;
}

function everyFrame(): { name: string; svg: string }[] {
	const frames: { name: string; svg: string }[] = [];
	for (const palette of manifest.palettes)
		for (const [animation, count] of Object.entries(manifest.animations))
			for (let i = 0; i < count; i++) {
				const name = `${palette}/${animation}_${i}.svg`;
				frames.push({ name, svg: readFileSync(join(CATS, name), "utf8") });
			}
	return frames;
}

describe("generated sprites", () => {
	it("has every frame the manifest promises", () => {
		for (const palette of manifest.palettes)
			for (const [animation, count] of Object.entries(manifest.animations))
				for (let i = 0; i < count; i++) {
					const file = join(CATS, palette, `${animation}_${i}.svg`);
					assert.ok(existsSync(file), `missing ${file}`);
				}
	});

	it("has no stray frames the manifest does not know about", () => {
		const expected = Object.entries(manifest.animations).reduce(
			(n, [, count]) => n + count,
			0,
		);
		for (const palette of manifest.palettes) {
			const files = readdirSync(join(CATS, palette)).filter((f) =>
				f.endsWith(".svg"),
			);
			assert.equal(files.length, expected, `${palette} has ${files.length}`);
		}
	});

	it("draws every frame on the same 32x32 grid", () => {
		for (const { name, svg } of everyFrame()) {
			assert.match(svg, /viewBox="0 0 32 32"/, name);
			for (const r of paintedRects(svg)) {
				assert.ok(r.x >= 0 && r.x + r.w <= GRID, `${name}: x out of grid`);
				assert.ok(r.y >= 0 && r.y < GRID, `${name}: y out of grid`);
			}
		}
	});

	it("keeps the art clear of the left, right and top edges", () => {
		// The generator enforces this so tails are never clipped; if it ever
		// regresses the cats lose limbs at the frame border.
		for (const { name, svg } of everyFrame()) {
			for (const r of paintedRects(svg)) {
				assert.notEqual(r.x, 0, `${name}: touches the left edge`);
				assert.notEqual(r.x + r.w, GRID, `${name}: touches the right edge`);
				assert.notEqual(r.y, 0, `${name}: touches the top edge`);
			}
		}
	});

	it("puts the feet on the bottom row, so cats stand on the floor", () => {
		// Placement assumes the lowest painted pixel is the last row; a gap here
		// would make every cat hover.
		for (const { name, svg } of everyFrame()) {
			const lowest = Math.max(...paintedRects(svg).map((r) => r.y));
			assert.equal(lowest, GRID - 1, `${name}: lowest pixel at ${lowest}`);
		}
	});

	it("actually paints something in every frame", () => {
		for (const { name, svg } of everyFrame())
			assert.ok(paintedRects(svg).length > 20, `${name} looks empty`);
	});
});

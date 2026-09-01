import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inflateSync } from "node:zlib";
import {
	encodeIco,
	encodePng,
	iconGrid,
	rasterise,
} from "../tools/gen-icons.ts";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The PNG and ICO writers are hand-rolled, so they are tested by reading their
 * output back rather than by trusting that `file` recognised it once.
 */
describe("gen-icons", () => {
	describe("rasterise", () => {
		it("scales the grid by repeating pixels", () => {
			const { grid, palette } = iconGrid();
			const at1 = rasterise(grid, palette, 1);
			const at4 = rasterise(grid, palette, 4);

			assert.equal(at1.width, grid.length);
			assert.equal(at4.width, grid.length * 4);
			assert.equal(at4.pixels.length, at4.width * at4.height * 4);

			// Every pixel of a 4x4 block comes from the same source cell.
			for (let dy = 0; dy < 4; dy++) {
				for (let dx = 0; dx < 4; dx++) {
					const source = 0;
					const scaled = (dy * at4.width + dx) * 4;
					assert.deepEqual(
						[...at4.pixels.subarray(scaled, scaled + 4)],
						[...at1.pixels.subarray(source, source + 4)],
					);
				}
			}
		});

		it("leaves transparent cells fully transparent", () => {
			const { grid, palette } = iconGrid();
			const { pixels } = rasterise(grid, palette, 1);
			// The top-left corner is border, which the generator keeps clear.
			assert.equal(pixels[3], 0, "alpha should be 0");
		});

		it("draws something", () => {
			const { grid, palette } = iconGrid();
			const { pixels } = rasterise(grid, palette, 1);
			let opaque = 0;
			for (let i = 3; i < pixels.length; i += 4)
				if (pixels[i] === 255) opaque++;
			assert.ok(
				opaque > 100,
				`only ${opaque} opaque pixels — the cat is missing`,
			);
		});
	});

	describe("encodePng", () => {
		it("writes a header that reads back", () => {
			const pixels = Buffer.alloc(4 * 4 * 4, 0x7f);
			const png = encodePng(4, 4, pixels);

			assert.deepEqual(png.subarray(0, 8), PNG_MAGIC);
			// The IHDR chunk starts at byte 8: length, type, then the fields.
			assert.equal(png.readUInt32BE(8), 13, "IHDR is 13 bytes");
			assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
			assert.equal(png.readUInt32BE(16), 4, "width");
			assert.equal(png.readUInt32BE(20), 4, "height");
			assert.equal(png[24], 8, "bit depth");
			assert.equal(png[25], 6, "colour type RGBA");
		});

		it("ends with IEND", () => {
			const png = encodePng(2, 2, Buffer.alloc(2 * 2 * 4));
			assert.equal(png.subarray(-8, -4).toString("ascii"), "IEND");
		});

		it("round-trips the pixels through the zlib stream", () => {
			// The one claim that matters: what goes in comes out, with a filter
			// byte per row.
			const pixels = Buffer.from([
				1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
			]);
			const png = encodePng(2, 2, pixels);

			const idatLength = png.readUInt32BE(33);
			const idat = png.subarray(41, 41 + idatLength);
			const raw = inflateSync(idat);

			assert.equal(raw.length, (2 * 4 + 1) * 2);
			assert.equal(raw[0], 0, "row 0 filter type");
			assert.deepEqual([...raw.subarray(1, 9)], [1, 2, 3, 4, 5, 6, 7, 8]);
			assert.equal(raw[9], 0, "row 1 filter type");
			assert.deepEqual(
				[...raw.subarray(10, 18)],
				[9, 10, 11, 12, 13, 14, 15, 16],
			);
		});
	});

	describe("encodeIco", () => {
		const png = encodePng(2, 2, Buffer.alloc(2 * 2 * 4));

		it("writes a directory whose offsets point at the images", () => {
			const ico = encodeIco([
				{ size: 32, png },
				{ size: 64, png },
			]);

			assert.equal(ico.readUInt16LE(0), 0, "reserved");
			assert.equal(ico.readUInt16LE(2), 1, "type: icon");
			assert.equal(ico.readUInt16LE(4), 2, "image count");

			for (let i = 0; i < 2; i++) {
				const entry = 6 + i * 16;
				const length = ico.readUInt32LE(entry + 8);
				const offset = ico.readUInt32LE(entry + 12);
				assert.equal(length, png.length, `image ${i} length`);
				assert.deepEqual(
					ico.subarray(offset, offset + 8),
					PNG_MAGIC,
					`image ${i} offset does not point at a PNG`,
				);
			}
		});

		it("stores 256 as 0, as the format requires", () => {
			const ico = encodeIco([{ size: 256, png }]);
			assert.equal(ico[6], 0, "width byte");
			assert.equal(ico[7], 0, "height byte");
		});

		it("records the dimensions for ordinary sizes", () => {
			const ico = encodeIco([{ size: 48, png }]);
			assert.equal(ico[6], 48);
			assert.equal(ico[7], 48);
		});
	});
});

#!/usr/bin/env node
/**
 * Application and tray icons, drawn from the same sprite art as the cats.
 *
 * Windows needs raster icons: a PNG for the tray and an .ico for the window and
 * the packaged executable. Rather than commit hand-made binaries that nobody can
 * regenerate, both are built from one frame of the sprite generator — so the
 * icon is the same cat, in the same palette, and changing the art changes the
 * icon.
 *
 * The PNG and ICO writers are here in full because pixel art at integer scales
 * needs neither a rasteriser nor a resampler: a 32x32 grid of palette letters
 * upscales to 256x256 by repeating each pixel, and a PNG of that is a zlib
 * stream of raw scanlines. Both formats are a few dozen lines, which is cheaper
 * than a dependency.
 *
 * One caveat on the committed output: the pixels are deterministic but the
 * deflate stream is only as stable as the zlib built into Node. A Node upgrade
 * that changes its output will make CI's "generated art is current" job report
 * a diff in these two files even though the image is identical. Committing the
 * new bytes is the fix; nothing is wrong.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import {
	buildFrame,
	type Cell,
	PALETTES,
	type Palette,
	POSES,
} from "./gen-sprites.ts";

/** The frame the icon is drawn from, and the palette it wears. */
const ICON_ANIMATION = "sit";
const ICON_FRAME = 0;
const ICON_PALETTE = "tabby-orange";

/** Sizes in the .ico. All integer multiples of the 32px grid. */
const ICO_SIZES = [32, 64, 128, 256];
/** The tray icon. 32px is what Windows asks for at 200% scaling. */
const TRAY_SIZE = 32;

type Rgba = [number, number, number, number];

function parseHex(hex: string): Rgba {
	const n = Number.parseInt(hex.replace("#", ""), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

/**
 * The grid as RGBA pixels, scaled up by repeating each cell.
 *
 * Nearest-neighbour on purpose: this is pixel art, and every other filter turns
 * a crisp 32px cat into a smudge.
 */
export function rasterise(
	grid: readonly Cell[][],
	palette: Palette,
	scale: number,
): { width: number; height: number; pixels: Buffer } {
	const size = grid.length;
	const width = size * scale;
	const pixels = Buffer.alloc(width * width * 4);

	const colours = new Map<Cell, Rgba>();
	for (const [cell, value] of Object.entries(palette))
		if (typeof value === "string") colours.set(cell as Cell, parseHex(value));

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const cell = (grid[y] as Cell[])[x] as Cell;
			const rgba = colours.get(cell);
			if (!rgba) continue; // transparent, or a cell this palette omits
			for (let dy = 0; dy < scale; dy++) {
				for (let dx = 0; dx < scale; dx++) {
					const offset = ((y * scale + dy) * width + x * scale + dx) * 4;
					pixels[offset] = rgba[0];
					pixels[offset + 1] = rgba[1];
					pixels[offset + 2] = rgba[2];
					pixels[offset + 3] = rgba[3];
				}
			}
		}
	}
	return { width, height: width, pixels };
}

// -- PNG --------------------------------------------------------------------

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buffer: Buffer): number {
	let c = 0xffffffff;
	for (const byte of buffer)
		c = (CRC_TABLE[(c ^ byte) & 255] as number) ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, "ascii");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
	return Buffer.concat([head, data, crc]);
}

export function encodePng(
	width: number,
	height: number,
	pixels: Buffer,
): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bit depth
	header[9] = 6; // colour type: RGBA
	header[10] = 0; // deflate
	header[11] = 0; // adaptive filtering
	header[12] = 0; // no interlacing

	// One scanline per row, each prefixed with filter type 0 (none). Filtering
	// would compress better; at these sizes it is not worth the code.
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0;
		pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	}

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

// -- ICO --------------------------------------------------------------------

/**
 * An .ico is a directory of images. Since Windows Vista each entry may be a PNG
 * rather than a bitmap, which is what makes this short.
 */
export function encodeIco(images: { size: number; png: Buffer }[]): Buffer {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // 1 = icon
	header.writeUInt16LE(images.length, 4);

	const entries: Buffer[] = [];
	let offset = 6 + images.length * 16;
	for (const { size, png } of images) {
		const entry = Buffer.alloc(16);
		// 256 is stored as 0; the format has one byte per dimension.
		entry[0] = size >= 256 ? 0 : size;
		entry[1] = size >= 256 ? 0 : size;
		entry[2] = 0; // palette size
		entry[3] = 0; // reserved
		entry.writeUInt16LE(1, 4); // colour planes
		entry.writeUInt16LE(32, 6); // bits per pixel
		entry.writeUInt32LE(png.length, 8);
		entry.writeUInt32LE(offset, 12);
		entries.push(entry);
		offset += png.length;
	}

	return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

// -- main -------------------------------------------------------------------

export function iconGrid(): { grid: readonly Cell[][]; palette: Palette } {
	const palette = PALETTES[ICON_PALETTE];
	if (!palette) throw new Error(`no palette named ${ICON_PALETTE}`);
	const pose = POSES[ICON_ANIMATION];
	if (!pose) throw new Error(`no animation named ${ICON_ANIMATION}`);
	const [plan, frames] = pose;
	const params = frames[ICON_FRAME];
	if (!params) throw new Error(`${ICON_ANIMATION} has no frame ${ICON_FRAME}`);
	return { grid: buildFrame(palette, plan, params).g, palette };
}

function main(): void {
	const root = dirname(dirname(fileURLToPath(import.meta.url)));
	const out = join(root, "src", "assets", "icons");
	mkdirSync(out, { recursive: true });

	const { grid, palette } = iconGrid();
	const scaleFor = (size: number) =>
		Math.max(1, Math.round(size / grid.length));

	const tray = rasterise(grid, palette, scaleFor(TRAY_SIZE));
	writeFileSync(
		join(out, "tray.png"),
		encodePng(tray.width, tray.height, tray.pixels),
	);

	const images = ICO_SIZES.map((size) => {
		const raster = rasterise(grid, palette, scaleFor(size));
		return {
			size: raster.width,
			png: encodePng(raster.width, raster.height, raster.pixels),
		};
	});
	writeFileSync(join(out, "app.ico"), encodeIco(images));

	console.log(
		`wrote ${join(out, "tray.png")} (${tray.width}px) and app.ico (${ICO_SIZES.join(", ")}px)`,
	);
}

// Only when run directly, so tests can import the helpers above.
const invoked = process.argv[1];
if (invoked && fileURLToPath(import.meta.url) === resolve(invoked)) main();

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { crc32, inflateRawSync } from "node:zlib";

import { collectZipEntries, zipArchive } from "../../tools/zip.ts";

/**
 * A minimal ZIP reader, so the tests assert on an archive as an extractor sees
 * it rather than on the bytes this writer happens to emit.
 *
 * It reads the central directory — the index every real extractor uses — and
 * then follows each record's offset to the local header, which is the one way
 * to catch the classic mistake of recording an offset that points at the wrong
 * entry.
 */
interface ReadEntry {
	name: string;
	method: number;
	crc: number;
	compressedSize: number;
	uncompressedSize: number;
	external: number;
	data: Buffer;
}

function readZip(archive: Buffer): ReadEntry[] {
	const EOCD = 0x06054b50;
	let eocd = archive.length - 22;
	while (eocd >= 0 && archive.readUInt32LE(eocd) !== EOCD) eocd--;
	assert.ok(eocd >= 0, "no end-of-central-directory record");

	const total = archive.readUInt16LE(eocd + 10);
	let at = archive.readUInt32LE(eocd + 16);
	const entries: ReadEntry[] = [];

	for (let i = 0; i < total; i++) {
		assert.equal(
			archive.readUInt32LE(at),
			0x02014b50,
			`central directory record ${i} has the wrong signature`,
		);
		const method = archive.readUInt16LE(at + 10);
		const crc = archive.readUInt32LE(at + 16);
		const compressedSize = archive.readUInt32LE(at + 20);
		const uncompressedSize = archive.readUInt32LE(at + 24);
		const nameLength = archive.readUInt16LE(at + 28);
		const extraLength = archive.readUInt16LE(at + 30);
		const commentLength = archive.readUInt16LE(at + 32);
		const external = archive.readUInt32LE(at + 38);
		const offset = archive.readUInt32LE(at + 42);
		const name = archive
			.subarray(at + 46, at + 46 + nameLength)
			.toString("utf8");

		assert.equal(
			archive.readUInt32LE(offset),
			0x04034b50,
			`${name} does not point at a local file header`,
		);
		assert.equal(
			archive.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"),
			name,
			`${name}'s local header names a different entry`,
		);
		const localExtra = archive.readUInt16LE(offset + 28);
		const body = offset + 30 + nameLength + localExtra;
		const raw = archive.subarray(body, body + compressedSize);

		entries.push({
			name,
			method,
			crc,
			compressedSize,
			uncompressedSize,
			external,
			data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw),
		});
		at += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

const AT = new Date("2026-02-03T10:20:30Z");

describe("zipArchive", () => {
	it("round-trips a file's contents", () => {
		const data = Buffer.from("cats on the dock\n");
		const [entry] = readZip(
			zipArchive([{ name: "metadata.json", data, mtime: AT }]),
		);
		assert.equal(entry.name, "metadata.json");
		assert.deepEqual(entry.data, data);
	});

	it("names nested entries with forward slashes, whatever the platform", () => {
		// A backslash in a ZIP name is a literal character, not a separator, so
		// an archive built on Windows would otherwise hold one flat file called
		// "assets\cats\walk_0.svg".
		const [entry] = readZip(
			zipArchive([
				{
					name: "assets/cats/walk_0.svg",
					data: Buffer.from("<svg/>"),
					mtime: AT,
				},
			]),
		);
		assert.equal(entry.name, "assets/cats/walk_0.svg");
	});

	it("records the uncompressed size and a crc32 of the contents", () => {
		const data = Buffer.from("a".repeat(500));
		const [entry] = readZip(zipArchive([{ name: "a.txt", data, mtime: AT }]));
		assert.equal(entry.uncompressedSize, data.length);
		assert.equal(entry.crc, crc32(data));
	});

	it("counts every entry in the end record", () => {
		const entries = readZip(
			zipArchive([
				{ name: "one.txt", data: Buffer.from("1"), mtime: AT },
				{ name: "two.txt", data: Buffer.from("2"), mtime: AT },
				{ name: "three.txt", data: Buffer.from("3"), mtime: AT },
			]),
		);
		assert.deepEqual(
			entries.map((e) => e.name),
			["one.txt", "two.txt", "three.txt"],
		);
	});

	it("marks a directory entry as a directory and gives it no contents", () => {
		const [entry] = readZip(
			zipArchive([{ name: "schemas/", data: null, mtime: AT }]),
		);
		assert.equal(entry.name, "schemas/");
		assert.equal(entry.uncompressedSize, 0);
		assert.equal(entry.compressedSize, 0);
		// The MS-DOS directory attribute, for extractors that consult it rather
		// than the trailing slash.
		assert.equal(entry.external & 0x10, 0x10);
	});

	it("deflates contents that compress", () => {
		const data = Buffer.from("<svg></svg>".repeat(400));
		const [entry] = readZip(zipArchive([{ name: "big.svg", data, mtime: AT }]));
		assert.equal(entry.method, 8);
		assert.ok(
			entry.compressedSize < data.length,
			`deflate made it bigger: ${entry.compressedSize} >= ${data.length}`,
		);
		assert.deepEqual(entry.data, data);
	});

	it("stores contents that deflate would only make bigger", () => {
		// Already-compressed bytes: docs/sprites.png is a real one in this repo.
		// Deflating them costs a few bytes, and a writer that always deflated
		// would produce an archive larger than the files it holds.
		const data = Buffer.from([0x1f, 0x8b, 0x37, 0x99, 0xc4, 0x02, 0xff, 0x5a]);
		const [entry] = readZip(zipArchive([{ name: "x.bin", data, mtime: AT }]));
		assert.equal(entry.method, 0);
		assert.deepEqual(entry.data, data);
	});

	it("survives an mtime older than the 1980 epoch ZIP dates start at", () => {
		// A DOS date cannot express 1970, and encoding a negative year would
		// write a nonsense date that some extractors reject outright.
		const entries = readZip(
			zipArchive([
				{ name: "old.txt", data: Buffer.from("x"), mtime: new Date(0) },
			]),
		);
		assert.equal(entries.length, 1);
	});
});

describe("collectZipEntries", () => {
	const root = mkdtempSync(join(tmpdir(), "cats-zip-"));
	after(() => rmSync(root, { recursive: true, force: true }));

	mkdirSync(join(root, "schemas"), { recursive: true });
	mkdirSync(join(root, "assets", "cats"), { recursive: true });
	writeFileSync(join(root, "metadata.json"), "{}");
	writeFileSync(join(root, "schemas", "a.gschema.xml"), "<schemalist/>");
	writeFileSync(join(root, "assets", "cats", "walk_0.svg"), "<svg/>");

	it("includes every file, named relative to the root", () => {
		const names = collectZipEntries(root)
			.filter((e) => e.data !== null)
			.map((e) => e.name);
		assert.deepEqual(names.sort(), [
			"assets/cats/walk_0.svg",
			"metadata.json",
			"schemas/a.gschema.xml",
		]);
	});

	it("includes a directory entry for every directory it descends into", () => {
		const dirs = collectZipEntries(root)
			.filter((e) => e.data === null)
			.map((e) => e.name);
		assert.deepEqual(dirs.sort(), ["assets/", "assets/cats/", "schemas/"]);
	});

	it("lists a directory before the files inside it", () => {
		// Extractors that honour directory entries create them in order; a file
		// arriving before its directory is what makes some of them fail.
		const names = collectZipEntries(root).map((e) => e.name);
		assert.ok(
			names.indexOf("assets/") < names.indexOf("assets/cats/walk_0.svg"),
			`out of order: ${names.join(", ")}`,
		);
	});
});

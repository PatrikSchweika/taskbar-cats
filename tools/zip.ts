/**
 * A ZIP writer, so packing the extension needs nothing but Node.
 *
 * `gnome-extensions pack` would do this, but it ships inside `gnome-shell`,
 * whose dependency closure on Ubuntu is nearly seven hundred packages. That is
 * a lot to install on a CI runner to compress 135 files, and it also made
 * `npm run ext:pack` impossible on a machine without GNOME — which is exactly
 * the machine the packed zip exists for.
 *
 * Only the parts of the format an extension zip needs are here: no ZIP64, no
 * encryption, no data descriptors. That ceiling is 4GB per file and 65535
 * entries, against an extension that is under a megabyte.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

/** Deflate, per the format's method numbering. Method 0 is stored. */
const DEFLATED = 8;
const STORED = 0;

/** ZIP's own floor: DOS dates count years from 1980 and cannot go below it. */
const DOS_EPOCH_YEAR = 1980;

/** The MS-DOS directory attribute, in the high half of the external field. */
const DOS_DIRECTORY = 0x10;

export interface ZipEntry {
	/** The path inside the archive. Always forward slashes; a directory ends in one. */
	name: string;
	/** The contents, or null for a directory entry. */
	data: Buffer | null;
	mtime: Date;
}

/**
 * A date and time in the two 16-bit fields ZIP inherited from MS-DOS.
 *
 * Seconds have one bit less than they need, hence the halving: the format
 * stores them in units of two.
 */
function dosDateTime(when: Date): { date: number; time: number } {
	const year = Math.max(when.getFullYear(), DOS_EPOCH_YEAR);
	return {
		date:
			((year - DOS_EPOCH_YEAR) << 9) |
			((when.getMonth() + 1) << 5) |
			when.getDate(),
		time:
			(when.getHours() << 11) |
			(when.getMinutes() << 5) |
			(when.getSeconds() >> 1),
	};
}

/**
 * Deflate, unless that costs more bytes than it saves.
 *
 * The sprite frames are SVG and compress to about a fifth; the PNGs and the
 * compiled icons are already compressed, and deflating those makes them
 * marginally bigger.
 */
function compress(data: Buffer): { method: number; body: Buffer } {
	const deflated = deflateRawSync(data);
	return deflated.length < data.length
		? { method: DEFLATED, body: deflated }
		: { method: STORED, body: data };
}

/** One entry's local file header, which immediately precedes its contents. */
function localHeader(
	entry: ZipEntry,
	method: number,
	checksum: number,
	compressedSize: number,
	uncompressedSize: number,
	name: Buffer,
): Buffer {
	const header = Buffer.alloc(30);
	const { date, time } = dosDateTime(entry.mtime);
	header.writeUInt32LE(LOCAL_HEADER, 0);
	header.writeUInt16LE(20, 4); // the version that can extract this
	header.writeUInt16LE(0, 6); // no flags: no encryption, no data descriptor
	header.writeUInt16LE(method, 8);
	header.writeUInt16LE(time, 10);
	header.writeUInt16LE(date, 12);
	header.writeUInt32LE(checksum, 14);
	header.writeUInt32LE(compressedSize, 18);
	header.writeUInt32LE(uncompressedSize, 22);
	header.writeUInt16LE(name.length, 26);
	header.writeUInt16LE(0, 28); // no extra field
	return header;
}

/**
 * One entry's central directory record.
 *
 * The central directory is the index an extractor actually reads, so its copy
 * of each entry's sizes must agree with the local header's, and `offset` must
 * point at that header.
 */
function centralRecord(
	entry: ZipEntry,
	method: number,
	checksum: number,
	compressedSize: number,
	uncompressedSize: number,
	name: Buffer,
	offset: number,
): Buffer {
	const record = Buffer.alloc(46);
	const { date, time } = dosDateTime(entry.mtime);
	const isDirectory = entry.name.endsWith("/");
	record.writeUInt32LE(CENTRAL_HEADER, 0);
	record.writeUInt16LE(20, 4); // the version that wrote this
	record.writeUInt16LE(20, 6); // the version that can extract it
	record.writeUInt16LE(0, 8);
	record.writeUInt16LE(method, 10);
	record.writeUInt16LE(time, 12);
	record.writeUInt16LE(date, 14);
	record.writeUInt32LE(checksum, 16);
	record.writeUInt32LE(compressedSize, 20);
	record.writeUInt32LE(uncompressedSize, 24);
	record.writeUInt16LE(name.length, 28);
	record.writeUInt16LE(0, 30); // no extra field
	record.writeUInt16LE(0, 32); // no comment
	record.writeUInt16LE(0, 34); // one disk, so entry 0
	record.writeUInt16LE(0, 36); // no internal attributes
	record.writeUInt32LE(isDirectory ? DOS_DIRECTORY : 0, 38);
	record.writeUInt32LE(offset, 42);
	// The name is part of the record: the fixed fields only say how long it is,
	// and the next record starts immediately after it.
	return Buffer.concat([record, name]);
}

/** The whole archive, in memory. */
export function zipArchive(entries: readonly ZipEntry[]): Buffer {
	const parts: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = Buffer.from(entry.name, "utf8");
		const data = entry.data ?? Buffer.alloc(0);
		// A directory holds nothing, so there is nothing to compress and a
		// checksum of no bytes is zero — which is what `crc32` returns anyway,
		// but stating it keeps the directory case out of `compress`.
		const { method, body } = entry.data
			? compress(data)
			: { method: STORED, body: data };
		const checksum = crc32(data);

		const header = localHeader(
			entry,
			method,
			checksum,
			body.length,
			data.length,
			name,
		);
		central.push(
			centralRecord(
				entry,
				method,
				checksum,
				body.length,
				data.length,
				name,
				offset,
			),
		);
		parts.push(header, name, body);
		offset += header.length + name.length + body.length;
	}

	const directory = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
	end.writeUInt16LE(0, 4); // this disk
	end.writeUInt16LE(0, 6); // the disk the central directory starts on
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(0, 20); // no archive comment

	return Buffer.concat([...parts, directory, end]);
}

/**
 * Everything under `root`, as entries named relative to it.
 *
 * Directories come before what they contain, because an extractor that honours
 * directory entries creates them in the order it reads them.
 */
export function collectZipEntries(root: string): ZipEntry[] {
	const entries: ZipEntry[] = [];

	const walk = (directory: string, prefix: string): void => {
		const children = readdirSync(directory, { withFileTypes: true }).sort(
			(a, b) => a.name.localeCompare(b.name),
		);
		for (const child of children) {
			const full = join(directory, child.name);
			const stats = statSync(full);
			if (child.isDirectory()) {
				entries.push({
					name: `${prefix}${child.name}/`,
					data: null,
					mtime: stats.mtime,
				});
				walk(full, `${prefix}${child.name}/`);
			} else {
				entries.push({
					name: `${prefix}${child.name}`,
					data: readFileSync(full),
					mtime: stats.mtime,
				});
			}
		}
	};

	walk(root, "");
	return entries;
}

/** Pack a directory into a zip file, the way `gnome-extensions pack` would. */
export function writeZipFromDirectory(root: string, outFile: string): number {
	const entries = collectZipEntries(root);
	const archive = zipArchive(entries);
	writeFileSync(outFile, archive);
	return entries.filter((e) => e.data !== null).length;
}

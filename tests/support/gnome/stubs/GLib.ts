import { readFileSync } from "node:fs";
import { posix } from "node:path";

/** Pending timeouts, driven manually by tests rather than by real time. */
export interface FakeSource {
	id: number;
	intervalMs: number;
	fn: () => boolean;
	name?: string;
}
const sources = new Map<number, FakeSource>();
let nextSourceId = 1;
let monotonicUs = 0;

export const PRIORITY_DEFAULT = 0;
export const SOURCE_CONTINUE = true;
export const SOURCE_REMOVE = false;

/**
 * Always POSIX, whatever the host is.
 *
 * The extension this stands in for only ever runs on Linux, so GLib always
 * builds paths with '/'. Using the host's separator instead would make the
 * simulated GNOME environment change shape depending on where the test suite
 * happens to run — which it does, now that CI exercises it on Windows too.
 */
export function build_filenamev(parts: string[]): string {
	return posix.join(...parts.map((p) => p.split("\\").join("/")));
}

export function file_get_contents(path: string): [boolean, Uint8Array] {
	try {
		return [true, new Uint8Array(readFileSync(path))];
	} catch {
		return [false, new Uint8Array()];
	}
}

export function get_monotonic_time(): number {
	return monotonicUs;
}

export function timeout_add(
	_priority: number,
	intervalMs: number,
	fn: () => boolean,
): number {
	const id = nextSourceId++;
	sources.set(id, { id, intervalMs, fn });
	return id;
}

export const Source = {
	remove(id: number): void {
		if (!sources.delete(id))
			throw new Error(`GLib.Source.remove: no such source ${id}`);
	},
	set_name_by_id(id: number, name: string): void {
		const s = sources.get(id);
		if (s) s.name = name;
	},
};

// -- test controls ----------------------------------------------------------

export function __sources(): FakeSource[] {
	return [...sources.values()];
}
export function __advance(seconds: number): void {
	monotonicUs += Math.round(seconds * 1e6);
}
export function __reset(): void {
	sources.clear();
	nextSourceId = 1;
	monotonicUs = 0;
}
/** Fire every pending source once, honouring SOURCE_REMOVE. */
export function __tick(): void {
	for (const s of [...sources.values()]) {
		if (!sources.has(s.id)) continue;
		if (s.fn() === SOURCE_REMOVE) sources.delete(s.id);
	}
}

export default {
	PRIORITY_DEFAULT,
	SOURCE_CONTINUE,
	SOURCE_REMOVE,
	build_filenamev,
	file_get_contents,
	get_monotonic_time,
	timeout_add,
	Source,
	__sources,
	__advance,
	__reset,
	__tick,
};

/**
 * The settings both platforms honour, with one copy of the defaults and ranges.
 *
 * GNOME reads these from GSettings and Windows from a JSON file, but a cat
 * should behave identically on both, so the *meaning* of every key lives here.
 * `tests/config.test.ts` parses the GSettings schema and fails if it drifts
 * from this table.
 */
import type { CatConfig } from "./cat.js";

export interface Settings extends CatConfig {
	count: number;
	palettes: string[];
	wiggleIcons: boolean;
	spriteSize: number;
	/** Cat beds standing on the floor for sleepy cats to curl up in. */
	beds: number;
	/** Scratching posts on the floor, clawed instead of (or as well as) icons. */
	scratchers: number;
	/** Average seconds between a mouse running across the floor; 0 for none. */
	mouseInterval: number;
	/**
	 * Where each bed stands, as a percentage of the floor's width from the left
	 * edge of the dock's monitor, indexed by bed. {@link AUTO_POSITION} — or a
	 * missing entry — leaves that bed where the cats would put it.
	 */
	bedPositions: number[];
	/** The same for the scratching posts. */
	scratcherPositions: number[];
}

/** The position value that means "lay this one out automatically". */
export const AUTO_POSITION = -1;

/** An integer setting: its GSettings key, default, and permitted range. */
interface IntSpec {
	key: string;
	default: number;
	min: number;
	max: number;
}

/**
 * Keyed by the property name on {@link Settings}, valued by the GSettings key
 * it comes from. Windows reuses the same key strings in its JSON file so a
 * config is legible next to the schema.
 */
export const INT_SETTINGS = {
	count: { key: "cat-count", default: 3, min: 1, max: 8 },
	maxSpeed: { key: "max-speed", default: 160, min: 40, max: 600 },
	attraction: { key: "mouse-attraction", default: 60, min: 0, max: 100 },
	attractRadius: { key: "attract-radius", default: 260, min: 40, max: 1200 },
	spriteSize: { key: "sprite-size", default: 0, min: 0, max: 128 },
	sleepAfter: { key: "sleep-after", default: 20, min: 0, max: 600 },
	fps: { key: "animation-fps", default: 12, min: 4, max: 30 },
	beds: { key: "bed-count", default: 0, min: 0, max: 8 },
	scratchers: { key: "scratcher-count", default: 0, min: 0, max: 8 },
	mouseInterval: { key: "mouse-interval", default: 120, min: 0, max: 3600 },
} as const satisfies Record<string, IntSpec>;

export const BOOL_SETTINGS = {
	scratchIcons: { key: "scratch-icons", default: true },
	wiggleIcons: { key: "wiggle-icons", default: true },
} as const satisfies Record<string, { key: string; default: boolean }>;

/** The palettes key is a string list; empty means "use every palette". */
export const PALETTES_KEY = "palettes";

/**
 * The position lists: integer arrays keyed by property name. Percentages
 * 0–100, or {@link AUTO_POSITION}; anything else is coerced to one of those.
 */
export const POSITION_SETTINGS = {
	bedPositions: { key: "bed-positions" },
	scratcherPositions: { key: "scratcher-positions" },
} as const satisfies Record<string, { key: string }>;

/** Coerce one stored position list: numbers clamped to 0–100, junk to auto. */
export function normalizePositions(raw: unknown): number[] {
	if (!Array.isArray(raw)) return [];
	return raw.map((value) => {
		const n = typeof value === "number" && Number.isFinite(value) ? value : NaN;
		if (Number.isNaN(n) || n < 0) return AUTO_POSITION;
		return Math.min(100, Math.round(n));
	});
}

export function defaultSettings(): Settings {
	const out = {
		palettes: [] as string[],
		bedPositions: [] as number[],
		scratcherPositions: [] as number[],
	} as Settings;
	for (const [name, spec] of Object.entries(INT_SETTINGS))
		(out as unknown as Record<string, number>)[name] = spec.default;
	for (const [name, spec] of Object.entries(BOOL_SETTINGS))
		(out as unknown as Record<string, boolean>)[name] = spec.default;
	return out;
}

function clampInt(value: unknown, spec: IntSpec): number {
	const n = typeof value === "number" && Number.isFinite(value) ? value : NaN;
	if (Number.isNaN(n)) return spec.default;
	return Math.min(spec.max, Math.max(spec.min, Math.round(n)));
}

/**
 * Coerce arbitrary parsed JSON into usable settings.
 *
 * The Windows config is a file a user can hand-edit, so every field is treated
 * as hostile: wrong types, out-of-range numbers and missing keys all fall back
 * rather than reaching the simulation, where a NaN speed would strand every cat
 * off-screen. GNOME gets the same guarantees from GSettings' own ranges.
 */
export function normalizeSettings(raw: unknown): Settings {
	// A hand-edited file can hold any JSON at all, including a bare string or
	// number, so anything that is not an object is treated as absent.
	const src =
		raw && typeof raw === "object" && !Array.isArray(raw)
			? (raw as Record<string, unknown>)
			: {};
	const out = defaultSettings();

	for (const [name, spec] of Object.entries(INT_SETTINGS)) {
		if (spec.key in src)
			(out as unknown as Record<string, number>)[name] = clampInt(
				src[spec.key],
				spec,
			);
	}
	for (const [name, spec] of Object.entries(BOOL_SETTINGS)) {
		const value = src[spec.key];
		if (typeof value === "boolean")
			(out as unknown as Record<string, boolean>)[name] = value;
	}
	const palettes = src[PALETTES_KEY];
	if (Array.isArray(palettes))
		out.palettes = palettes.filter((p): p is string => typeof p === "string");
	for (const [name, spec] of Object.entries(POSITION_SETTINGS))
		(out as unknown as Record<string, number[]>)[name] = normalizePositions(
			src[spec.key],
		);

	return out;
}

/** Settings back out as the flat, GSettings-keyed object stored on disk. */
export function toStorage(settings: Settings): Record<string, unknown> {
	const out: Record<string, unknown> = { [PALETTES_KEY]: settings.palettes };
	for (const [name, spec] of Object.entries(INT_SETTINGS))
		out[spec.key] = (settings as unknown as Record<string, number>)[name];
	for (const [name, spec] of Object.entries(BOOL_SETTINGS))
		out[spec.key] = (settings as unknown as Record<string, boolean>)[name];
	for (const [name, spec] of Object.entries(POSITION_SETTINGS))
		out[spec.key] = (settings as unknown as Record<string, number[]>)[name];
	return out;
}

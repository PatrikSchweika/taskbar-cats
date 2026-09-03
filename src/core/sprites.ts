/**
 * The sprite manifest, and the rules for reading it, without any file I/O.
 *
 * Frames live at assets/cats/<palette>/<animation>_<n>.svg and are described by
 * assets/cats/manifest.json, so neither platform has to guess frame counts.
 * GNOME loads those paths through Gio; the Windows renderer fetches them as
 * URLs. Only the loading differs, so only the loading is platform code.
 */

export interface SpriteManifest {
	palettes: string[];
	animations: Record<string, number>;
}

/** The animation every unknown state falls back to. */
export const FALLBACK_ANIMATION = "idle";

export function isSpriteManifest(value: unknown): value is SpriteManifest {
	if (!value || typeof value !== "object") return false;
	const m = value as Partial<SpriteManifest>;
	return (
		Array.isArray(m.palettes) &&
		m.palettes.every((p) => typeof p === "string") &&
		!!m.animations &&
		typeof m.animations === "object" &&
		Object.values(m.animations).every((n) => typeof n === "number")
	);
}

export function parseManifest(text: string, where: string): SpriteManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (e) {
		throw new Error(`taskbar-cats: ${where} is not valid JSON: ${e}`);
	}
	if (!isSpriteManifest(parsed))
		throw new Error(`taskbar-cats: ${where} is not a sprite manifest`);
	return parsed;
}

/** The relative path of one frame, in the layout the generator writes. */
export function framePath(
	palette: string,
	animation: string,
	frame: number,
): string {
	return `${palette}/${animation}_${frame}.svg`;
}

/** Every (palette, animation, frame) the manifest promises. */
export function* eachFrame(
	manifest: SpriteManifest,
): Generator<{ palette: string; animation: string; frame: number }> {
	for (const palette of manifest.palettes)
		for (const [animation, count] of Object.entries(manifest.animations))
			for (let frame = 0; frame < count; frame++)
				yield { palette, animation, frame };
}

/** Requested palette names filtered to those that actually exist. */
export function resolvePalettes(
	requested: readonly string[],
	available: readonly string[],
): string[] {
	const valid = requested.filter((p) => available.includes(p));
	return valid.length ? valid : [...available];
}

/**
 * A {@link SpriteSource} over frame handles already loaded by a platform.
 *
 * Handles are keyed '<palette>/<animation>'; an unknown animation falls back to
 * idle so a new state can never blank a cat out.
 */
export class FrameTable<H> {
	readonly palettes: readonly string[];
	readonly animations: Record<string, number>;
	private readonly _frames: Map<string, H[]>;

	constructor(manifest: SpriteManifest, load: (path: string) => H) {
		this.palettes = manifest.palettes;
		this.animations = manifest.animations;
		this._frames = new Map();
		for (const { palette, animation, frame } of eachFrame(manifest)) {
			const key = `${palette}/${animation}`;
			let list = this._frames.get(key);
			if (!list) {
				list = [];
				this._frames.set(key, list);
			}
			list.push(load(framePath(palette, animation, frame)));
		}
	}

	frames(palette: string, animation: string): readonly H[] {
		return (
			this._frames.get(`${palette}/${animation}`) ??
			this._frames.get(`${palette}/${FALLBACK_ANIMATION}`) ??
			[]
		);
	}

	resolvePalettes(requested: readonly string[]): string[] {
		return resolvePalettes(requested, this.palettes);
	}

	destroy(): void {
		this._frames.clear();
	}
}

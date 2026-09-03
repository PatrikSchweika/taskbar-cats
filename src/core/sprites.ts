/**
 * The sprite manifest, and the rules for reading it, without any file I/O.
 *
 * Cat frames live at assets/cats/<palette>/<animation>_<n>.svg and the props
 * (beds, scratching posts, the mouse) at assets/cats/props/<name>_<n>.svg; both
 * are described by assets/cats/manifest.json, so neither platform has to guess
 * frame counts. GNOME loads those paths through Gio; the Windows renderer
 * fetches them as URLs. Only the loading differs, so only the loading is
 * platform code.
 */

export interface SpriteManifest {
	palettes: string[];
	animations: Record<string, number>;
	/**
	 * Frame counts for the props, which have no palette. Optional so a manifest
	 * from before props existed still loads — the cats then simply have no
	 * furniture to use.
	 */
	props?: Record<string, number>;
}

/** The directory under the sprite root that holds the prop frames. */
export const PROPS_DIR = "props";

/** The animation every unknown state falls back to. */
export const FALLBACK_ANIMATION = "idle";

export function isSpriteManifest(value: unknown): value is SpriteManifest {
	if (!value || typeof value !== "object") return false;
	const m = value as Partial<SpriteManifest>;
	const counts = (table: unknown): boolean =>
		!!table &&
		typeof table === "object" &&
		Object.values(table).every((n) => typeof n === "number");
	return (
		Array.isArray(m.palettes) &&
		m.palettes.every((p) => typeof p === "string") &&
		counts(m.animations) &&
		(m.props === undefined || counts(m.props))
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

/** The relative path of one prop frame. */
export function propFramePath(name: string, frame: number): string {
	return `${PROPS_DIR}/${name}_${frame}.svg`;
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

/** Every (prop, frame) the manifest promises. */
export function* eachPropFrame(
	manifest: SpriteManifest,
): Generator<{ name: string; frame: number }> {
	for (const [name, count] of Object.entries(manifest.props ?? {}))
		for (let frame = 0; frame < count; frame++) yield { name, frame };
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
 * Cat frames are keyed '<palette>/<animation>'; an unknown animation falls back
 * to idle so a new state can never blank a cat out. Prop frames are kept apart
 * so a palette could be named 'props' without colliding.
 */
export class FrameTable<H> {
	readonly palettes: readonly string[];
	readonly animations: Record<string, number>;
	readonly props: Record<string, number>;
	private readonly _frames: Map<string, H[]>;
	private readonly _props: Map<string, H[]>;

	constructor(manifest: SpriteManifest, load: (path: string) => H) {
		this.palettes = manifest.palettes;
		this.animations = manifest.animations;
		this.props = manifest.props ?? {};
		this._frames = new Map();
		for (const { palette, animation, frame } of eachFrame(manifest))
			push(this._frames, `${palette}/${animation}`, () =>
				load(framePath(palette, animation, frame)),
			);
		this._props = new Map();
		for (const { name, frame } of eachPropFrame(manifest))
			push(this._props, name, () => load(propFramePath(name, frame)));
	}

	frames(palette: string, animation: string): readonly H[] {
		return (
			this._frames.get(`${palette}/${animation}`) ??
			this._frames.get(`${palette}/${FALLBACK_ANIMATION}`) ??
			[]
		);
	}

	/** Frames for one prop; empty when the install has no such prop. */
	propFrames(name: string): readonly H[] {
		return this._props.get(name) ?? [];
	}

	resolvePalettes(requested: readonly string[]): string[] {
		return resolvePalettes(requested, this.palettes);
	}

	destroy(): void {
		this._frames.clear();
		this._props.clear();
	}
}

function push<H>(table: Map<string, H[]>, key: string, make: () => H): void {
	let list = table.get(key);
	if (!list) {
		list = [];
		table.set(key, list);
	}
	list.push(make());
}

/**
 * Sprite loading for the overlay window.
 *
 * The frames are the same SVG files the GNOME extension uses, loaded as <img>
 * elements from the bundle scheme main serves the overlay from. The manifest
 * listing them arrives over IPC, already parsed and already validated.
 */

import type { SpriteManifest } from "../../../core/sprites.js";
import { FrameTable } from "../../../core/sprites.js";
import type { SpriteSource } from "../../../core/types.js";

/** Where the frames sit relative to the overlay document. */
const ASSET_ROOT = "../../../assets/cats";

export class WebSpriteSet implements SpriteSource {
	private readonly _table: FrameTable<HTMLImageElement>;

	private constructor(table: FrameTable<HTMLImageElement>) {
		this._table = table;
	}

	static async load(manifest: SpriteManifest): Promise<WebSpriteSet> {
		const table = new FrameTable(manifest, (relative) => {
			const image = new Image();
			image.src = `${ASSET_ROOT}/${relative}`;
			return image;
		});

		// Wait for the frames to decode. Without this the first few ticks would
		// assign a src that is not in cache yet and the cats would flicker in.
		const decoded = (images: readonly HTMLImageElement[]) =>
			Promise.all(
				images.map((image) =>
					image.decode().catch(() => {
						// A frame that will not decode is a broken install, not a
						// reason to show nothing.
					}),
				),
			);
		await Promise.all([
			...manifest.palettes.flatMap((palette) =>
				Object.keys(manifest.animations).map((animation) =>
					decoded(table.frames(palette, animation)),
				),
			),
			...Object.keys(manifest.props ?? {}).map((name) =>
				decoded(table.propFrames(name)),
			),
		]);

		return new WebSpriteSet(table);
	}

	get palettes(): readonly string[] {
		return this._table.palettes;
	}

	frames(palette: string, animation: string): readonly HTMLImageElement[] {
		return this._table.frames(palette, animation);
	}

	propFrames(name: string): readonly HTMLImageElement[] {
		return this._table.propFrames(name);
	}
}

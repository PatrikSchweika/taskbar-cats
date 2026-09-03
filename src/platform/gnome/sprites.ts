import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { FrameTable, parseManifest } from "../../core/sprites.js";
import type { SpriteSource } from "../../core/types.js";

/**
 * Loads the generated sprite frames and hands out Gio.FileIcons.
 *
 * Gio.FileIcon objects are created once at enable time; St's texture cache
 * dedupes the pixel data behind them, which makes advancing a frame just a
 * property assignment. Which frames exist, and which animation an unknown
 * state falls back to, is core logic — this class only does the I/O.
 */
export class SpriteSet implements SpriteSource {
	private readonly _table: FrameTable<Gio.Icon>;

	constructor(extensionPath: string) {
		const root = GLib.build_filenamev([extensionPath, "assets", "cats"]);
		const manifestPath = GLib.build_filenamev([root, "manifest.json"]);
		const [ok, bytes] = GLib.file_get_contents(manifestPath);
		if (!ok) throw new Error(`taskbar-cats: cannot read ${manifestPath}`);

		const manifest = parseManifest(
			new TextDecoder().decode(bytes),
			manifestPath,
		);
		this._table = new FrameTable(manifest, (relative) =>
			Gio.FileIcon.new(
				Gio.File.new_for_path(GLib.build_filenamev([root, relative])),
			),
		);
	}

	get palettes(): readonly string[] {
		return this._table.palettes;
	}

	get animations(): Record<string, number> {
		return this._table.animations;
	}

	frames(palette: string, animation: string): readonly Gio.Icon[] {
		return this._table.frames(palette, animation);
	}

	propFrames(name: string): readonly Gio.Icon[] {
		return this._table.propFrames(name);
	}

	/** Palette names filtered to those that actually exist on disk. */
	resolvePalettes(requested: readonly string[]): string[] {
		return this._table.resolvePalettes(requested);
	}

	destroy(): void {
		this._table.destroy();
	}
}

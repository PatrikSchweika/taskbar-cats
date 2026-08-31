import Gio from "gi://Gio";
import GLib from "gi://GLib";

interface SpriteManifest {
	palettes: string[];
	animations: Record<string, number>;
}

/**
 * Loads the generated sprite frames and hands out Gio.FileIcons.
 *
 * Frames live at assets/cats/<palette>/<animation>_<n>.svg and are described by
 * assets/cats/manifest.json, so the extension never has to guess frame counts.
 * Gio.FileIcon objects are created once at enable time; St's texture cache
 * dedupes the pixel data behind them, which makes advancing a frame just a
 * property assignment.
 */
export class SpriteSet {
	palettes: string[] = [];
	animations: Record<string, number> = {};

	private readonly _root: string;
	private readonly _icons = new Map<string, Gio.Icon[]>();

	constructor(extensionPath: string) {
		this._root = GLib.build_filenamev([extensionPath, "assets", "cats"]);
		this._load();
	}

	private _load(): void {
		const manifestPath = GLib.build_filenamev([this._root, "manifest.json"]);
		const [ok, bytes] = GLib.file_get_contents(manifestPath);
		if (!ok) throw new Error(`ubuntu-cats: cannot read ${manifestPath}`);

		const manifest = JSON.parse(
			new TextDecoder().decode(bytes),
		) as SpriteManifest;
		this.palettes = manifest.palettes;
		this.animations = manifest.animations;

		for (const palette of this.palettes) {
			for (const [animation, count] of Object.entries(this.animations)) {
				const frames: Gio.Icon[] = [];
				for (let i = 0; i < count; i++) {
					const path = GLib.build_filenamev([
						this._root,
						palette,
						`${animation}_${i}.svg`,
					]);
					frames.push(Gio.FileIcon.new(Gio.File.new_for_path(path)));
				}
				this._icons.set(`${palette}/${animation}`, frames);
			}
		}
	}

	/** Frames for one animation, falling back to 'idle' for unknown names. */
	frames(palette: string, animation: string): Gio.Icon[] {
		return (
			this._icons.get(`${palette}/${animation}`) ??
			this._icons.get(`${palette}/idle`) ??
			[]
		);
	}

	/** Palette names filtered to those that actually exist on disk. */
	resolvePalettes(requested: string[]): string[] {
		const valid = requested.filter((p) => this.palettes.includes(p));
		return valid.length ? valid : this.palettes;
	}

	destroy(): void {
		this._icons.clear();
	}
}

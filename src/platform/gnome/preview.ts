import Gdk from "gi://Gdk";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";

import {
	PREVIEW_FRAME_MS,
	parseManifest,
	previewFrames,
	type SpriteManifest,
} from "../../core/sprites.js";

/** The manifest, read from the installed extension; null (and logged) if unreadable. */
export function loadManifest(extensionPath: string): SpriteManifest | null {
	const path = GLib.build_filenamev([
		extensionPath,
		"assets",
		"cats",
		"manifest.json",
	]);
	try {
		const [ok, bytes] = GLib.file_get_contents(path);
		if (!ok) throw new Error(`cannot read ${path}`);
		return parseManifest(new TextDecoder().decode(bytes), path);
	} catch (e) {
		logError(e as Error, "taskbar-cats: cannot read sprite manifest");
		return null;
	}
}

/**
 * A looping cat for the preferences window.
 *
 * Runs in the prefs process, which has GTK but not the shell, so frames are
 * Gdk.Textures on a Gtk.Picture rather than St icons. The timer exists only
 * while the widget is realized: a closed window stops every preview.
 */
export class SpritePreview {
	readonly widget: Gtk.Picture;
	private readonly _root: string;
	private readonly _manifest: SpriteManifest;
	private _palette = "";
	private _frames: Gdk.Texture[] = [];
	private _index = 0;
	private _timer = 0;

	/** @param spriteRoot the directory holding `<palette>/<animation>_<n>.svg` */
	constructor(spriteRoot: string, manifest: SpriteManifest, size = 48) {
		this._root = spriteRoot;
		this._manifest = manifest;
		this.widget = new Gtk.Picture({
			width_request: size,
			height_request: size,
			can_shrink: true,
			content_fit: Gtk.ContentFit.CONTAIN,
			valign: Gtk.Align.CENTER,
		});
		this.widget.connect("realize", () => this._start());
		this.widget.connect("unrealize", () => this._stop());
	}

	setPalette(palette: string): void {
		if (palette === this._palette) return;
		this._palette = palette;
		this._index = 0;
		this._frames = previewFrames(this._manifest, palette).flatMap(
			(relative) => {
				try {
					return [
						Gdk.Texture.new_from_filename(
							GLib.build_filenamev([this._root, relative]),
						),
					];
				} catch {
					// A missing frame is a broken install, not a reason to crash prefs.
					return [];
				}
			},
		);
		this._show();
		this._start();
	}

	private _show(): void {
		const frame = this._frames[this._index];
		if (frame) this.widget.set_paintable(frame);
	}

	private _start(): void {
		if (this._timer || this._frames.length < 2 || !this.widget.get_realized())
			return;
		this._timer = GLib.timeout_add(
			GLib.PRIORITY_DEFAULT,
			PREVIEW_FRAME_MS,
			() => {
				this._index = (this._index + 1) % this._frames.length;
				this._show();
				return GLib.SOURCE_CONTINUE;
			},
		);
	}

	private _stop(): void {
		if (this._timer) GLib.Source.remove(this._timer);
		this._timer = 0;
	}
}

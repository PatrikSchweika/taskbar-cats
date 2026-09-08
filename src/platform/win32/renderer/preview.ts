/**
 * A looping cat for the settings window.
 *
 * Frames are the same SVGs the overlay draws, served from the bundle scheme.
 * They are decoded once per palette and shared, so eight previews of the same
 * palette cost one set of images. Every preview pauses while the window is
 * hidden: a settings window left open behind something else should not burn
 * a timer per cat.
 */
import {
	PREVIEW_FRAME_MS,
	previewFrames,
	type SpriteManifest,
} from "../../../core/sprites.js";

const ASSET_ROOT = "../../../assets/cats";

const decoded = new Map<string, Promise<HTMLImageElement[]>>();

function framesFor(
	manifest: SpriteManifest,
	palette: string,
): Promise<HTMLImageElement[]> {
	let pending = decoded.get(palette);
	if (!pending) {
		const images = previewFrames(manifest, palette).map((relative) => {
			const image = new Image();
			image.src = `${ASSET_ROOT}/${relative}`;
			return image;
		});
		pending = Promise.all(
			images.map((image) => image.decode().catch(() => {})),
		).then(() => images);
		decoded.set(palette, pending);
	}
	return pending;
}

const live = new Set<SpritePreview>();
document.addEventListener("visibilitychange", () => {
	for (const preview of live) preview.syncPlayback();
});

export class SpritePreview {
	readonly element: HTMLImageElement;
	private readonly _manifest: SpriteManifest;
	private _palette = "";
	private _frames: HTMLImageElement[] = [];
	private _index = 0;
	private _timer: ReturnType<typeof setInterval> | null = null;

	constructor(manifest: SpriteManifest, size = 48) {
		this._manifest = manifest;
		const element = document.createElement("img");
		element.className = "preview";
		element.alt = "";
		element.draggable = false;
		element.width = size;
		element.height = size;
		this.element = element;
		live.add(this);
	}

	setPalette(palette: string): void {
		if (palette === this._palette) return;
		this._palette = palette;
		this._index = 0;
		void framesFor(this._manifest, palette).then((frames) => {
			// The palette may have changed again while these decoded.
			if (this._palette !== palette) return;
			this._frames = frames;
			this._show();
			this.syncPlayback();
		});
	}

	/** Run the timer only while there is something to show and someone to see it. */
	syncPlayback(): void {
		const shouldRun = this._frames.length > 1 && !document.hidden;
		if (shouldRun && !this._timer)
			this._timer = setInterval(() => this._advance(), PREVIEW_FRAME_MS);
		else if (!shouldRun && this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
	}

	private _advance(): void {
		this._index = (this._index + 1) % this._frames.length;
		this._show();
	}

	private _show(): void {
		const frame = this._frames[this._index];
		if (frame && this.element.src !== frame.src) this.element.src = frame.src;
	}

	destroy(): void {
		live.delete(this);
		this._frames = [];
		this.syncPlayback();
		this.element.remove();
	}
}

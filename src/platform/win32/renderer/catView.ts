/**
 * A cat — or a bed, a post, the mouse — drawn as an `<img>` in the overlay
 * window.
 *
 * One element per cat, moved with a transform: no layout, no repaint of
 * anything but the composited layer, which is what keeps a dozen cats at 60fps
 * cheap enough to leave running all day.
 */
import type { CatView, FrameHandle } from "../../../core/types.js";

export class DomCatView implements CatView {
	readonly element: HTMLImageElement;
	private _size = 0;
	private _shown: string | null = null;

	/**
	 * @param behind put the sprite under everything already on the stage. Props
	 * are drawn this way so a cat sleeps on its bed rather than behind it.
	 */
	constructor(parent: HTMLElement, { behind = false } = {}) {
		const element = document.createElement("img");
		element.className = behind ? "cat prop" : "cat";
		element.draggable = false;
		element.alt = "";
		if (behind) parent.insertBefore(element, parent.firstChild);
		else parent.appendChild(element);
		this.element = element;
	}

	setSize(logical: number): void {
		if (logical === this._size) return;
		this._size = logical;
		this.element.style.width = `${logical}px`;
		this.element.style.height = `${logical}px`;
	}

	/**
	 * The renderer's CSS pixels *are* device-independent pixels, and every rect
	 * main sends has already been converted into them, so there is no scale
	 * factor left to account for here. On GNOME this is where HiDPI is handled;
	 * on Windows it is handled before the simulation ever sees a number.
	 */
	pixelSize(): number {
		return this._size;
	}

	setFrame(frame: FrameHandle): void {
		// Frames are preloaded HTMLImageElements, so assigning src hits the
		// cache and never blanks the sprite mid-animation.
		const source = (frame as HTMLImageElement | undefined)?.src;
		if (!source || source === this._shown) return;
		this._shown = source;
		this.element.src = source;
	}

	place(x: number, y: number, facing: number): void {
		this.element.style.transform = `translate(${x}px, ${y}px) scaleX(${facing})`;
	}

	destroy(): void {
		this.element.remove();
	}
}

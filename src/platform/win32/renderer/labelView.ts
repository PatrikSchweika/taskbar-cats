/**
 * A cat's name tag, drawn as a `<div>` in the overlay window.
 *
 * Never takes the mouse (`pointer-events: none` in the stylesheet), and the
 * text is always plain: `textContent`, never markup.
 */
import type { LabelView } from "../../../core/types.js";

export class DomLabelView implements LabelView {
	private readonly _element: HTMLDivElement;
	private _text = "";

	constructor(parent: HTMLElement) {
		const element = document.createElement("div");
		element.className = "tag";
		element.hidden = true;
		parent.appendChild(element);
		this._element = element;
	}

	setText(text: string): void {
		if (text === this._text) return;
		this._text = text;
		this._element.textContent = text;
	}

	place(centreX: number, bottomY: number): void {
		this._element.style.transform = `translate(${centreX}px, ${bottomY}px) translate(-50%, -100%)`;
	}

	setVisible(visible: boolean): void {
		this._element.hidden = !visible;
	}

	destroy(): void {
		this._element.remove();
	}
}

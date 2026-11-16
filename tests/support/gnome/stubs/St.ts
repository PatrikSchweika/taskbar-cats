import { FakeActor } from "./actor.ts";

/**
 * Simulated HiDPI scale factor. St allocates `icon_size * scale_factor` stage
 * pixels, which is the crux of the HiDPI bug the tests guard against.
 */
let scaleFactor = 1;
export function __setScaleFactor(n: number): void {
	scaleFactor = n;
}
export function __scaleFactor(): number {
	return scaleFactor;
}

export class Icon extends FakeActor {
	gicon: unknown = null;
	override get_preferred_height(_forWidth: number): [number, number] {
		const nat = this.naturalHeight ?? this.icon_size * scaleFactor;
		return [nat, nat];
	}
}

export class Widget extends FakeActor {}
export class BoxLayout extends FakeActor {}
// `declare`, not `= ""`: an initializer would run after FakeActor's
// constructor and wipe the value passed in.
export class Label extends FakeActor {
	declare text: string;
}
/** Tests press one by emitting `clicked`. */
export class Button extends FakeActor {
	declare label: string;
}

export default {
	Icon,
	Widget,
	BoxLayout,
	Label,
	Button,
	__setScaleFactor,
	__scaleFactor,
};

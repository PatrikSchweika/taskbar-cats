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

export default { Icon, Widget, __setScaleFactor, __scaleFactor };

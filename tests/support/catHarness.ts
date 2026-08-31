import type { CatConfig, CatContext } from "../../src/lib/cat.ts";
import type { IconRect } from "../../src/lib/dockTracker.ts";
import type { SpriteSet } from "../../src/lib/sprites.ts";
import { asActor } from "./cast.ts";
import { FakeActor } from "./stubs/actor.ts";

/** A SpriteSet whose frames identify their animation, so tests can read it. */
export function fakeSprites(): SpriteSet {
	return {
		frames: (palette: string, animation: string) =>
			[0, 1, 2, 3].map((frame) => ({ palette, animation, frame })),
		resolvePalettes: (requested: string[]) =>
			requested.length ? requested : ["tabby-orange"],
		palettes: ["tabby-orange"],
		animations: {},
		destroy() {},
	} as unknown as SpriteSet;
}

export function shownAnimation(actor: { gicon: unknown }): string {
	return (actor.gicon as { animation: string }).animation;
}

export const DEFAULT_CFG: CatConfig = {
	maxSpeed: 220,
	attraction: 60,
	attractRadius: 260,
	scratchIcons: true,
	sleepAfter: 20,
	fps: 12,
};

export function makeIcon(x: number, w = 48): IconRect {
	return {
		actor: asActor(new FakeActor()),
		x,
		y: 840,
		w,
		h: w,
		logicalSize: w,
	};
}

export function makeContext(over: Partial<CatContext> = {}): CatContext {
	return {
		roam: { min: 0, max: 1600 },
		floorY: 900,
		icons: [],
		// far away and long still: uninteresting by default
		pointer: { x: -5000, y: -5000, idleTime: 0 },
		neighbours: [],
		cfg: { ...DEFAULT_CFG },
		...over,
	};
}

/** Advance the simulation. Returns the context for chaining. */
export function run(
	cats: { update(dt: number, ctx: CatContext): void }[],
	ctx: CatContext,
	seconds: number,
	dt = 1 / 30,
): void {
	for (let t = 0; t < seconds; t += dt) for (const c of cats) c.update(dt, ctx);
}

/** Run `fn` with Math.random replaced by a repeating sequence. */
export function withRandom<T>(values: number[], fn: () => T): T {
	const real = Math.random;
	let i = 0;
	Math.random = () => values[i++ % values.length];
	try {
		return fn();
	} finally {
		Math.random = real;
	}
}

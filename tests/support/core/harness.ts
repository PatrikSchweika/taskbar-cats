import type { Cat, CatConfig, CatContext } from "../../../src/core/cat.ts";
import type { Bounds, ColonyHost, World } from "../../../src/core/colony.ts";
import { defaultSettings, type Settings } from "../../../src/core/config.ts";
import { Mouse } from "../../../src/core/mouse.ts";
import { Prop, type PropKind } from "../../../src/core/props.ts";
import type {
	CatView,
	FrameHandle,
	IconRect,
	SpriteSource,
} from "../../../src/core/types.ts";

/** A SpriteSource whose frames identify themselves, so tests can read them. */
export function fakeSprites(palettes = ["tabby-orange"]): SpriteSource {
	return {
		palettes,
		frames: (palette: string, animation: string) =>
			[0, 1, 2, 3].map((frame) => ({ palette, animation, frame })),
		propFrames: (name: string) =>
			[0, 1].map((frame) => ({ prop: name, frame })),
	};
}

/**
 * A CatView that just records what the simulation pushed at it.
 *
 * This is the whole rendering contract, which is the point: the physics tests
 * need no windowing system at all, and the same fake stands in for St.Icon and
 * for a DOM element.
 */
export class FakeCatView implements CatView {
	x = 0;
	y = 0;
	facing = 1;
	logicalSize = 0;
	frame: FrameHandle = null;
	destroyed = false;

	/**
	 * Simulated HiDPI scale: what the platform actually allocates for a given
	 * logical size. St allocates `icon_size * scale_factor`, which is the crux
	 * of the HiDPI bug the tests guard against.
	 */
	scale = 1;
	/** False while the view cannot measure itself yet (not on the stage). */
	measurable = true;

	setSize(logical: number): void {
		this.logicalSize = logical;
	}

	pixelSize(): number {
		return this.measurable ? this.logicalSize * this.scale : 0;
	}

	setFrame(frame: FrameHandle): void {
		this.frame = frame;
	}

	place(x: number, y: number, facing: number): void {
		this.x = x;
		this.y = y;
		this.facing = facing;
	}

	destroy(): void {
		this.destroyed = true;
	}
}

/** The recording view behind a cat built by the test helpers. */
export function viewOf(cat: Cat): FakeCatView {
	return cat.view as FakeCatView;
}

export function shownAnimation(cat: Cat): string {
	return (viewOf(cat).frame as { animation: string }).animation;
}

/** The frame number a prop or mouse view is showing. */
export function shownPropFrame(thing: { view: CatView }): number {
	return ((thing.view as FakeCatView).frame as { frame: number }).frame;
}

/** A bed or scratching post standing at `x`, drawn on a recording view. */
export function makeProp(kind: PropKind, x: number, size = 48): Prop {
	return new Prop({
		kind,
		view: new FakeCatView(),
		sprites: fakeSprites(),
		size,
		x,
	});
}

/** A mouse at `x`, setting off in `facing`, drawn on a recording view. */
export function makeMouse(x: number, facing = 1, size = 48): Mouse {
	return new Mouse({
		view: new FakeCatView(),
		sprites: fakeSprites(),
		size,
		x,
		facing,
	});
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
		// Any unique object will do — the simulation only compares identity.
		handle: {},
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
		beds: [],
		scratchers: [],
		mouse: null,
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

// -- the colony -------------------------------------------------------------

/**
 * A ColonyHost whose views are kept, so a test can inspect what the colony
 * drew without reaching through the cats. Cat views and prop views are kept
 * apart, the way the platforms keep them in separate layers.
 */
export function fakeHost(palettes = ["tabby-orange"]): ColonyHost & {
	views: FakeCatView[];
	propViews: FakeCatView[];
} {
	const views: FakeCatView[] = [];
	const propViews: FakeCatView[] = [];
	return {
		views,
		propViews,
		sprites: fakeSprites(palettes),
		createView: () => {
			const view = new FakeCatView();
			views.push(view);
			return view;
		},
		createPropView: () => {
			const view = new FakeCatView();
			propViews.push(view);
			return view;
		},
	};
}

export function makeSettings(over: Partial<Settings> = {}): Settings {
	return { ...defaultSettings(), ...over };
}

/** Bounds a cat can walk: 0..1200 with the floor at 900. */
export function makeBounds(over: Partial<Bounds> = {}): Bounds {
	return { roam: { min: 0, max: 1200 }, floorY: 900, ...over };
}

export function makeWorld(over: Partial<World> = {}): World {
	return {
		...makeBounds(),
		icons: [],
		// far away and long still: uninteresting by default
		pointer: { x: -5000, y: -5000, idleTime: 0 },
		...over,
	};
}

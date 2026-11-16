import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ASK_COOLDOWN,
	ASK_SECONDS,
	BOWL_REACH,
	BOWL_STANCE,
	Cat,
	type CatContext,
	EAT_SECONDS,
	FLEE_SPEED,
	GROOM_GAP,
	State,
	TUSSLE_REACH,
} from "../../src/core/cat.ts";
import type { Prop } from "../../src/core/props.ts";
import type { GameKind } from "../../src/core/social.ts";
import {
	DEFAULT_CFG,
	FakeCatView,
	fakeSprites,
	makeContext,
	makeIcon,
	makeMouse,
	makeProp,
	run,
	shownAnimation,
	viewOf,
	withRandom,
} from "../support/core/harness.ts";

/**
 * @param scale simulated HiDPI scale factor — what the platform allocates for
 * the cat's logical size.
 */
function makeCat(
	over: { size?: number; x?: number; index?: number; scale?: number } = {},
): Cat {
	const view = new FakeCatView();
	view.scale = over.scale ?? 1;
	return new Cat({
		view,
		sprites: fakeSprites(),
		palette: "tabby-orange",
		size: over.size ?? 48,
		x: over.x ?? 800,
		index: over.index ?? 0,
	});
}

describe("Cat", () => {
	describe("placement", () => {
		it("stands with its feet exactly on the floor", () => {
			const cat = makeCat({ size: 48 });
			run([cat], makeContext(), 0.2);
			assert.equal(viewOf(cat).y + cat.size, 900);
		});

		it("centres itself horizontally on its position", () => {
			const cat = makeCat({ size: 48, x: 700 });
			run([cat], makeContext(), 0.2);
			assert.equal(viewOf(cat).x, Math.round(cat.x - cat.size / 2));
		});

		it("still stands on the floor at a 2x scale factor", () => {
			// Regression: the platform allocates logical size * scale factor, so
			// positioning by the logical size sank half the cat off-screen.
			const cat = makeCat({ size: 64, scale: 2 });
			run([cat], makeContext(), 0.2);

			assert.equal(cat.iconSize, 64, "logical size is what the view is told");
			assert.equal(cat.size, 128, "on-screen size is double at 2x");
			assert.equal(viewOf(cat).y + cat.size, 900, "feet on the floor");
		});

		it("resizes when told, keeping its feet down", () => {
			const cat = makeCat({ size: 48 });
			run([cat], makeContext(), 0.2);
			cat.setSize(24);
			run([cat], makeContext(), 0.2);
			assert.equal(cat.size, 24);
			assert.equal(viewOf(cat).y + cat.size, 900);
		});
	});

	describe("roaming", () => {
		it("stays inside the roam range", () => {
			const ctx = makeContext({ roam: { min: 200, max: 600 } });
			const cat = makeCat({ x: 400 });
			run([cat], ctx, 30);
			assert.ok(cat.x >= 200 + cat.size / 2 - 0.001, `x=${cat.x}`);
			assert.ok(cat.x <= 600 - cat.size / 2 + 0.001, `x=${cat.x}`);
		});

		it("roams far beyond the icons even though it favours them", () => {
			// The dock is a narrow band in the middle; the cats are not fenced
			// to it, only biased towards it.
			const ctx = makeContext({
				icons: [makeIcon(776)],
				cfg: { ...DEFAULT_CFG, attraction: 0, sleepAfter: 0 },
			});
			const cat = makeCat({ x: 800 });
			let min = cat.x;
			let max = cat.x;
			for (let t = 0; t < 900; t += 1 / 30) {
				cat.update(1 / 30, ctx);
				min = Math.min(min, cat.x);
				max = Math.max(max, cat.x);
			}
			assert.ok(min < 400, `never went left of the dock (min ${min})`);
			assert.ok(max > 1200, `never went right of the dock (max ${max})`);
		});

		it("hangs around the icons rather than wandering uniformly", () => {
			const nearIcons = (icons: ReturnType<typeof makeIcon>[]): number => {
				const ctx = makeContext({
					icons,
					cfg: { ...DEFAULT_CFG, attraction: 0, sleepAfter: 0 },
				});
				const cat = makeCat({ x: 800 });
				let near = 0;
				let total = 0;
				for (let t = 0; t < 900; t += 1 / 30) {
					cat.update(1 / 30, ctx);
					if (Math.abs(cat.x - 800) < 120) near++;
					total++;
				}
				return near / total;
			};
			const withIcon = nearIcons([makeIcon(776)]);
			const without = nearIcons([]);
			assert.ok(withIcon > 0.5, `only ${withIcon} of the time near icons`);
			assert.ok(
				withIcon > without * 1.5,
				`bias too weak: ${withIcon} vs ${without}`,
			);
		});
	});

	describe("the pointer", () => {
		it("is chased when it is near the floor", () => {
			const ctx = makeContext({
				pointer: { x: 300, y: 880, idleTime: 0 },
			});
			const cat = makeCat({ x: 1200 });
			run([cat], ctx, 12);
			assert.ok(Math.abs(cat.x - 300) < 60, `stopped at ${cat.x}`);
		});

		it("is ignored when attraction is zero", () => {
			const ctx = makeContext({
				pointer: { x: 300, y: 880, idleTime: 0 },
				cfg: { ...DEFAULT_CFG, attraction: 0 },
				icons: [makeIcon(1200)],
			});
			const cat = makeCat({ x: 1200 });
			withRandom([0.1, 0.5], () => run([cat], ctx, 8));
			assert.ok(Math.abs(cat.x - 300) > 200, `chased anyway to ${cat.x}`);
		});

		it("is still chased after the cat has already reached it once", () => {
			// Regression: ALERT/SIT/SLEEP used to root the cat in place, so it
			// could never set off after the pointer a second time.
			const ctx = makeContext({ pointer: { x: 300, y: 880, idleTime: 0 } });
			const cat = makeCat({ x: 1200 });
			run([cat], ctx, 12);
			assert.ok(Math.abs(cat.x - 300) < 60, "first approach");

			ctx.pointer.x = 1400;
			run([cat], ctx, 14);
			assert.ok(Math.abs(cat.x - 1400) < 60, `did not follow, at ${cat.x}`);
		});

		it("spreads the colony out around the pointer instead of stacking", () => {
			const ctx = makeContext({ pointer: { x: 800, y: 880, idleTime: 0 } });
			const cats = [0, 1, 2].map((i) => makeCat({ x: 200 + i, index: i }));
			ctx.neighbours = cats;
			run(cats, ctx, 14);

			const xs = cats.map((c) => c.x).sort((a, b) => a - b);
			assert.ok(xs[1] - xs[0] > 20, `cats bunched: ${xs}`);
			assert.ok(xs[2] - xs[1] > 20, `cats bunched: ${xs}`);
		});

		it("measures the attraction radius in logical pixels", () => {
			// Regression: the radius was compared against stage pixels, so a 2x
			// display silently halved it. 400px above the floor is out of a
			// 260px radius at 1x, and inside it at 2x.
			//
			// 0.049 keeps the wander target on top of the cat's start position,
			// so any movement is attraction and not ambling.
			const PARKED = 0.049;
			const pointer = { x: 1500, y: 500, idleTime: 0 };

			const at1x = makeCat({ x: 100, size: 24, scale: 1 });
			withRandom([PARKED], () =>
				run([at1x], makeContext({ pointer: { ...pointer } }), 6),
			);
			assert.ok(at1x.x < 300, `chased from out of range, reached ${at1x.x}`);

			const at2x = makeCat({ x: 100, size: 24, scale: 2 });
			withRandom([PARKED], () =>
				run([at2x], makeContext({ pointer: { ...pointer } }), 8),
			);
			assert.ok(at2x.x > 800, `did not chase in range, reached ${at2x.x}`);
		});
	});

	describe("resting", () => {
		it("naps once the pointer has been still long enough", () => {
			const ctx = makeContext({
				cfg: { ...DEFAULT_CFG, sleepAfter: 2 },
				pointer: { x: -5000, y: -5000, idleTime: 5 },
			});
			const cat = makeCat();
			run([cat], ctx, 4);
			assert.equal(cat.state, State.SLEEP);
			assert.equal(shownAnimation(cat), "sleep");
		});

		it("wakes when the pointer comes back", () => {
			const ctx = makeContext({
				cfg: { ...DEFAULT_CFG, sleepAfter: 2 },
				pointer: { x: -5000, y: -5000, idleTime: 5 },
			});
			const cat = makeCat();
			run([cat], ctx, 4);
			assert.equal(cat.state, State.SLEEP);

			ctx.pointer = { x: 700, y: 880, idleTime: 0 };
			run([cat], ctx, 1);
			assert.notEqual(cat.state, State.SLEEP);
		});

		it("never sleeps when the nap timer is disabled", () => {
			const ctx = makeContext({
				cfg: { ...DEFAULT_CFG, sleepAfter: 0 },
				pointer: { x: -5000, y: -5000, idleTime: 9999 },
			});
			const cat = makeCat();
			run([cat], ctx, 20);
			assert.notEqual(cat.state, State.SLEEP);
		});

		it("gets up again after sitting", () => {
			// Regression: SIT had no timeout, so a cat that sat down stayed sat
			// for the rest of the session.
			const ctx = makeContext({
				cfg: { ...DEFAULT_CFG, attraction: 0, sleepAfter: 0 },
			});
			// x = minX, so the 0.0 wander target is exactly underfoot: the cat
			// never needs to walk, and only the sit timer can end the sit.
			const cat = makeCat({ x: 24 });
			withRandom([0.0], () => {
				run([cat], ctx, 2);
				assert.equal(cat.state, State.SIT, "should have sat");

				const seen = new Set<string>();
				for (let t = 0; t < 20; t += 1 / 30) {
					cat.update(1 / 30, ctx);
					seen.add(cat.state);
				}
				assert.ok(seen.has(State.IDLE), "never got up again");
				assert.ok(Math.abs(cat.x - 24) < 1, `walked off to ${cat.x}`);
			});
		});
	});

	describe("scratching", () => {
		it("claws an icon it is standing on", () => {
			const icon = makeIcon(776);
			const ctx = makeContext({
				icons: [icon],
				cfg: { ...DEFAULT_CFG, attraction: 0, sleepAfter: 0 },
			});
			const cat = makeCat({ x: 800 });
			withRandom([0.0], () => run([cat], ctx, 2));

			assert.equal(cat.state, State.SCRATCH);
			assert.equal(cat.scratchTarget?.handle, icon.handle);
			assert.equal(shownAnimation(cat), "scratch");
		});

		it("does not claw when the setting is off", () => {
			const ctx = makeContext({
				icons: [makeIcon(776)],
				cfg: {
					...DEFAULT_CFG,
					attraction: 0,
					sleepAfter: 0,
					scratchIcons: false,
				},
			});
			const cat = makeCat({ x: 800 });
			withRandom([0.0], () => run([cat], ctx, 3));
			assert.notEqual(cat.state, State.SCRATCH);
		});

		it("does not claw thin air", () => {
			const ctx = makeContext({
				icons: [makeIcon(100)],
				cfg: { ...DEFAULT_CFG, attraction: 0, sleepAfter: 0 },
			});
			const cat = makeCat({ x: 1400 });
			// keep it still: target itself
			withRandom([0.0], () => run([cat], ctx, 1));
			assert.notEqual(cat.state, State.SCRATCH);
		});

		it("stops after the swipe and does not immediately restart", () => {
			const ctx = makeContext({
				icons: [makeIcon(776)],
				cfg: { ...DEFAULT_CFG, attraction: 0, sleepAfter: 0 },
			});
			const cat = makeCat({ x: 800 });
			withRandom([0.0], () => {
				run([cat], ctx, 2);
				assert.equal(cat.state, State.SCRATCH);
				run([cat], ctx, 2);
				assert.notEqual(cat.state, State.SCRATCH, "swipe should end");
				assert.equal(cat.scratchTarget, null);
				run([cat], ctx, 1.5);
				assert.notEqual(cat.state, State.SCRATCH, "cooldown should hold");
			});
		});

		it("abandons an icon the dock has removed", () => {
			// Regression: holding a destroyed dock actor across ticks and reading
			// a property off it is a hard error in GJS.
			const icon = makeIcon(776);
			const ctx = makeContext({
				icons: [icon],
				cfg: { ...DEFAULT_CFG, attraction: 0, sleepAfter: 0 },
			});
			const cat = makeCat({ x: 800 });
			withRandom([0.0], () => run([cat], ctx, 2));
			assert.equal(cat.state, State.SCRATCH);

			ctx.icons = []; // the dock rebuilt its icons
			withRandom([0.5], () => run([cat], ctx, 0.2));
			assert.notEqual(cat.state, State.SCRATCH);
			assert.equal(cat.scratchTarget, null);
		});
	});

	describe("presentation", () => {
		it("faces the way it is walking", () => {
			const ctx = makeContext({ pointer: { x: 1500, y: 880, idleTime: 0 } });
			const cat = makeCat({ x: 200 });
			run([cat], ctx, 2);
			assert.equal(cat.facing, 1);
			assert.equal(viewOf(cat).facing, 1);

			ctx.pointer.x = 100;
			run([cat], ctx, 3);
			assert.equal(cat.facing, -1);
			assert.equal(viewOf(cat).facing, -1);
		});

		it("uses both gaits", () => {
			const ctx = makeContext({
				cfg: { ...DEFAULT_CFG, attraction: 0, sleepAfter: 0 },
			});
			const cat = makeCat({ x: 800 });
			const seen = new Set<string>();
			for (let t = 0; t < 120; t += 1 / 30) {
				cat.update(1 / 30, ctx);
				seen.add(cat.state);
			}
			assert.ok(seen.has(State.RUN), "never ran");
			assert.ok(seen.has(State.WALK), "never walked");
		});

		it("advances its animation frames", () => {
			const ctx = makeContext({ pointer: { x: 1500, y: 880, idleTime: 0 } });
			const cat = makeCat({ x: 200 });
			const frames = new Set<number>();
			for (let t = 0; t < 1; t += 1 / 30) {
				cat.update(1 / 30, ctx);
				frames.add((viewOf(cat).frame as { frame: number }).frame);
			}
			assert.ok(frames.size > 1, `stuck on frame ${[...frames]}`);
		});
	});

	it("covers a longer distance per second at a 2x scale factor", () => {
		// Speed is a logical-pixel setting, so it must be scaled to stage px.
		const measure = (scale: number): number => {
			const cat = makeCat({ x: 100, size: 24, scale });
			const ctx = makeContext({ pointer: { x: 1500, y: 880, idleTime: 0 } });
			run([cat], ctx, 1);
			return cat.x - 100;
		};
		const at1x = measure(1);
		const at2x = measure(2);
		assert.ok(at2x > at1x * 1.6, `1x moved ${at1x}, 2x moved ${at2x}`);
	});

	describe("passing each other", () => {
		it("walks past a cat that is standing in the way", () => {
			// One cat is called to the pointer on the far side of another that
			// is asleep. Before, the two collided and the sleeper was shoved
			// along in front of the walker for the rest of the trip.
			const walker = makeCat({ x: 400, index: 0 });
			const sleeper = makeCat({ x: 800, index: 1 });
			const cats = [walker, sleeper];
			const forWalker = makeContext({
				pointer: { x: 1200, y: 880, idleTime: 0 },
				neighbours: cats,
			});
			const forSleeper = makeContext({
				cfg: { ...DEFAULT_CFG, sleepAfter: 1 },
				pointer: { x: -5000, y: -5000, idleTime: 60 },
				neighbours: cats,
			});
			for (let t = 0; t < 10; t += 1 / 30) {
				walker.update(1 / 30, forWalker);
				sleeper.update(1 / 30, forSleeper);
			}
			assert.ok(walker.x > 1100, `walker only reached ${walker.x}`);
			assert.ok(
				Math.abs(sleeper.x - 800) < 30,
				`sleeper was shoved to ${sleeper.x}`,
			);
		});

		it("lets two cats heading opposite ways cross", () => {
			const left = makeCat({ x: 300, index: 0 });
			const right = makeCat({ x: 1300, index: 1 });
			const cats = [left, right];
			const forLeft = makeContext({
				pointer: { x: 1300, y: 880, idleTime: 0 },
				neighbours: cats,
			});
			const forRight = makeContext({
				pointer: { x: 300, y: 880, idleTime: 0 },
				neighbours: cats,
			});
			for (let t = 0; t < 12; t += 1 / 30) {
				left.update(1 / 30, forLeft);
				right.update(1 / 30, forRight);
			}
			assert.ok(left.x > 1200, `left-hand cat stuck at ${left.x}`);
			assert.ok(right.x < 400, `right-hand cat stuck at ${right.x}`);
		});

		it("still does not stand on a cat it was heading for", () => {
			// Bound for the spot the other cat occupies, not past it: that is a
			// case for separation, or the two would share a pixel.
			const ctx = makeContext({ pointer: { x: 800, y: 880, idleTime: 0 } });
			const cats = [
				makeCat({ x: 200, index: 0 }),
				makeCat({ x: 800, index: 1 }),
			];
			ctx.neighbours = cats;
			run(cats, ctx, 12);
			const gap = Math.abs(cats[0].x - cats[1].x);
			assert.ok(gap > 20, `cats stacked, ${gap.toFixed(1)}px apart`);
		});

		it("falls in behind a cat walking the same way", () => {
			// Both chase the same mouse; the one behind should not run through
			// the one in front and stack on it.
			const mouse = makeMouse(1500, 1);
			const ctx = makeContext({
				mouse,
				cfg: { ...DEFAULT_CFG, sleepAfter: 0 },
			});
			const cats = [
				makeCat({ x: 700, index: 0 }),
				makeCat({ x: 760, index: 1 }),
			];
			ctx.neighbours = cats;
			let closest = Number.POSITIVE_INFINITY;
			for (let t = 0; t < 2; t += 1 / 30) {
				run(cats, ctx, 1 / 30);
				closest = Math.min(closest, Math.abs(cats[0].x - cats[1].x));
			}
			assert.ok(closest > 15, `piled up, ${closest.toFixed(1)}px apart`);
		});
	});

	describe("beds", () => {
		/** Pointer long gone: a cat with a nap timer of 2s is sleepy at once. */
		const drowsy = () => ({
			cfg: { ...DEFAULT_CFG, sleepAfter: 2 },
			pointer: { x: -5000, y: -5000, idleTime: 5 },
		});

		it("walks to a free bed and curls up in it, lifted onto the cushion", () => {
			const bed = makeProp("bed", 400);
			const ctx = makeContext({ ...drowsy(), beds: [bed] });
			const cat = makeCat({ x: 800, size: 48 });
			run([cat], ctx, 12);

			assert.equal(cat.state, State.SLEEP);
			assert.ok(Math.abs(cat.x - 400) < 20, `stopped at ${cat.x}`);
			assert.equal(bed.occupant, cat);
			assert.equal(cat.bed, bed);
			const feet = viewOf(cat).y + cat.size;
			assert.ok(feet < 900, "should be up on the cushion");
			assert.ok(feet > 900 - 8, `floating ${900 - feet}px above it`);
		});

		it("does not doze off on the way there", () => {
			// Sleepy from the first tick, but the bed is 400px away: the sleep
			// pose must wait until it has arrived, or it flickers asleep for a
			// frame before setting off.
			const bed = makeProp("bed", 400);
			const ctx = makeContext({ ...drowsy(), beds: [bed] });
			const cat = makeCat({ x: 800 });
			for (let t = 0; t < 12; t += 1 / 30) {
				cat.update(1 / 30, ctx);
				if (cat.state === State.SLEEP)
					assert.ok(Math.abs(cat.x - 400) < 20, `asleep at ${cat.x}`);
			}
			assert.equal(cat.state, State.SLEEP, "never got there");
		});

		it("never shares a bed", () => {
			const bed = makeProp("bed", 400);
			const ctx = makeContext({ ...drowsy(), beds: [bed] });
			const cats = [
				makeCat({ x: 500, index: 0 }),
				makeCat({ x: 900, index: 1 }),
			];
			ctx.neighbours = cats;
			run(cats, ctx, 12);

			const inBed = cats.filter((c) => c.bed === bed);
			assert.equal(inBed.length, 1, "both cats claimed the bed");
			for (const cat of cats) assert.equal(cat.state, State.SLEEP);
			const onFloor = cats.find((c) => c.bed !== bed);
			assert.ok(onFloor, "one cat should sleep on the floor");
			assert.equal(
				viewOf(onFloor).y + onFloor.size,
				900,
				"floor-sleeper lifted",
			);
			assert.ok(Math.abs(onFloor.x - 400) > 30, "floor-sleeper is on the bed");
		});

		it("takes the nearest bed", () => {
			const near = makeProp("bed", 700);
			const far = makeProp("bed", 100);
			const ctx = makeContext({ ...drowsy(), beds: [far, near] });
			const cat = makeCat({ x: 800 });
			run([cat], ctx, 6);
			assert.equal(cat.bed, near);
		});

		it("gives the bed back when it wakes", () => {
			const bed = makeProp("bed", 400);
			const ctx = makeContext({ ...drowsy(), beds: [bed] });
			const cat = makeCat({ x: 800 });
			run([cat], ctx, 12);
			assert.equal(bed.occupant, cat);

			ctx.pointer = { x: 700, y: 880, idleTime: 0 };
			run([cat], ctx, 1);
			assert.notEqual(cat.state, State.SLEEP);
			assert.equal(bed.occupant, null);
			assert.equal(cat.bed, null);
			assert.equal(viewOf(cat).y + cat.size, 900, "still lifted");
		});

		it("lets go of a bed the settings removed", () => {
			const bed = makeProp("bed", 400);
			const ctx = makeContext({ ...drowsy(), beds: [bed] });
			const cat = makeCat({ x: 800 });
			run([cat], ctx, 12);
			assert.equal(cat.bed, bed);

			ctx.beds = [];
			run([cat], ctx, 0.5);
			assert.equal(cat.bed, null);
			assert.equal(cat.state, State.SLEEP, "sleeps on the floor instead");
			assert.equal(viewOf(cat).y + cat.size, 900);
		});

		it("frees its bed when destroyed", () => {
			const bed = makeProp("bed", 400);
			const ctx = makeContext({ ...drowsy(), beds: [bed] });
			const cat = makeCat({ x: 800 });
			run([cat], ctx, 12);
			cat.destroy();
			assert.equal(bed.occupant, null);
		});
	});

	describe("scratching posts", () => {
		const settled = { ...DEFAULT_CFG, attraction: 0, sleepAfter: 0 };

		it("claws a post it is standing beside", () => {
			const post = makeProp("scratcher", 800);
			const ctx = makeContext({ scratchers: [post], cfg: settled });
			// Beside it, not on it: the stance the wander target aims for.
			const cat = makeCat({ x: 800 - 17 });
			withRandom([0.0], () => run([cat], ctx, 2));

			assert.equal(cat.state, State.SCRATCH);
			assert.equal(cat.scratchingProp, post);
			assert.equal(cat.scratchTarget, null, "no dock icon is involved");
			assert.equal(cat.facing, 1, "should face the post");
			assert.equal(shownAnimation(cat), "scratch");
		});

		it("claws a post even with icon scratching switched off", () => {
			// The setting is about leaving the dock alone; a post is ours.
			const post = makeProp("scratcher", 800);
			const ctx = makeContext({
				scratchers: [post],
				cfg: { ...settled, scratchIcons: false },
			});
			const cat = makeCat({ x: 800 + 17 });
			withRandom([0.0], () => run([cat], ctx, 2));
			assert.equal(cat.scratchingProp, post);
			assert.equal(cat.facing, -1);
		});

		it("does not claw a post it is nowhere near", () => {
			const ctx = makeContext({
				scratchers: [makeProp("scratcher", 100)],
				cfg: settled,
			});
			const cat = makeCat({ x: 1400 });
			withRandom([0.0], () => run([cat], ctx, 1));
			assert.notEqual(cat.state, State.SCRATCH);
		});

		it("stops after the swipe and lets go of the post", () => {
			const post = makeProp("scratcher", 800);
			const ctx = makeContext({ scratchers: [post], cfg: settled });
			const cat = makeCat({ x: 783 });
			withRandom([0.0], () => {
				run([cat], ctx, 2);
				assert.equal(cat.state, State.SCRATCH);
				run([cat], ctx, 2);
				assert.notEqual(cat.state, State.SCRATCH);
				assert.equal(cat.scratchingProp, null);
			});
		});

		it("abandons a post the settings removed", () => {
			const post = makeProp("scratcher", 800);
			const ctx = makeContext({ scratchers: [post], cfg: settled });
			const cat = makeCat({ x: 783 });
			withRandom([0.0], () => run([cat], ctx, 2));
			assert.equal(cat.state, State.SCRATCH);

			ctx.scratchers = [];
			withRandom([0.5], () => run([cat], ctx, 0.2));
			assert.notEqual(cat.state, State.SCRATCH);
		});

		it("wanders over to a post the way it does to an icon", () => {
			const post = makeProp("scratcher", 300);
			const ctx = makeContext({ scratchers: [post], cfg: settled });
			const cat = makeCat({ x: 1200 });
			let closest = Number.POSITIVE_INFINITY;
			for (let t = 0; t < 120; t += 1 / 30) {
				cat.update(1 / 30, ctx);
				closest = Math.min(closest, Math.abs(cat.x - 300));
			}
			assert.ok(closest < 30, `never came closer than ${closest}px`);
		});
	});

	describe("hunting", () => {
		it("runs the mouse down and pounces on it", () => {
			const mouse = makeMouse(300, 1);
			const ctx = makeContext({
				mouse,
				cfg: { ...DEFAULT_CFG, sleepAfter: 0 },
			});
			const cat = makeCat({ x: 1200 });

			let ran = false;
			let caughtAt = Number.NaN;
			for (let t = 0; t < 10 && !mouse.caught; t += 1 / 30) {
				cat.update(1 / 30, ctx);
				if (cat.state === State.RUN) ran = true;
				caughtAt = t;
			}
			assert.ok(mouse.caught, "never caught it");
			assert.ok(ran, "should have run, not walked");
			assert.ok(caughtAt < 8, `took ${caughtAt}s`);
			assert.equal(cat.state, State.POUNCE);
			assert.equal(shownAnimation(cat), "pounce");
			assert.equal(cat.facing, -1, "should face where the mouse was");

			run([cat], ctx, 1.2);
			assert.notEqual(cat.state, State.POUNCE, "the pounce should end");
		});

		it("forgets the pointer while there is a mouse about", () => {
			const mouse = makeMouse(300, 1);
			const ctx = makeContext({
				mouse,
				pointer: { x: 1500, y: 880, idleTime: 0 },
			});
			const cat = makeCat({ x: 900 });
			run([cat], ctx, 1);
			assert.ok(cat.x < 800, `went after the pointer instead, at ${cat.x}`);
		});

		it("wakes up for a mouse", () => {
			const ctx = makeContext({
				cfg: { ...DEFAULT_CFG, sleepAfter: 2 },
				pointer: { x: -5000, y: -5000, idleTime: 5 },
			});
			const cat = makeCat({ x: 800 });
			run([cat], ctx, 4);
			assert.equal(cat.state, State.SLEEP);

			ctx.mouse = makeMouse(300, 1);
			run([cat], ctx, 0.5);
			assert.notEqual(cat.state, State.SLEEP);
			assert.ok(cat.x < 800, "should be after it");
		});

		it("leaves a mouse another cat already caught", () => {
			const mouse = makeMouse(300, 1);
			mouse.caught = true;
			// 0.9 gives the cat a long first wander timer, so any movement in
			// the window below would be the hunt.
			const cat = withRandom([0.9], () => makeCat({ x: 900 }));
			const ctx = makeContext({
				mouse,
				cfg: { ...DEFAULT_CFG, sleepAfter: 0 },
			});
			run([cat], ctx, 0.3);
			assert.ok(Math.abs(cat.x - 900) < 1, `set off after it, at ${cat.x}`);
			assert.notEqual(cat.state, State.POUNCE);
		});

		it("sits up and watches when it cannot get to the mouse", () => {
			// Standing still with a live mouse in view — held up, or the first
			// tick before it accelerates — reads as alert, not idle.
			// The floor ends at 880, so a cat at 900 is already hard against
			// its left edge with the mouse out of reach beyond it.
			const mouse = makeMouse(300, 1);
			const cat = makeCat({ x: 900 });
			const ctx = makeContext({ mouse, roam: { min: 880, max: 1600 } });
			run([cat], ctx, 1);
			assert.equal(cat.state, State.ALERT);
			assert.equal(mouse.caught, false);
		});
	});

	describe("hunger", () => {
		const DT = 1 / 30;
		/** Hungry after a minute, never sleepy unless a test says so. */
		const peckish = () => ({ ...DEFAULT_CFG, hungerAfter: 60 });
		/** Where a cat of `size` coming from `from` stands to eat from `bowl`. */
		const stance = (bowl: Prop, from: number, size = 48) =>
			bowl.x + Math.sign(from - bowl.x) * BOWL_STANCE * size;

		/** Tick `cats` until `done` holds, at most `seconds`; true if it did. */
		function until(
			cats: Cat[],
			ctx: CatContext,
			seconds: number,
			done: () => boolean,
		): boolean {
			for (let i = 0; i < seconds / DT; i++) {
				for (const cat of cats) cat.update(DT, ctx);
				if (done()) return true;
			}
			return false;
		}

		it("starts each cat at a random hunger below a half", () => {
			const cats = [0, 0.4, 0.999].map((r) => withRandom([r], () => makeCat()));
			for (const cat of cats) {
				assert.ok(cat.hunger >= 0 && cat.hunger < 0.5, `hunger ${cat.hunger}`);
				assert.equal(cat.hungry, false);
			}
		});

		it("does not get hungry without bowls", () => {
			const cat = makeCat({ x: 400 });
			cat.hunger = 0;
			const ctx = makeContext({ cfg: peckish(), bowls: [] });
			run([cat], ctx, 120);
			assert.equal(cat.hunger, 0);
			assert.equal(cat.hungry, false);
		});

		it("grows hungry over hungerAfter seconds", () => {
			const empty = makeProp("bowl", 1500);
			empty.food = 0;
			const cat = makeCat({ x: 400 });
			cat.hunger = 0;
			const ctx = makeContext({ cfg: peckish(), bowls: [empty] });
			for (let i = 0; i < 30 / DT; i++) cat.update(DT, ctx);
			assert.ok(Math.abs(cat.hunger - 0.5) <= 0.02, `hunger ${cat.hunger}`);
		});

		it("is hungry from a hunger of 1", () => {
			const cat = makeCat();
			cat.hunger = 0.99;
			assert.equal(cat.hungry, false);
			cat.hunger = 1;
			assert.equal(cat.hungry, true);
		});

		it("walks to a bowl with food, eats for 4 s, and takes one portion", () => {
			const bowl = makeProp("bowl", 700);
			const cat = makeCat({ x: 400 });
			cat.hunger = 1;
			const ctx = makeContext({ cfg: peckish(), bowls: [bowl] });

			assert.ok(
				until([cat], ctx, 10, () => cat.state === State.EAT),
				`never ate; ${cat.state} at ${cat.x}`,
			);
			const at = stance(bowl, 400, cat.size);
			assert.ok(Math.abs(cat.x - at) <= 14, `eating at ${cat.x}, not ${at}`);
			assert.equal(cat.facing, 1, "should face the bowl");
			assert.equal(cat.bowl, bowl);
			assert.equal(bowl.eater, cat);
			assert.equal(shownAnimation(cat), "eat");
			assert.equal(cat.rooted, true);

			run([cat], ctx, 4.1);
			assert.equal(bowl.food, 2);
			assert.ok(cat.hunger < 0.1, `still hungry: ${cat.hunger}`);
			assert.equal(bowl.eater, null);
			assert.equal(cat.bowl, null);
			assert.notEqual(cat.state, State.EAT);
		});

		it("eats for the whole 4 s before taking the portion", () => {
			const bowl = makeProp("bowl", 700);
			const cat = makeCat({ x: 400 });
			cat.hunger = 1;
			const ctx = makeContext({ cfg: peckish(), bowls: [bowl] });
			until([cat], ctx, 10, () => cat.state === State.EAT);
			run([cat], ctx, EAT_SECONDS - 0.2);
			assert.equal(cat.state, State.EAT);
			assert.equal(bowl.food, 3);
		});

		it("eats before napping", () => {
			const bowl = makeProp("bowl", 700);
			const cat = makeCat({ x: 400 });
			cat.hunger = 1;
			const ctx = makeContext({
				cfg: peckish(),
				bowls: [bowl],
				pointer: { x: -5000, y: -5000, idleTime: 999 },
			});
			let slept = false;
			const ate = until([cat], ctx, 10, () => {
				if (cat.state === State.SLEEP) slept = true;
				return cat.state === State.EAT;
			});
			assert.ok(ate, `never ate; ${cat.state} at ${cat.x}`);
			assert.equal(slept, false, "dozed off hungry");

			// Then naps after.
			run([cat], ctx, EAT_SECONDS + 1);
			assert.equal(cat.state, State.SLEEP);
		});

		it("only one cat eats from a bowl at a time", () => {
			const bowl = makeProp("bowl", 700);
			const cats = [
				makeCat({ x: 400, index: 0 }),
				makeCat({ x: 1000, index: 1 }),
			];
			for (const cat of cats) cat.hunger = 1;
			const ctx = makeContext({
				cfg: peckish(),
				bowls: [bowl],
				neighbours: cats,
			});
			let meals = 0;
			for (let i = 0; i < 10 / DT; i++) {
				for (const cat of cats) cat.update(DT, ctx);
				const eating = cats.filter((c) => c.state === State.EAT);
				assert.ok(eating.length <= 1, "two cats eating from one bowl");
				for (const cat of eating) {
					meals++;
					assert.equal(cat.facing, Math.sign(bowl.x - cat.x), "faces away");
				}
			}
			assert.ok(meals > 0, "nobody ate");
		});

		it("asks beside an empty bowl for 8 s, then leaves it alone for 60 s", () => {
			const bowl = makeProp("bowl", 700);
			bowl.food = 0;
			const cat = makeCat({ x: 400 });
			cat.hunger = 1;
			const ctx = makeContext({ cfg: peckish(), bowls: [bowl] });
			const at = stance(bowl, 400, cat.size);

			assert.ok(
				until([cat], ctx, 10, () => cat.state === State.ALERT),
				`never asked; ${cat.state} at ${cat.x}`,
			);
			assert.ok(Math.abs(cat.x - at) <= 14, `asking at ${cat.x}, not ${at}`);
			assert.equal(cat.facing, 1, "should look at the bowl");
			assert.equal(bowl.eater, null, "an empty bowl is not claimed");

			// Holds the pose for the whole ask, not knocked back to IDLE.
			for (let i = 0; i < (ASK_SECONDS - 0.2) / DT; i++) {
				cat.update(DT, ctx);
				assert.equal(cat.state, State.ALERT);
			}
			run([cat], ctx, 0.3);
			assert.notEqual(cat.state, State.ALERT);

			// Then gives up for a minute: a fixed wander roll keeps it away.
			withRandom([0.1], () => {
				for (let s = 1; s < ASK_COOLDOWN; s++) {
					for (let i = 0; i < 1 / DT; i++) cat.update(DT, ctx);
					assert.ok(
						Math.abs(cat.target - at) > 1,
						`back at the bowl after ${s} s`,
					);
					assert.notEqual(cat.state, State.ALERT, `asking again at ${s} s`);
				}
			});
			assert.equal(cat.hungry, true, "still hungry, only not asking");
		});

		it("asks again once the cooldown runs out", () => {
			const bowl = makeProp("bowl", 700);
			bowl.food = 0;
			const cat = makeCat({ x: 400 });
			cat.hunger = 1;
			const ctx = makeContext({ cfg: peckish(), bowls: [bowl] });
			until([cat], ctx, 10, () => cat.state === State.ALERT);
			run([cat], ctx, ASK_SECONDS + 0.2);
			assert.notEqual(cat.state, State.ALERT);
			run([cat], ctx, ASK_COOLDOWN);
			assert.ok(
				until([cat], ctx, 20, () => cat.state === State.ALERT),
				"never asked again",
			);
		});

		it("eats from a bowl filled while it was asking", () => {
			const bowl = makeProp("bowl", 700);
			bowl.food = 0;
			const cat = makeCat({ x: 400 });
			cat.hunger = 1;
			const ctx = makeContext({ cfg: peckish(), bowls: [bowl] });
			until([cat], ctx, 10, () => cat.state === State.ALERT);
			bowl.refill();
			assert.ok(
				until([cat], ctx, 2, () => cat.state === State.EAT),
				`${cat.state} at ${cat.x}`,
			);
		});

		it("drops a meal for a mouse without using the food", () => {
			const bowl = makeProp("bowl", 700);
			const cat = makeCat({ x: 400 });
			cat.hunger = 1;
			const ctx = makeContext({ cfg: peckish(), bowls: [bowl] });
			assert.ok(until([cat], ctx, 10, () => cat.state === State.EAT));

			ctx.mouse = makeMouse(100, 1);
			cat.update(DT, ctx);
			assert.notEqual(cat.state, State.EAT);
			assert.equal(bowl.food, 3);
			assert.equal(bowl.eater, null);
			assert.equal(cat.bowl, null);
			assert.ok(cat.hunger >= 1, "a meal cut short is no meal");
		});

		it("abandons a meal when its bowl is removed", () => {
			const bowl = makeProp("bowl", 700);
			const cat = makeCat({ x: 400 });
			cat.hunger = 1;
			const ctx = makeContext({ cfg: peckish(), bowls: [bowl] });
			assert.ok(until([cat], ctx, 10, () => cat.state === State.EAT));

			// The colony destroys the bowl and hands out a list without it.
			bowl.destroy();
			ctx.bowls = [];
			assert.doesNotThrow(() => {
				cat.update(DT, ctx);
				cat.update(DT, ctx);
			});
			assert.notEqual(cat.state, State.EAT);
			assert.equal(cat.bowl, null);
			assert.ok(cat.hunger >= 1, `hunger ${cat.hunger}`);
		});

		it("abandons a meal when its bowl is replaced by another", () => {
			// The colony rebuilds every prop when any prop count changes, so a
			// bowl can be swapped for a new one somewhere else mid-meal.
			const bowl = makeProp("bowl", 700);
			const cat = makeCat({ x: 400 });
			cat.hunger = 1;
			const ctx = makeContext({ cfg: peckish(), bowls: [bowl] });
			assert.ok(until([cat], ctx, 10, () => cat.state === State.EAT));

			const other = makeProp("bowl", 1300);
			bowl.destroy();
			ctx.bowls = [other];
			cat.update(DT, ctx);
			assert.notEqual(cat.state, State.EAT, "kept eating from afar");
			assert.equal(other.food, 3);
			assert.ok(cat.hunger >= 1, `hunger ${cat.hunger}`);

			// Still hungry, it walks over and eats a whole meal there.
			assert.ok(
				until([cat], ctx, 10, () => cat.state === State.EAT),
				`${cat.state} at ${cat.x}`,
			);
			const at = stance(other, 400, cat.size);
			assert.ok(Math.abs(cat.x - at) <= 14, `eating at ${cat.x}, not ${at}`);
			run([cat], ctx, EAT_SECONDS - 0.2);
			assert.equal(other.food, 3, "a meal cut short");
			run([cat], ctx, 0.4);
			assert.equal(other.food, 2);
		});

		it("keeps asking through a jostle, and still gives up after 8 s", () => {
			const bowl = makeProp("bowl", 700);
			bowl.food = 0;
			const cat = makeCat({ x: 400 });
			cat.hunger = 1;
			const ctx = makeContext({ cfg: peckish(), bowls: [bowl] });
			assert.ok(until([cat], ctx, 10, () => cat.state === State.ALERT));

			// A neighbour bumps it every second; a bump is not a fresh start.
			let gaveUp = false;
			for (let i = 0; i < (ASK_SECONDS + 1) / DT && !gaveUp; i++) {
				if (i % 30 === 15) cat.vx = 40;
				cat.update(DT, ctx);
				gaveUp = !cat.interrupted;
			}
			assert.ok(gaveUp, `still asking, ${cat.state} at ${cat.x}`);
		});

		/** Big cats: the size where crowding at the bowl used to lock up. */
		const bigCats = [
			{ name: "size 96", size: 96, scale: 1 },
			{ name: "size 48 at 2x", size: 48, scale: 2 },
		];

		for (const { name, size, scale } of [
			{ name: "size 48", size: 48, scale: 1 },
			...bigCats,
		]) {
			it(`${name}: a cat eats where it stands while the others pass it`, () => {
				const bowl = makeProp("bowl", 700);
				const cats = [200, 300, 400].map((x, index) =>
					makeCat({ x, index, size, scale }),
				);
				for (const cat of cats) cat.hunger = 1;
				const ctx = makeContext({
					cfg: peckish(),
					bowls: [bowl],
					neighbours: cats,
				});
				const reach = BOWL_REACH * cats[0].size;
				const spots = new Map<Cat, number>();
				const ate = new Set<Cat>();
				for (let i = 0; i < 60 / DT && ate.size < 3; i++) {
					for (const cat of cats) cat.update(DT, ctx);
					for (const cat of cats) {
						if (cat.state !== State.EAT) {
							spots.delete(cat);
							continue;
						}
						ate.add(cat);
						// Where it should stand, fixed when the meal began.
						let spot = spots.get(cat);
						if (spot === undefined) {
							const side = Math.sign(cat.x - bowl.x) || 1;
							spot = bowl.x + side * BOWL_STANCE * cat.size;
							spots.set(cat, spot);
						}
						assert.ok(
							Math.abs(cat.x - spot) <= reach,
							`eating ${Math.abs(cat.x - spot).toFixed(1)} px from its spot`,
						);
					}
				}
				assert.equal(ate.size, 3, `only ${ate.size} ate`);
			});
		}

		for (const { name, size, scale } of bigCats) {
			/** Two hungry cats coming at the bowl at 700 from the same side. */
			function sameSide(food: number) {
				const bowl = makeProp("bowl", 700);
				bowl.food = food;
				const cats = [
					makeCat({ x: 300, index: 0, size, scale }),
					makeCat({ x: 400, index: 1, size, scale }),
				];
				for (const cat of cats) cat.hunger = 1;
				const ctx = makeContext({
					cfg: peckish(),
					bowls: [bowl],
					neighbours: cats,
				});
				return { bowl, cats, ctx };
			}

			it(`${name}: two cats from the same side both eat, one at a time`, () => {
				const { bowl, cats, ctx } = sameSide(3);
				const ate = new Set<Cat>();
				for (let i = 0; i < 60 / DT && ate.size < 2; i++) {
					for (const cat of cats) cat.update(DT, ctx);
					const eating = cats.filter((c) => c.state === State.EAT);
					assert.ok(eating.length <= 1, "two cats eating from one bowl");
					for (const cat of eating) ate.add(cat);
				}
				assert.equal(ate.size, 2, `only ${ate.size} ate`);
				run(cats, ctx, EAT_SECONDS + 0.5);
				assert.equal(bowl.food, 1);
			});

			it(`${name}: two cats from the same side both ask, then give up`, () => {
				const { cats, ctx } = sameSide(0);
				const asked = new Set<Cat>();
				const gaveUp = new Set<Cat>();
				for (let i = 0; i < 60 / DT && gaveUp.size < 2; i++) {
					for (const cat of cats) cat.update(DT, ctx);
					for (const cat of cats) {
						if (cat.state === State.ALERT) asked.add(cat);
						if (asked.has(cat) && !cat.interrupted) gaveUp.add(cat);
					}
				}
				assert.equal(asked.size, 2, `only ${asked.size} asked`);
				assert.equal(gaveUp.size, 2, `only ${gaveUp.size} gave up`);
				for (const cat of cats) assert.equal(cat.hungry, true);
			});
		}

		it("frees its bowl when destroyed", () => {
			const bowl = makeProp("bowl", 700);
			const cat = makeCat({ x: 400 });
			cat.hunger = 1;
			const ctx = makeContext({ cfg: peckish(), bowls: [bowl] });
			assert.ok(until([cat], ctx, 10, () => cat.state === State.EAT));
			cat.destroy();
			assert.equal(bowl.eater, null);
		});
	});

	describe("play", () => {
		/** Two cats in a game of `kind`, `lead` leading, with mirrored roles. */
		function pair(kind: GameKind, leadX: number, otherX: number): [Cat, Cat] {
			const lead = makeCat({ x: leadX, index: 0 });
			const other = makeCat({ x: otherX, index: 1 });
			lead.play = { kind, partner: other, lead: true };
			other.play = { kind, partner: lead, lead: false };
			return [lead, other];
		}

		it("chases its partner at a run", () => {
			const [lead, other] = pair("chase", 400, 600);
			const ctx = makeContext({ neighbours: [lead, other] });
			let ran = false;
			for (let t = 0; t < 0.5 && !ran; t += 1 / 30) {
				run([lead, other], ctx, 1 / 30);
				ran = lead.state === State.RUN && lead.vx > 0;
			}
			assert.ok(ran, `lead is ${lead.state} at vx ${lead.vx}`);
		});

		it("flees its chaser, at a little under top speed", () => {
			const [lead, other] = pair("chase", 600, 700);
			const ctx = makeContext({ neighbours: [lead, other] });
			run([lead, other], ctx, 0.5);
			assert.ok(other.vx > 0, "runs away from the chaser");
			assert.ok(
				other.vx <= DEFAULT_CFG.maxSpeed * FLEE_SPEED + 0.001,
				`flees at ${other.vx}`,
			);
		});

		it("flees its chaser and dashes past when cornered at an edge", () => {
			const ctx0 = makeContext();
			const edge = ctx0.roam.min + 48;
			const [lead, other] = pair("chase", edge + 120, edge);
			const ctx = makeContext({ neighbours: [lead, other] });
			let past = false;
			for (let t = 0; t < 3 && !past; t += 1 / 30) {
				run([lead, other], ctx, 1 / 30);
				past = other.x > lead.x + 1;
			}
			assert.ok(past, `still left of the chaser: ${other.x} vs ${lead.x}`);
		});

		it("tussles: both rear up facing each other once close", () => {
			const [lead, other] = pair("tussle", 400, 500);
			const ctx = makeContext({ neighbours: [lead, other] });
			run([lead, other], ctx, 2);
			assert.equal(lead.state, State.PLAY);
			assert.equal(other.state, State.PLAY);
			assert.equal(lead.facing, 1, "lead faces right, at its partner");
			assert.equal(other.facing, -1, "partner faces left, at the lead");
			assert.ok(Math.abs(lead.x - other.x) <= TUSSLE_REACH * lead.size);
			assert.equal(shownAnimation(lead), "play");
		});

		it("grooms: the lead grooms, the other sits facing it", () => {
			const [lead, other] = pair("groom", 400, 500);
			const ctx = makeContext({ neighbours: [lead, other] });
			run([lead, other], ctx, 3);
			assert.equal(lead.state, State.GROOM);
			assert.ok(
				Math.abs(lead.x - other.x) <= GROOM_GAP * lead.size + 7,
				`grooming from ${Math.abs(lead.x - other.x)} px away`,
			);
			assert.equal(lead.facing, 1);
			assert.equal(other.state, State.SIT);
			assert.equal(other.facing, -1);
			assert.equal(shownAnimation(lead), "groom");
		});

		it("the groomed cat sits for the whole game", () => {
			// Longer than any _sitFor, which would otherwise stand it up.
			const [lead, other] = pair("groom", 400, 500);
			const ctx = makeContext({
				neighbours: [lead, other],
				cfg: { ...DEFAULT_CFG, sleepAfter: 0 },
			});
			run([lead, other], ctx, 3);
			for (let t = 0; t < 10; t += 1 / 30) {
				run([lead, other], ctx, 1 / 30);
				assert.equal(other.state, State.SIT);
				assert.equal(lead.state, State.GROOM);
			}
		});

		it("partners in a game are not pushed apart", () => {
			const [lead, other] = pair("tussle", 400, 420);
			const ctx = makeContext({ neighbours: [lead, other] });
			for (let t = 0; t < 3; t += 1 / 30) {
				run([lead, other], ctx, 1 / 30);
				const gap = Math.abs(lead.x - other.x);
				assert.ok(gap <= TUSSLE_REACH * lead.size, `pushed ${gap} apart`);
			}
		});

		it("drops play for a mouse", () => {
			const [lead, other] = pair("tussle", 400, 430);
			const ctx = makeContext({ neighbours: [lead, other] });
			run([lead, other], ctx, 0.5);
			assert.equal(lead.state, State.PLAY);
			const hunt = makeContext({
				neighbours: [lead, other],
				mouse: makeMouse(1200),
			});
			run([lead, other], hunt, 1 / 30);
			assert.notEqual(lead.state, State.PLAY);
			assert.notEqual(other.state, State.PLAY);
			assert.equal(lead.interrupted, true);
			assert.equal(other.interrupted, true);
			assert.equal(lead.free, false);
		});

		it("is free only when idle, out of any game and uninterrupted", () => {
			const cat = makeCat({ x: 400 });
			run([cat], makeContext(), 0.1);
			assert.equal(cat.free, true);
			cat.play = { kind: "groom", partner: makeCat(), lead: true };
			assert.equal(cat.free, false, "already playing");
			cat.play = null;
			run([cat], makeContext({ mouse: makeMouse(1200) }), 1 / 30);
			assert.equal(cat.free, false, "hunting");
		});

		it("counts a cat wandering at a run as free", () => {
			// Wandering runs at 0.55 of top speed, which shows as RUN.
			const cat = withRandom([0.9], () => makeCat({ x: 200 }));
			const ctx = makeContext({ cfg: { ...DEFAULT_CFG, sleepAfter: 0 } });
			run([cat], ctx, 0.1);
			cat.play = null;
			let ran = false;
			// Head for the far side and look while it is on its way.
			withRandom([0.95], () => {
				for (let t = 0; t < 4 && !ran; t += 1 / 30) {
					run([cat], ctx, 1 / 30);
					if (cat.state === State.RUN) {
						ran = true;
						assert.equal(cat.free, true, "a running wanderer is free");
					}
				}
			});
			assert.ok(ran, "never broke into a run");
		});

		it("flees away from a new chaser even after dashing past an old one", () => {
			// Cornered at the left edge: the follower dashes right, past the lead.
			const [lead, other] = pair("chase", 168, 48);
			const ctx = makeContext({ neighbours: [lead, other] });
			run([lead, other], ctx, 0.5);
			// Tagged before it got past, it chases for a moment...
			lead.play = { kind: "chase", partner: other, lead: false };
			other.play = { kind: "chase", partner: lead, lead: true };
			run([lead, other], ctx, 1 / 30);
			// ...and is tagged back out in open ground, the chaser to its right.
			lead.play = { kind: "chase", partner: other, lead: true };
			other.play = { kind: "chase", partner: lead, lead: false };
			other.x = 800;
			other.vx = 0;
			lead.x = 900;
			lead.vx = 0;
			run([lead, other], ctx, 0.3);
			assert.ok(other.vx < 0, `ran at its chaser, vx ${other.vx}`);
		});

		it("sits to be groomed by a bigger cat", () => {
			const lead = makeCat({ x: 400, size: 96, index: 0 });
			const other = makeCat({ x: 600, size: 48, index: 1 });
			lead.play = { kind: "groom", partner: other, lead: true };
			other.play = { kind: "groom", partner: lead, lead: false };
			run([lead, other], makeContext({ neighbours: [lead, other] }), 3);
			assert.equal(lead.state, State.GROOM);
			assert.equal(other.state, State.SIT);
			assert.equal(other.facing, -1);
		});

		it("a hungry cat leaves its game for food", () => {
			const bowl = makeProp("bowl", 1200);
			const [lead, other] = pair("tussle", 400, 430);
			const ctx = makeContext({ neighbours: [lead, other], bowls: [bowl] });
			run([lead, other], ctx, 0.5);
			assert.equal(lead.state, State.PLAY);

			lead.hunger = 1;
			run([lead, other], ctx, 1 / 30);
			assert.notEqual(lead.state, State.PLAY);
			assert.equal(lead.interrupted, true);
			assert.equal(lead.free, false);
			assert.ok(
				Math.abs(lead.target - (1200 - BOWL_STANCE * lead.size)) < 1,
				`heading for ${lead.target}, not the bowl`,
			);
		});

		it("leaves PLAY once the game is over", () => {
			const [lead, other] = pair("tussle", 400, 430);
			const ctx = makeContext({ neighbours: [lead, other] });
			run([lead, other], ctx, 0.5);
			assert.equal(lead.state, State.PLAY);
			lead.play = null;
			other.play = null;
			run([lead, other], ctx, 1 / 30);
			assert.notEqual(lead.state, State.PLAY);
			assert.notEqual(other.state, State.PLAY);
		});
	});
});

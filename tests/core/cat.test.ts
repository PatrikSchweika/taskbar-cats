import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Cat, State } from "../../src/core/cat.ts";
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
});

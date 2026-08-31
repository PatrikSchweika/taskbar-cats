import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { Cat, State } from "../src/lib/cat.ts";
import {
	DEFAULT_CFG,
	fakeSprites,
	makeContext,
	makeIcon,
	run,
	shownAnimation,
	withRandom,
} from "./support/catHarness.ts";
import { resetEnv } from "./support/env.ts";

function makeCat(
	over: { size?: number; x?: number; index?: number } = {},
): Cat {
	const cat = new Cat({
		sprites: fakeSprites(),
		palette: "tabby-orange",
		size: over.size ?? 48,
		x: over.x ?? 800,
		index: over.index ?? 0,
	});
	// The real layer parents the actor; St needs a stage for preferred size.
	(globalThis as { stage: { add_child(a: unknown): void } }).stage.add_child(
		cat.actor,
	);
	return cat;
}

describe("Cat", () => {
	beforeEach(() => resetEnv());

	describe("placement", () => {
		it("stands with its feet exactly on the floor", () => {
			const cat = makeCat({ size: 48 });
			run([cat], makeContext(), 0.2);
			assert.equal(cat.actor.y + cat.size, 900);
		});

		it("centres itself horizontally on its position", () => {
			const cat = makeCat({ size: 48, x: 700 });
			run([cat], makeContext(), 0.2);
			assert.equal(cat.actor.x, Math.round(cat.x - cat.size / 2));
		});

		it("still stands on the floor at a 2x scale factor", () => {
			// Regression: St allocates icon_size * scale_factor stage pixels, so
			// positioning by the logical size sank half the cat off-screen.
			resetEnv(2);
			const cat = makeCat({ size: 64 });
			run([cat], makeContext(), 0.2);

			assert.equal(cat.iconSize, 64, "logical size is what St is told");
			assert.equal(cat.size, 128, "stage size is double at 2x");
			assert.equal(cat.actor.y + cat.size, 900, "feet on the floor");
		});

		it("resizes when told, keeping its feet down", () => {
			const cat = makeCat({ size: 48 });
			run([cat], makeContext(), 0.2);
			cat.setSize(24);
			run([cat], makeContext(), 0.2);
			assert.equal(cat.size, 24);
			assert.equal(cat.actor.y + cat.size, 900);
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

			resetEnv(1);
			const at1x = makeCat({ x: 100, size: 24 });
			withRandom([PARKED], () =>
				run([at1x], makeContext({ pointer: { ...pointer } }), 6),
			);
			assert.ok(at1x.x < 300, `chased from out of range, reached ${at1x.x}`);

			resetEnv(2);
			const at2x = makeCat({ x: 100, size: 24 });
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
			assert.equal(shownAnimation(cat.actor), "sleep");
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
			assert.equal(cat.scratchTarget?.actor, icon.actor);
			assert.equal(shownAnimation(cat.actor), "scratch");
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
			assert.equal(cat.actor.scale_x, 1);

			ctx.pointer.x = 100;
			run([cat], ctx, 3);
			assert.equal(cat.facing, -1);
			assert.equal(cat.actor.scale_x, -1);
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
				frames.add((cat.actor.gicon as unknown as { frame: number }).frame);
			}
			assert.ok(frames.size > 1, `stuck on frame ${[...frames]}`);
		});
	});

	it("covers a longer distance per second at a 2x scale factor", () => {
		// Speed is a logical-pixel setting, so it must be scaled to stage px.
		const measure = (scale: number): number => {
			resetEnv(scale);
			const cat = makeCat({ x: 100, size: 24 });
			const ctx = makeContext({ pointer: { x: 1500, y: 880, idleTime: 0 } });
			run([cat], ctx, 1);
			return cat.x - 100;
		};
		const at1x = measure(1);
		const at2x = measure(2);
		assert.ok(at2x > at1x * 1.6, `1x moved ${at1x}, 2x moved ${at2x}`);
	});
});

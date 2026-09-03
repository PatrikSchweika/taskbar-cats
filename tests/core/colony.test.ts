import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { type Cat, State } from "../../src/core/cat.ts";
import {
	boundsOfMonitor,
	Colony,
	interleaveProps,
	PointerTracker,
} from "../../src/core/colony.ts";
import {
	type FakeCatView,
	fakeHost,
	makeBounds,
	makeIcon,
	makeSettings,
	makeWorld,
	shownPropFrame,
	viewOf,
	withRandom,
} from "../support/core/harness.ts";

describe("boundsOfMonitor", () => {
	it("turns a monitor rect into somewhere to walk", () => {
		assert.deepEqual(boundsOfMonitor({ x: 0, y: 0, w: 1920, h: 1080 }), {
			roam: { min: 0, max: 1920 },
			floorY: 1080,
		});
	});

	it("respects a monitor that is not at the origin", () => {
		// A second display to the right, or a primary one below a panel.
		assert.deepEqual(boundsOfMonitor({ x: 1920, y: 200, w: 1280, h: 1024 }), {
			roam: { min: 1920, max: 3200 },
			floorY: 1224,
		});
	});
});

describe("PointerTracker", () => {
	let pointer: PointerTracker;
	beforeEach(() => {
		pointer = new PointerTracker();
	});

	it("starts off-screen and not idle", () => {
		assert.deepEqual(pointer.sample, { x: -1, y: -1, idleTime: 0 });
	});

	it("records a real move and clears the idle time", () => {
		pointer.update(1, 500, 800);
		pointer.update(1, 500, 800);
		assert.equal(pointer.idleTime, 1);

		pointer.update(1, 600, 800);
		assert.deepEqual(pointer.sample, { x: 600, y: 800, idleTime: 0 });
	});

	it("accumulates idle time across still ticks", () => {
		pointer.update(0.5, 500, 800); // the first sample is a move
		pointer.update(0.5, 500, 800);
		pointer.update(0.5, 500, 800);
		assert.equal(pointer.idleTime, 1);
	});

	describe("the jitter threshold", () => {
		beforeEach(() => {
			pointer.update(1, 500, 800);
			assert.equal(pointer.idleTime, 0);
		});

		it("treats a 2px twitch as stillness", () => {
			// A mouse resting on a desk reports small changes forever; without
			// this the cats would never nap.
			pointer.update(1, 502, 800);
			assert.equal(pointer.idleTime, 1, "should still be counting as idle");
		});

		it("treats 3px as movement", () => {
			pointer.update(1, 503, 800);
			assert.equal(pointer.idleTime, 0);
		});

		it("watches both axes", () => {
			pointer.update(1, 500, 803);
			assert.equal(pointer.idleTime, 0);
		});

		it("notices a slow drift rather than ignoring it forever", () => {
			// The reference point is deliberately not updated by a twitch, so
			// 2px a tick accumulates until it crosses the threshold instead of
			// creeping across the screen unnoticed.
			pointer.update(1, 502, 800);
			assert.equal(pointer.idleTime, 1);
			pointer.update(1, 504, 800);
			assert.equal(pointer.idleTime, 0, "4px from the reference is a move");
		});
	});

	it("forgets everything on reset", () => {
		// enable() reuses the tracker, and a stale position would make the cats
		// think the pointer had jumped.
		pointer.update(1, 500, 800);
		pointer.update(1, 500, 800);
		pointer.reset();
		assert.deepEqual(pointer.sample, { x: -1, y: -1, idleTime: 0 });
	});
});

describe("Colony", () => {
	describe("sizeFor", () => {
		const colony = new Colony(fakeHost());

		it("uses a pinned size whatever the dock says", () => {
			assert.equal(
				colony.sizeFor(makeSettings({ spriteSize: 72 }), [makeIcon(0, 40)]),
				72,
			);
		});

		it("falls back to 40 before the dock can be measured", () => {
			// Extension load order is not guaranteed on GNOME, and the taskbar
			// has not been read yet on Windows.
			assert.equal(colony.sizeFor(makeSettings(), []), 40);
		});

		it("matches the dock's icon size", () => {
			const icons = [48, 48, 48].map((n) => ({
				...makeIcon(0),
				logicalSize: n,
			}));
			assert.equal(colony.sizeFor(makeSettings(), icons), 48);
		});

		it("takes the median, so one odd icon does not decide it", () => {
			const icons = [40, 48, 200].map((n) => ({
				...makeIcon(0),
				logicalSize: n,
			}));
			assert.equal(colony.sizeFor(makeSettings(), icons), 48);
		});

		it("ignores icons whose size could not be read", () => {
			// dockTracker reports 0 when the actor has no icon_size.
			const icons = [0, 0, 48].map((n) => ({ ...makeIcon(0), logicalSize: n }));
			assert.equal(
				colony.sizeFor(makeSettings(), icons),
				48,
				"a zero should not drag the median down",
			);
		});

		it("clamps to something a cat can actually be", () => {
			const at = (n: number) =>
				colony.sizeFor(makeSettings(), [{ ...makeIcon(0), logicalSize: n }]);
			assert.equal(at(400), 96, "a huge dock icon");
			assert.equal(at(8), 20, "a tiny one");
		});

		it("rounds to whole pixels", () => {
			assert.equal(
				colony.sizeFor(makeSettings(), [{ ...makeIcon(0), logicalSize: 47.6 }]),
				48,
			);
		});

		it("does not reorder the icons it was given", () => {
			// They arrive left to right, update() passes the same array to the
			// cats, and a cat decides what it is standing under from it.
			const icons = [300, 100, 200].map((x) => makeIcon(x));
			colony.sizeFor(makeSettings(), icons);
			assert.deepEqual(
				icons.map((i) => i.x),
				[300, 100, 200],
			);
		});
	});

	describe("sync", () => {
		it("puts out the configured number of cats", () => {
			const host = fakeHost();
			const colony = new Colony(host);
			colony.sync(makeSettings({ count: 4 }), [], makeBounds());

			assert.equal(colony.cats.length, 4);
			assert.equal(host.views.length, 4, "one view each");
		});

		it("spreads them evenly instead of stacking them at one edge", () => {
			const colony = new Colony(fakeHost());
			colony.sync(makeSettings({ count: 3 }), [], makeBounds());
			assert.deepEqual(
				colony.cats.map((c) => c.x),
				[300, 600, 900],
			);
		});

		it("spreads them across the monitor it is actually given", () => {
			const colony = new Colony(fakeHost());
			colony.sync(
				makeSettings({ count: 1 }),
				[],
				makeBounds({ roam: { min: 1920, max: 3200 } }),
			);
			assert.equal(colony.cats[0].x, 2560, "the middle of the second display");
		});

		it("still places them when there are no bounds yet", () => {
			// The dock has not been found; the cats appear anyway and are moved
			// into range on the first tick that has bounds.
			const colony = new Colony(fakeHost());
			colony.sync(makeSettings({ count: 2 }), [], null);
			assert.deepEqual(
				colony.cats.map((c) => c.x),
				[100, 160],
			);
		});

		describe("changing the count", () => {
			it("keeps the cats it already had when growing", () => {
				const colony = new Colony(fakeHost());
				colony.sync(makeSettings({ count: 2 }), [], makeBounds());
				const [first, second] = colony.cats;

				colony.sync(makeSettings({ count: 4 }), [], makeBounds());

				assert.equal(colony.cats.length, 4);
				assert.equal(colony.cats[0], first, "the first cat was replaced");
				assert.equal(colony.cats[1], second);
			});

			it("destroys the ones it removes", () => {
				const host = fakeHost();
				const colony = new Colony(host);
				colony.sync(makeSettings({ count: 3 }), [], makeBounds());
				const doomed = colony.cats[2];

				colony.sync(makeSettings({ count: 1 }), [], makeBounds());

				assert.equal(colony.cats.length, 1);
				assert.equal(
					(doomed.view as FakeCatView).destroyed,
					true,
					"a removed cat's view must go with it",
				);
			});

			it("tells the platform about each cat it removes", () => {
				// GNOME uses this to stop shaking the icon that cat was clawing;
				// without it the dock would be left crooked.
				const colony = new Colony(fakeHost());
				colony.sync(makeSettings({ count: 4 }), [], makeBounds());
				const [, , third, fourth] = colony.cats;
				const removed: Cat[] = [];

				colony.sync(makeSettings({ count: 2 }), [], makeBounds(), (cat) =>
					removed.push(cat),
				);

				// Called for exactly the cats that went, from the end, and
				// before they were destroyed — the callback reads their state.
				assert.deepEqual(removed, [fourth, third]);
				for (const cat of removed)
					assert.ok(!colony.cats.includes(cat), "still in the colony");
			});

			it("leaves every cat's index equal to its position", () => {
				// index is what fans the colony out around the pointer, so a gap
				// or a duplicate would pile cats on one spot. Today this holds
				// for free — cats are only ever added and removed at the end —
				// so it is pinned as the invariant rather than as one line's
				// behaviour: it is what makes removing from the end safe.
				const colony = new Colony(fakeHost());
				for (const count of [5, 3, 4, 1]) {
					colony.sync(makeSettings({ count }), [], makeBounds());
					assert.deepEqual(
						colony.cats.map((c) => c.index),
						colony.cats.map((_, i) => i),
						`wrong after syncing to ${count}`,
					);
				}
			});
		});

		describe("palettes", () => {
			it("cycles through the chosen ones", () => {
				const host = fakeHost(["a", "b", "c"]);
				const colony = new Colony(host);
				colony.sync(
					makeSettings({ count: 5, palettes: ["a", "b", "c"] }),
					[],
					makeBounds(),
				);
				assert.deepEqual(
					colony.cats.map((c) => c.palette),
					["a", "b", "c", "a", "b"],
				);
			});

			it("treats an empty choice as 'all of them'", () => {
				const colony = new Colony(fakeHost(["a", "b"]));
				colony.sync(makeSettings({ count: 2, palettes: [] }), [], makeBounds());
				assert.deepEqual(
					colony.cats.map((c) => c.palette),
					["a", "b"],
				);
			});

			it("drops a palette that no longer exists on disk", () => {
				const colony = new Colony(fakeHost(["a", "b"]));
				colony.sync(
					makeSettings({ count: 2, palettes: ["a", "gone"] }),
					[],
					makeBounds(),
				);
				assert.deepEqual(
					colony.cats.map((c) => c.palette),
					["a", "a"],
				);
			});

			it("falls back to every palette when none of the choices exist", () => {
				const colony = new Colony(fakeHost(["a", "b"]));
				colony.sync(
					makeSettings({ count: 2, palettes: ["gone", "also-gone"] }),
					[],
					makeBounds(),
				);
				assert.deepEqual(
					colony.cats.map((c) => c.palette),
					["a", "b"],
				);
			});

			it("names a palette even when the install has none at all", () => {
				// A broken install should still draw a cat-shaped nothing rather
				// than crash on an undefined palette.
				const colony = new Colony(fakeHost([]));
				colony.sync(makeSettings({ count: 1 }), [], makeBounds());
				assert.equal(colony.cats[0].palette, "tabby-orange");
			});

			it("reassigns palettes when the choice changes", () => {
				const colony = new Colony(fakeHost(["a", "b"]));
				colony.sync(
					makeSettings({ count: 2, palettes: ["a"] }),
					[],
					makeBounds(),
				);
				assert.deepEqual(
					colony.cats.map((c) => c.palette),
					["a", "a"],
				);

				colony.sync(
					makeSettings({ count: 2, palettes: ["b"] }),
					[],
					makeBounds(),
				);
				assert.deepEqual(
					colony.cats.map((c) => c.palette),
					["b", "b"],
					"an existing cat should change coat",
				);
			});
		});

		it("resizes the cats it already had", () => {
			const colony = new Colony(fakeHost());
			colony.sync(makeSettings({ count: 2 }), [], makeBounds());
			colony.sync(makeSettings({ count: 2, spriteSize: 64 }), [], makeBounds());
			for (const cat of colony.cats) {
				assert.equal(cat.iconSize, 64);
				assert.equal(viewOf(cat).logicalSize, 64);
			}
		});
	});

	describe("update", () => {
		it("stands every cat on the floor it is told about", () => {
			// The one thing that proves the world was plumbed through: floorY
			// arrives from the platform and ends up under the cats' feet.
			const colony = new Colony(fakeHost());
			const settings = makeSettings({ count: 3 });
			colony.sync(settings, [], makeBounds());
			colony.update(1 / 30, makeWorld(), settings);

			for (const cat of colony.cats)
				assert.equal(viewOf(cat).y + cat.size, 900);
		});

		it("keeps them inside the roam range", () => {
			const colony = new Colony(fakeHost());
			const settings = makeSettings({ count: 2, sleepAfter: 0 });
			const world = makeWorld({ roam: { min: 400, max: 700 } });
			colony.sync(settings, [], world);

			for (let t = 0; t < 20; t += 1 / 30) {
				colony.update(1 / 30, world, settings);
				for (const cat of colony.cats) {
					assert.ok(cat.x >= 400, `${cat.x} escaped left`);
					assert.ok(cat.x <= 700, `${cat.x} escaped right`);
				}
			}
		});

		it("chases a pointer near the floor", () => {
			const colony = new Colony(fakeHost());
			const settings = makeSettings({ count: 1, sleepAfter: 0 });
			colony.sync(settings, [], makeBounds());
			colony.cats[0].x = 100;

			const world = makeWorld({ pointer: { x: 1100, y: 880, idleTime: 0 } });
			// Long enough to arrive: at the default speed and attraction a cat
			// covers roughly 170px a second, so 1000px takes about six.
			for (let t = 0; t < 10; t += 1 / 30)
				colony.update(1 / 30, world, settings);

			assert.ok(colony.cats[0].x > 1000, `only reached ${colony.cats[0].x}`);
		});

		it("resizes the cats when the dock turns up late", () => {
			// Regression territory: the colony starts before the dock exists, so
			// the size it picked at sync time has to be revisited every tick.
			const colony = new Colony(fakeHost());
			const settings = makeSettings({ count: 2 });
			colony.sync(settings, [], makeBounds());
			assert.equal(colony.cats[0].iconSize, 40, "the fallback size");

			const icons = [64, 64].map((n) => ({ ...makeIcon(0), logicalSize: n }));
			colony.update(1 / 30, makeWorld({ icons }), settings);

			for (const cat of colony.cats) {
				assert.equal(cat.iconSize, 64);
				assert.equal(viewOf(cat).logicalSize, 64);
			}
		});

		it("lets the cats see each other", () => {
			// neighbours has to be the live colony, or they stack on one pixel.
			const colony = new Colony(fakeHost());
			// attraction 0 so the pointer pulls nobody anywhere.
			const settings = makeSettings({ count: 2, sleepAfter: 0, attraction: 0 });
			const world = makeWorld();

			withRandom([0.049], () => {
				colony.sync(settings, [], makeBounds());

				// Settle first, so both cats are heading for the *same* wander
				// target. Without this they still drift apart — sync spreads
				// them, and each one's opening target is wherever it was put —
				// which looks exactly like separation and is not.
				for (let t = 0; t < 0.5; t += 1 / 30)
					colony.update(1 / 30, world, settings);

				colony.cats[0].x = 600;
				// Not the same pixel: a gap of exactly zero has no direction to
				// push along, so the cats would stay welded together.
				colony.cats[1].x = 601;

				for (let t = 0; t < 0.4; t += 1 / 30)
					colony.update(1 / 30, world, settings);
			});

			// Roughly 37px apart when they can see each other, and still 1px
			// apart when they cannot.
			const gap = Math.abs(colony.cats[0].x - colony.cats[1].x);
			assert.ok(gap > 20, `cats are stacked, ${gap.toFixed(1)}px apart`);
		});

		it("shows the cats the icons, so they have something to claw", () => {
			const colony = new Colony(fakeHost());
			const settings = makeSettings({
				count: 1,
				attraction: 0,
				sleepAfter: 0,
			});
			const icon = makeIcon(776);
			const world = makeWorld({ icons: [icon] });

			// Two seconds, not three: a swipe lasts 1.7s and then the cat goes
			// back to idling, so a longer run would look like it never started.
			withRandom([0.0], () => {
				colony.sync(settings, world.icons, makeBounds());
				colony.cats[0].x = 800;
				for (let t = 0; t < 2; t += 1 / 30)
					colony.update(1 / 30, world, settings);
			});

			assert.equal(colony.cats[0].state, State.SCRATCH);
			assert.equal(colony.cats[0].scratchTarget?.handle, icon.handle);
		});

		it("does nothing at all with no cats", () => {
			const colony = new Colony(fakeHost());
			assert.doesNotThrow(() =>
				colony.update(1 / 30, makeWorld(), makeSettings()),
			);
		});
	});

	describe("allAsleep", () => {
		/** Run until every cat has nodded off, with the pointer long gone. */
		function sleep(colony: Colony, settings = makeSettings({ count: 2 })) {
			const world = makeWorld({
				pointer: { x: -5000, y: -5000, idleTime: 60 },
			});
			for (let t = 0; t < 8; t += 1 / 30)
				colony.update(1 / 30, world, settings);
		}

		it("is false while anything is still awake", () => {
			const colony = new Colony(fakeHost());
			const settings = makeSettings({ count: 2 });
			colony.sync(settings, [], makeBounds());
			assert.equal(colony.allAsleep(settings), false);
		});

		it("is true once every cat is asleep", () => {
			// This is what drops the tick to 4Hz.
			const colony = new Colony(fakeHost());
			const settings = makeSettings({ count: 2, sleepAfter: 1 });
			colony.sync(settings, [], makeBounds());
			sleep(colony, settings);

			assert.deepEqual(
				colony.cats.map((c) => c.state),
				[State.SLEEP, State.SLEEP],
			);
			assert.equal(colony.allAsleep(settings), true);
		});

		it("is false when one cat is still up", () => {
			const colony = new Colony(fakeHost());
			const settings = makeSettings({ count: 2, sleepAfter: 1 });
			colony.sync(settings, [], makeBounds());
			sleep(colony, settings);
			colony.cats[1].state = State.IDLE;

			assert.equal(colony.allAsleep(settings), false);
		});

		it("is false when sleeping is switched off", () => {
			// sleepAfter 0 means they never nap, so the tick must stay awake.
			const colony = new Colony(fakeHost());
			const settings = makeSettings({ count: 2, sleepAfter: 1 });
			colony.sync(settings, [], makeBounds());
			sleep(colony, settings);

			assert.equal(colony.allAsleep(makeSettings({ sleepAfter: 0 })), false);
		});

		it("is false with no cats, however still the pointer is", () => {
			// Otherwise a colony of nought would report itself asleep and park
			// the tick at 4Hz forever.
			const colony = new Colony(fakeHost());
			assert.equal(colony.allAsleep(makeSettings({ sleepAfter: 1 })), false);
		});
	});

	describe("destroy", () => {
		it("takes every cat and its view with it", () => {
			const host = fakeHost();
			const colony = new Colony(host);
			colony.sync(makeSettings({ count: 3 }), [], makeBounds());

			colony.destroy();

			assert.equal(colony.cats.length, 0);
			assert.equal(host.views.length, 3, "the views were still created");
			for (const view of host.views) assert.equal(view.destroyed, true);
		});

		it("leaves a colony that can be filled again", () => {
			// disable() then enable() on GNOME, and the size has to be worked
			// out afresh rather than remembered from the last run.
			const host = fakeHost();
			const colony = new Colony(host);
			colony.sync(makeSettings({ count: 2 }), [], makeBounds());
			colony.destroy();

			const settings = makeSettings({ count: 2 });
			colony.sync(settings, [], makeBounds());
			const icons = [64, 64].map((n) => ({ ...makeIcon(0), logicalSize: n }));
			colony.update(1 / 30, makeWorld({ icons }), settings);

			assert.equal(colony.cats.length, 2);
			for (const cat of colony.cats) assert.equal(cat.iconSize, 64);
		});

		it("is safe to call twice", () => {
			const colony = new Colony(fakeHost());
			colony.sync(makeSettings({ count: 2 }), [], makeBounds());
			colony.destroy();
			assert.doesNotThrow(() => colony.destroy());
		});
	});

	describe("furniture", () => {
		/** Two icons in the middle of a 0..1200 floor. */
		const dock = () => [makeIcon(500), makeIcon(650)];

		it("alternates beds and posts", () => {
			assert.deepEqual(interleaveProps(2, 1), ["bed", "scratcher", "bed"]);
			assert.deepEqual(interleaveProps(0, 2), ["scratcher", "scratcher"]);
			assert.deepEqual(interleaveProps(0, 0), []);
		});

		it("puts out the configured beds and posts, on prop views", () => {
			const host = fakeHost();
			const colony = new Colony(host);
			colony.sync(
				makeSettings({ count: 2, beds: 2, scratchers: 1 }),
				[],
				makeBounds(),
			);

			assert.deepEqual(
				colony.props.map((p) => p.kind),
				["bed", "scratcher", "bed"],
			);
			assert.equal(colony.beds.length, 2);
			assert.equal(colony.scratchers.length, 1);
			assert.equal(host.propViews.length, 3, "props go under the cats");
			assert.equal(host.views.length, 2, "cats do not");
		});

		it("keeps them off the dock's icons", () => {
			const colony = new Colony(fakeHost());
			colony.sync(
				makeSettings({ beds: 3, scratchers: 3 }),
				dock(),
				makeBounds(),
			);
			for (const prop of colony.props)
				assert.ok(
					prop.x < 500 - 20 || prop.x > 698 + 20,
					`${prop.kind} at ${prop.x} is on the dock`,
				);
		});

		it("stands them on the floor at the cats' size", () => {
			const colony = new Colony(fakeHost());
			const settings = makeSettings({ beds: 1, scratchers: 1 });
			colony.sync(settings, [], makeBounds());
			colony.update(1 / 30, makeWorld(), settings);
			for (const prop of colony.props) {
				const view = prop.view as FakeCatView;
				assert.equal(view.y + prop.size, 900);
				assert.equal(view.x, Math.round(prop.x - prop.size / 2));
				assert.equal(prop.iconSize, 40, "the fallback cat size");
			}
		});

		it("resizes the furniture when the dock turns up", () => {
			const colony = new Colony(fakeHost());
			const settings = makeSettings({ beds: 1 });
			colony.sync(settings, [], makeBounds());
			const icons = [64, 64].map((n) => ({ ...makeIcon(500), logicalSize: n }));
			colony.update(1 / 30, makeWorld({ icons }), settings);
			assert.equal(colony.props[0].iconSize, 64);
		});

		it("lays the furniture out afresh when the dock first appears", () => {
			const colony = new Colony(fakeHost());
			const settings = makeSettings({ beds: 1 });
			colony.sync(settings, [], makeBounds());
			const before = colony.props[0].x;
			assert.equal(before, 600, "centred while there is no dock");

			colony.update(1 / 30, makeWorld({ icons: dock() }), settings);
			const after = colony.props[0].x;
			assert.notEqual(after, before);
			assert.ok(after < 480 || after > 718, `${after} is on the dock`);
		});

		it("does not shuffle the furniture when an app is launched", () => {
			// The icon span grows with every new app; a bed that slid along the
			// floor would wake the cat asleep in it to walk after it.
			const colony = new Colony(fakeHost());
			const settings = makeSettings({ beds: 2, scratchers: 1 });
			const icons = dock();
			colony.sync(settings, icons, makeBounds());
			colony.update(1 / 30, makeWorld({ icons }), settings);
			const placed = colony.props.map((p) => p.x);

			const more = [...icons, makeIcon(800)];
			colony.update(1 / 30, makeWorld({ icons: more }), settings);
			assert.deepEqual(
				colony.props.map((p) => p.x),
				placed,
			);
		});

		it("moves the furniture to a new monitor", () => {
			const colony = new Colony(fakeHost());
			const settings = makeSettings({ beds: 1 });
			colony.sync(settings, [], makeBounds());
			colony.update(
				1 / 30,
				makeWorld({ roam: { min: 1920, max: 3200 } }),
				settings,
			);
			assert.equal(colony.props[0].x, 2560);
		});

		it("removes them again, destroying their views", () => {
			const host = fakeHost();
			const colony = new Colony(host);
			colony.sync(makeSettings({ beds: 2 }), [], makeBounds());
			colony.sync(makeSettings({ beds: 0 }), [], makeBounds());
			assert.equal(colony.props.length, 0);
			for (const view of host.propViews) assert.equal(view.destroyed, true);
		});

		it("keeps the same props across a sync that changes nothing", () => {
			// A cat's claimed bed is an object reference; rebuilding the props
			// on every settings change would evict it for no reason.
			const colony = new Colony(fakeHost());
			colony.sync(makeSettings({ beds: 1, count: 1 }), [], makeBounds());
			const [bed] = colony.props;
			colony.sync(makeSettings({ beds: 1, count: 2 }), [], makeBounds());
			assert.equal(colony.props[0], bed);
		});

		it("rocks a post while a cat claws it", () => {
			const colony = new Colony(fakeHost());
			const settings = makeSettings({
				count: 1,
				scratchers: 1,
				attraction: 0,
				sleepAfter: 0,
			});
			const world = makeWorld();
			const frames = new Set<number>();
			withRandom([0.0], () => {
				colony.sync(settings, [], world);
				const [post] = colony.props;
				colony.cats[0].x = post.x - 17;
				for (let t = 0; t < 2; t += 1 / 30) {
					colony.update(1 / 30, world, settings);
					frames.add(shownPropFrame(post));
				}
				assert.equal(colony.cats[0].scratchingProp, post);
			});
			assert.ok(frames.size > 1, "the post never moved");
		});

		it("lets a cat sleep in a bed", () => {
			// End to end: the bed the colony made is the one the cat finds.
			const colony = new Colony(fakeHost());
			const settings = makeSettings({ count: 1, beds: 1, sleepAfter: 1 });
			const world = makeWorld({
				pointer: { x: -5000, y: -5000, idleTime: 60 },
			});
			colony.sync(settings, [], world);
			for (let t = 0; t < 12; t += 1 / 30)
				colony.update(1 / 30, world, settings);
			assert.equal(colony.cats[0].bed, colony.props[0]);
			assert.equal(colony.cats[0].state, State.SLEEP);
			assert.equal(colony.allAsleep(settings), true);
		});
	});

	describe("the mouse", () => {
		const every10s = () =>
			makeSettings({ count: 1, mouseInterval: 10, sleepAfter: 0 });

		function tick(colony: Colony, settings = every10s(), seconds = 1) {
			const world = makeWorld();
			for (let t = 0; t < seconds; t += 1 / 30)
				colony.update(1 / 30, world, settings);
		}

		it("never appears when visits are switched off", () => {
			const host = fakeHost();
			const colony = new Colony(host);
			const settings = makeSettings({ count: 1, mouseInterval: 0 });
			colony.sync(settings, [], makeBounds());
			tick(colony, settings, 60);
			assert.equal(colony.mouse, null);
			assert.equal(host.propViews.length, 0);
		});

		it("appears after roughly the configured interval, on a prop view", () => {
			const host = fakeHost();
			const colony = new Colony(host);
			// 0.5 makes the first wait exactly the interval.
			withRandom([0.5], () => {
				colony.sync(every10s(), [], makeBounds());
				tick(colony, every10s(), 9.5);
				assert.equal(colony.mouse, null, "too early");
				tick(colony, every10s(), 1);
			});
			assert.ok(colony.mouse, "no mouse");
			assert.equal(host.propViews.length, 1);
		});

		it("comes in from a screen edge", () => {
			const colony = new Colony(fakeHost());
			withRandom([0.5], () => {
				colony.sync(every10s(), [], makeBounds());
				// Tick by tick, so it is caught the moment it appears and before
				// it has taken a step.
				for (let i = 0; i < 400 && !colony.mouse; i++)
					tick(colony, every10s(), 1 / 30);
			});
			const mouse = colony.mouse;
			assert.ok(mouse);
			// 0.5 is not < 0.5, so it comes in from the right, facing left.
			assert.equal(mouse.x, 1200 - mouse.size / 2);
			assert.equal(mouse.facing, -1);
		});

		it("is taken away once caught, and the wait starts over", () => {
			const host = fakeHost();
			const colony = new Colony(host);
			withRandom([0.5], () => {
				colony.sync(every10s(), [], makeBounds());
				tick(colony, every10s(), 10.1);
				const mouse = colony.mouse;
				assert.ok(mouse);
				mouse.caught = true;
				tick(colony, every10s(), 1 / 30);
				assert.equal(colony.mouse, null);
				assert.equal((mouse.view as FakeCatView).destroyed, true);

				tick(colony, every10s(), 5);
				assert.equal(colony.mouse, null, "came straight back");
			});
		});

		it("is taken away once it has left the screen", () => {
			const colony = new Colony(fakeHost());
			withRandom([0.5], () => {
				colony.sync(every10s(), [], makeBounds());
				tick(colony, every10s(), 10.1);
				const mouse = colony.mouse;
				assert.ok(mouse);
				mouse.gone = true;
				tick(colony, every10s(), 1 / 30);
			});
			assert.equal(colony.mouse, null);
		});

		it("goes away when visits are switched off mid-visit", () => {
			const colony = new Colony(fakeHost());
			withRandom([0.5], () => {
				colony.sync(every10s(), [], makeBounds());
				tick(colony, every10s(), 10.1);
			});
			assert.ok(colony.mouse);
			colony.sync(
				makeSettings({ count: 1, mouseInterval: 0 }),
				[],
				makeBounds(),
			);
			assert.equal(colony.mouse, null);
		});

		it("gets caught by the cats", () => {
			// End to end, with real randomness: one cat, one mouse, a floor to
			// chase it along. Thirty seconds is generous; it usually takes five.
			const colony = new Colony(fakeHost());
			const settings = every10s();
			colony.sync(settings, [], makeBounds());
			let appeared = false;
			let caught = false;
			const world = makeWorld();
			for (let t = 0; t < 45 && !caught; t += 1 / 30) {
				colony.update(1 / 30, world, settings);
				if (colony.mouse) appeared = true;
				if (colony.cats[0].state === State.POUNCE) caught = true;
			}
			assert.ok(appeared, "no mouse ever came");
			assert.ok(caught, "the mouse was never caught");
		});

		it("wakes a sleeping colony", () => {
			const colony = new Colony(fakeHost());
			const settings = makeSettings({
				count: 2,
				mouseInterval: 10,
				sleepAfter: 1,
			});
			const world = makeWorld({
				pointer: { x: -5000, y: -5000, idleTime: 60 },
			});
			withRandom([0.5], () => {
				colony.sync(settings, [], world);
				for (let t = 0; t < 8; t += 1 / 30)
					colony.update(1 / 30, world, settings);
				assert.equal(
					colony.allAsleep(settings),
					true,
					"should be asleep first",
				);
				for (let t = 0; t < 3; t += 1 / 30)
					colony.update(1 / 30, world, settings);
			});
			assert.ok(colony.mouse, "no mouse");
			assert.equal(colony.allAsleep(settings), false);
		});

		it("is cleared by destroy, with the furniture", () => {
			const host = fakeHost();
			const colony = new Colony(host);
			withRandom([0.5], () => {
				colony.sync(makeSettings({ ...every10s(), beds: 1 }), [], makeBounds());
				tick(colony, makeSettings({ ...every10s(), beds: 1 }), 10.1);
			});
			assert.ok(colony.mouse);
			colony.destroy();
			assert.equal(colony.mouse, null);
			assert.equal(colony.props.length, 0);
			for (const view of host.propViews) assert.equal(view.destroyed, true);
		});
	});
});

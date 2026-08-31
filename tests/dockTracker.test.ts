import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { DockTracker } from "../src/lib/dockTracker.ts";
import { makeDock, resetEnv } from "./support/env.ts";
import { FakeActor } from "./support/stubs/actor.ts";
import St from "./support/stubs/St.ts";
import * as Main from "./support/stubs/shellMain.ts";

describe("DockTracker", () => {
	beforeEach(() => resetEnv());

	describe("finding the dash", () => {
		it("discovers a descendant named 'dash'", () => {
			const { dash } = makeDock();
			Main.layoutManager.uiGroup.add_child(dash);
			assert.equal(new DockTracker().dash, dash);
		});

		it("ignores the overview's own dash", () => {
			// The overview has a dash too; picking it would put cats inside the
			// overview instead of on the desktop dock.
			const overviewDash = makeDock().dash;
			Main.layoutManager.overviewGroup.add_child(overviewDash);
			assert.equal(new DockTracker().dash, null);
		});

		it("prefers a mapped dash that has icons", () => {
			const empty = new St.Widget({ name: "dash" });
			empty.mapped = false;
			const { dash } = makeDock();
			Main.layoutManager.uiGroup.add_child(empty);
			Main.layoutManager.uiGroup.add_child(dash);
			assert.equal(new DockTracker().dash, dash);
		});

		it("returns null when there is no dock at all", () => {
			assert.equal(new DockTracker().dash, null);
		});

		it("drops a destroyed dash and rediscovers", () => {
			const first = makeDock().dash;
			Main.layoutManager.uiGroup.add_child(first);
			const tracker = new DockTracker();
			assert.equal(tracker.dash, first);

			first.destroy();
			const second = makeDock().dash;
			Main.layoutManager.uiGroup.add_child(second);
			assert.equal(tracker.dash, second);
		});

		it("invalidate() forces rediscovery", () => {
			const first = makeDock().dash;
			Main.layoutManager.uiGroup.add_child(first);
			const tracker = new DockTracker();
			assert.equal(tracker.dash, first);

			Main.layoutManager.uiGroup.remove_child(first);
			const second = makeDock().dash;
			Main.layoutManager.uiGroup.add_child(second);
			tracker.invalidate();
			assert.equal(tracker.dash, second);
		});
	});

	describe("geometry", () => {
		it("measures the painted background, not the dash actor", () => {
			// On Ubuntu Dock the dash actor spans the screen while the painted
			// panel is inset; using the actor would misplace the cats.
			const { dash } = makeDock({ x: 500, y: 830, w: 500, h: 66 });
			dash.transformed = [0, 800, 1600, 100];
			Main.layoutManager.uiGroup.add_child(dash);

			assert.deepEqual(new DockTracker().getBarRect(), {
				x: 500,
				y: 830,
				w: 500,
				h: 66,
			});
		});

		it("reports no bar when the dock is unmapped or transparent", () => {
			const { dash } = makeDock();
			Main.layoutManager.uiGroup.add_child(dash);
			const tracker = new DockTracker();

			dash.mapped = false;
			assert.equal(tracker.getBarRect(), null);
			dash.mapped = true;
			dash.opacity = 0;
			assert.equal(tracker.getBarRect(), null);
		});

		it("takes the floor from the monitor, not the dock", () => {
			// A floating dock stops short of the screen edge.
			const { dash } = makeDock({ y: 830, h: 60 });
			Main.layoutManager.uiGroup.add_child(dash);
			const tracker = new DockTracker();

			assert.deepEqual(tracker.getMonitorRect(), {
				x: 0,
				y: 0,
				w: 1600,
				h: 900,
			});
			assert.equal(tracker.getFloorY(), 900);
		});

		it("uses the monitor the dock is actually on", () => {
			const { dash } = makeDock();
			Main.layoutManager.uiGroup.add_child(dash);
			Main.layoutManager.monitorForActor = {
				x: 1600,
				y: 100,
				width: 1280,
				height: 720,
				inFullscreen: false,
			};
			assert.equal(new DockTracker().getFloorY(), 820);
		});
	});

	describe("icons", () => {
		it("reports stage rects and the logical icon size", () => {
			const { dash } = makeDock({ icons: 3, iconSize: 48, scale: 2 });
			Main.layoutManager.uiGroup.add_child(dash);

			const rects = new DockTracker().getIconRects();
			assert.equal(rects.length, 3);
			// stage size is scaled, logical size is not
			assert.equal(rects[0].w, 96);
			assert.equal(rects[0].logicalSize, 48);
		});

		it("skips placeholders, animating-out items and unmapped icons", () => {
			const { dash, icons } = makeDock({ icons: 3 });
			Main.layoutManager.uiGroup.add_child(dash);
			const box = (dash as unknown as { _box: FakeActor })._box;

			// a drag placeholder: a container with no child
			box.add_child(new FakeActor());
			// a container whose child has no .icon
			const bare = new FakeActor();
			(bare as unknown as { child: FakeActor }).child = new FakeActor();
			box.add_child(bare);

			(
				box.get_children()[0] as unknown as { animatingOut: boolean }
			).animatingOut = true;
			icons[1].mapped = false;

			assert.equal(new DockTracker().getIconRects().length, 1);
		});

		it("returns nothing rather than throwing when internals move", () => {
			// These are another extension's privates; a rename must degrade,
			// not crash the shell.
			const { dash } = makeDock();
			Main.layoutManager.uiGroup.add_child(dash);
			const tracker = new DockTracker();

			(dash as unknown as { _box: unknown })._box = { nope: true };
			assert.deepEqual(tracker.getIconRects(), []);

			const box = new FakeActor();
			box.get_children = () => {
				throw new Error("boom");
			};
			(dash as unknown as { _box: FakeActor })._box = box;
			assert.deepEqual(tracker.getIconRects(), []);
		});
	});

	describe("isUsable", () => {
		let tracker: DockTracker;
		beforeEach(() => {
			const { dash } = makeDock();
			Main.layoutManager.uiGroup.add_child(dash);
			tracker = new DockTracker();
		});

		it("is true for a visible dock", () => {
			assert.equal(tracker.isUsable(), true);
		});

		it("is false in the overview", () => {
			Main.overview.visible = true;
			assert.equal(tracker.isUsable(), false);
		});

		it("is false in fullscreen", () => {
			const monitor = Main.layoutManager.primaryMonitor;
			assert.ok(monitor);
			monitor.inFullscreen = true;
			assert.equal(tracker.isUsable(), false);
		});

		it("is false once the dock has slid off-screen", () => {
			const dash = tracker.dash;
			assert.ok(dash);
			dash.get_children()[0].transformed = [500, 900, 500, 66];
			assert.equal(tracker.isUsable(), false);
		});
	});
});

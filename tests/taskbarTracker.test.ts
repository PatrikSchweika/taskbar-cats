import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	selectAppButtons,
	TaskbarTracker,
	taskbarOnScreen,
} from "../src/platform/win32/taskbarTracker.ts";
import {
	fakeBridge,
	fakeShell,
	taskbarInfo,
	win10Button,
	win11Button,
} from "./support/win32Harness.ts";

const TASKBAR = { x: 0, y: 1032, w: 1920, h: 48 };

describe("selectAppButtons", () => {
	describe("on Windows 11", () => {
		it("keeps the buttons with the app-button class and nothing else", () => {
			// When the class is present it is decisive: no elimination needed.
			const buttons = [
				win11Button(300),
				win11Button(350),
				{
					...win11Button(60),
					className: "Taskbar.StartButton",
					automationId: "StartButton",
				},
				{ ...win11Button(120), className: "Taskbar.SearchBoxButton" },
			];
			const kept = selectAppButtons(buttons, TASKBAR, null);
			assert.deepEqual(
				kept.map((b) => b.x),
				[300, 350],
			);
		});

		it("ignores unclassed buttons once a classed one exists", () => {
			// A mixed tree means the XAML taskbar is present and the unclassed
			// button belongs to something else on the bar.
			const kept = selectAppButtons(
				[win11Button(300), win10Button(400)],
				TASKBAR,
				null,
			);
			assert.deepEqual(
				kept.map((b) => b.x),
				[300],
			);
		});
	});

	describe("on Windows 10", () => {
		it("keeps app buttons that have no class or automation id at all", () => {
			// This is every real app button on Windows 10: the identifiers the
			// denylist works on are simply absent, so it must fall through to
			// the geometry checks rather than reject them.
			const kept = selectAppButtons(
				[win10Button(300), win10Button(340)],
				TASKBAR,
				null,
			);
			assert.equal(kept.length, 2);
		});

		it("drops the shell's own controls by automation id", () => {
			const buttons = [
				win10Button(20, { automationId: "Start Button" }),
				win10Button(70, { automationId: "SearchBoxButton" }),
				win10Button(120, { automationId: "TaskViewButton" }),
				win10Button(170, { automationId: "WidgetsButton" }),
				win10Button(400),
			];
			const kept = selectAppButtons(buttons, TASKBAR, null);
			assert.deepEqual(
				kept.map((b) => b.x),
				[400],
			);
		});

		it("matches identifiers case-insensitively", () => {
			const kept = selectAppButtons(
				[win10Button(20, { automationId: "STARTBUTTON" })],
				TASKBAR,
				null,
			);
			assert.deepEqual(kept, []);
		});

		it("does not match on the localised name", () => {
			// `Name` is the window title in the user's language; a button called
			// "Startseite" in German is not the Start button.
			const kept = selectAppButtons(
				[win10Button(400, { name: "Start – Mozilla Firefox" })],
				TASKBAR,
				null,
			);
			assert.equal(kept.length, 1);
		});
	});

	describe("geometry", () => {
		it("drops buttons outside the taskbar", () => {
			// UI Automation also reaches into open jump lists and flyouts.
			const kept = selectAppButtons(
				[win10Button(400), { ...win10Button(400), y: 600 }],
				TASKBAR,
				null,
			);
			assert.equal(kept.length, 1);
			assert.equal(kept[0].y, 1036);
		});

		it("drops buttons in the notification area", () => {
			const notification = { x: 1700, y: 1032, w: 220, h: 48 };
			const kept = selectAppButtons(
				[win10Button(400), win10Button(1750)],
				TASKBAR,
				notification,
			);
			assert.deepEqual(
				kept.map((b) => b.x),
				[400],
			);
		});

		it("drops a button as wide as half the bar", () => {
			// That is a container the tree exposed as a button, not an icon.
			const kept = selectAppButtons(
				[win10Button(0, { w: 1200 }), win10Button(400)],
				TASKBAR,
				null,
			);
			assert.deepEqual(
				kept.map((b) => b.x),
				[400],
			);
		});

		it("drops a button far taller than the bar", () => {
			const kept = selectAppButtons(
				[win10Button(400, { y: 900, h: 180 }), win10Button(500)],
				TASKBAR,
				null,
			);
			assert.deepEqual(
				kept.map((b) => b.x),
				[500],
			);
		});

		it("drops degenerate rects", () => {
			const kept = selectAppButtons(
				[win10Button(400, { w: 0, h: 0 }), win10Button(500)],
				TASKBAR,
				null,
			);
			assert.equal(kept.length, 1);
		});

		it("returns them left to right whatever order they arrived in", () => {
			const kept = selectAppButtons(
				[win10Button(700), win10Button(300), win10Button(500)],
				TASKBAR,
				null,
			);
			assert.deepEqual(
				kept.map((b) => b.x),
				[300, 500, 700],
			);
		});
	});
});

describe("taskbarOnScreen", () => {
	const monitor = { x: 0, y: 0, w: 1920, h: 1080 };

	it("accepts a docked taskbar", () => {
		assert.equal(taskbarOnScreen(TASKBAR, monitor), true);
	});

	it("rejects one parked off the bottom edge", () => {
		// This is what auto-hide does, and the counterpart of the GNOME
		// backend's intellihide check.
		assert.equal(
			taskbarOnScreen({ x: 0, y: 1078, w: 1920, h: 48 }, monitor),
			false,
		);
	});

	it("rejects one on a monitor that is gone", () => {
		assert.equal(
			taskbarOnScreen({ x: 3000, y: 1032, w: 1920, h: 48 }, monitor),
			false,
		);
	});
});

describe("TaskbarTracker", () => {
	describe("when the taskbar cannot be found at all", () => {
		// The native helper was never built, or explorer.exe is restarting.
		// Neither is the same as a hidden taskbar: nobody could say where it is,
		// and the cats should still have a floor.
		it("falls back to the bottom of the primary display", () => {
			const { shell } = fakeShell({ taskbar: null });
			const tracker = new TaskbarTracker(shell, fakeBridge());
			tracker.refreshLayout();

			const desktop = tracker.desktop;
			assert.ok(desktop, "there should still be somewhere to draw");
			assert.equal(desktop.fallback, true);
			assert.deepEqual(desktop.monitor, { x: 0, y: 0, w: 1920, h: 1080 });
			assert.deepEqual(desktop.icons, [], "nothing to claw");
			assert.equal(desktop.taskbar.h, 0);
			assert.equal(tracker.isUsable(), true, "the cats should be drawn");
		});

		it("reports nothing when there is no display either", () => {
			const bridge = fakeBridge();
			bridge.primaryDisplay = () => null;
			const { shell } = fakeShell({ taskbar: null });
			const tracker = new TaskbarTracker(shell, bridge);
			tracker.refreshLayout();

			assert.equal(tracker.desktop, null);
			assert.equal(tracker.isUsable(), false);
		});

		it("still hides for a fullscreen window", () => {
			const { shell, state } = fakeShell({ taskbar: null });
			const tracker = new TaskbarTracker(shell, fakeBridge());
			tracker.refreshLayout();
			state.fullscreen = true;
			assert.equal(tracker.isUsable(), false);
		});

		it("recovers once the taskbar turns up", () => {
			const { shell, state } = fakeShell({ taskbar: null });
			const tracker = new TaskbarTracker(shell, fakeBridge());
			tracker.refreshLayout();
			assert.equal(tracker.desktop?.fallback, true);

			state.taskbar = taskbarInfo();
			state.buttons = [win11Button(300)];
			tracker.refreshLayout();

			assert.equal(tracker.desktop?.fallback, false);
			assert.equal(tracker.desktop?.icons.length, 1);
		});
	});

	it("reports the monitor, taskbar and icons in DIP", () => {
		const { shell } = fakeShell({ buttons: [win11Button(300)] });
		const tracker = new TaskbarTracker(shell, fakeBridge());
		tracker.refreshLayout();

		const desktop = tracker.desktop;
		assert.ok(desktop);
		assert.deepEqual(desktop.monitor, { x: 0, y: 0, w: 1920, h: 1080 });
		assert.deepEqual(desktop.taskbar, { x: 0, y: 1032, w: 1920, h: 48 });
		assert.equal(desktop.icons.length, 1);
		assert.equal(desktop.icons[0].x, 300);
	});

	it("halves every rect at a 2x scale factor", () => {
		// Everything the simulation sees is device-independent, because that is
		// what the renderer draws in.
		const { shell } = fakeShell({ buttons: [win11Button(300)] });
		const tracker = new TaskbarTracker(shell, fakeBridge(2));
		tracker.refreshLayout();

		const desktop = tracker.desktop;
		assert.ok(desktop);
		assert.deepEqual(desktop.monitor, { x: 0, y: 0, w: 960, h: 540 });
		assert.equal(desktop.icons[0].x, 150);
		assert.equal(desktop.icons[0].w, 22);
	});

	it("sizes cats from the icon's smaller dimension", () => {
		const { shell } = fakeShell({
			buttons: [win11Button(300, { w: 60, h: 40 })],
		});
		const tracker = new TaskbarTracker(shell, fakeBridge());
		tracker.refreshLayout();
		assert.equal(tracker.desktop?.icons[0].logicalSize, 40);
	});

	it("gives each icon a handle that survives a re-read", () => {
		// The simulation holds the icon a cat is clawing across ticks and
		// re-resolves it by identity.
		const { shell } = fakeShell({ buttons: [win11Button(300)] });
		const tracker = new TaskbarTracker(shell, fakeBridge());
		tracker.refreshLayout();
		const first = tracker.desktop?.icons[0].handle;
		tracker.refreshLayout();
		assert.equal(tracker.desktop?.icons[0].handle, first);
		assert.ok(first, "handle should not be empty");
	});

	describe("with the taskbar somewhere other than the bottom", () => {
		it("reports no icons, but still a monitor to walk on", () => {
			// A cat's "am I under an icon" test is horizontal only, so icons up
			// the side of the screen would have it clawing at empty floor.
			// The button is deliberately one the geometry checks would keep —
			// inside the bar, not too wide, not too tall — so that the edge is
			// the only thing that can exclude it.
			const { shell } = fakeShell({
				taskbar: taskbarInfo({ x: 0, y: 0, w: 110, h: 1080, edge: "left" }),
				buttons: [win11Button(10, { y: 200, w: 40, h: 40 })],
			});
			const tracker = new TaskbarTracker(shell, fakeBridge());
			tracker.refreshLayout();

			assert.deepEqual(tracker.desktop?.icons, []);
			assert.deepEqual(tracker.desktop?.monitor, {
				x: 0,
				y: 0,
				w: 1920,
				h: 1080,
			});
			assert.equal(tracker.isUsable(), true);
		});
	});

	describe("isUsable", () => {
		it("is false while a fullscreen window is in front", () => {
			const { shell, state } = fakeShell();
			const tracker = new TaskbarTracker(shell, fakeBridge());
			tracker.refreshLayout();
			assert.equal(tracker.isUsable(), true);

			state.fullscreen = true;
			assert.equal(tracker.isUsable(), false, "a game should hide the cats");
		});

		it("is false while the taskbar is hidden away", () => {
			const { shell } = fakeShell({
				taskbar: taskbarInfo({ y: 1078 }),
			});
			const tracker = new TaskbarTracker(shell, fakeBridge());
			tracker.refreshLayout();
			assert.equal(tracker.isUsable(), false);
		});

		it("marks a real reading as not a fallback", () => {
			const { shell } = fakeShell();
			const tracker = new TaskbarTracker(shell, fakeBridge());
			tracker.refreshLayout();
			assert.equal(tracker.desktop?.fallback, false);
		});

		it("is false before the first layout read", () => {
			const { shell } = fakeShell();
			assert.equal(new TaskbarTracker(shell, fakeBridge()).isUsable(), false);
		});
	});

	describe("pointer", () => {
		it("converts to DIP", () => {
			const { shell } = fakeShell({ cursor: { x: 800, y: 1000 } });
			const tracker = new TaskbarTracker(shell, fakeBridge(2));
			assert.deepEqual(tracker.pointer(), { x: 400, y: 500 });
		});

		it("is null when Windows will not say", () => {
			const { shell } = fakeShell({ cursor: null });
			const tracker = new TaskbarTracker(shell, fakeBridge());
			assert.equal(tracker.pointer(), null);
		});
	});
});

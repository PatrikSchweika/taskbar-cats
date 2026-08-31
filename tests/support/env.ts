/** Per-test reset of the faked shell environment. */

import { FakeActor } from "./stubs/actor.ts";
import GLib from "./stubs/GLib.ts";
import St from "./stubs/St.ts";
import * as Main from "./stubs/shellMain.ts";

export interface Env {
	stage: FakeActor;
	pointer: { x: number; y: number };
	loggedErrors: string[];
}

export function resetEnv(scaleFactor = 1): Env {
	const g = globalThis as unknown as { stage: FakeActor };
	GLib.__reset();
	Main.__reset();
	St.__setScaleFactor(scaleFactor);

	// The stage owns uiGroup, so actors parented into it report a stage.
	g.stage.children = [];
	g.stage.add_child(Main.layoutManager.uiGroup);

	const t = testEnv();
	t.pointer.x = 0;
	t.pointer.y = 0;
	t.loggedErrors.length = 0;
	t.logged.length = 0;

	return { stage: g.stage, pointer: t.pointer, loggedErrors: t.loggedErrors };
}

interface TestEnv {
	pointer: { x: number; y: number };
	logged: string[];
	loggedErrors: string[];
}

export function testEnv(): TestEnv {
	const t = (globalThis as unknown as { __catsTestEnv?: TestEnv })
		.__catsTestEnv;
	if (!t)
		throw new Error(
			"test globals missing — run with --import ./tests/support/hooks.ts",
		);
	return t;
}

/**
 * Build a dock actor tree shaped like the real one: a widget named `dash`
 * holding a `dash-background` and a `_box` of icon containers.
 */
export function makeDock(
	opts: {
		x?: number;
		y?: number;
		w?: number;
		h?: number;
		icons?: number;
		iconSize?: number;
		scale?: number;
	} = {},
): { dash: FakeActor; icons: FakeActor[] } {
	const {
		x = 500,
		y = 830,
		w = 500,
		h = 66,
		icons = 5,
		iconSize = 48,
		scale = 1,
	} = opts;

	const dash = new St.Widget({ name: "dash" });
	dash.transformed = [x, y, w, h];

	const background = new St.Widget({ style_class: "dash-background" });
	background.transformed = [x, y, w, h];
	dash.add_child(background);

	const box = new FakeActor({ name: "box" });
	(dash as unknown as { _box: FakeActor })._box = box;
	dash.add_child(box);

	const made: FakeActor[] = [];
	for (let i = 0; i < icons; i++) {
		const inner = new St.Icon({ icon_size: iconSize });
		inner.transformed = [
			x + 12 + i * 64 * scale,
			y + 9,
			iconSize * scale,
			iconSize * scale,
		];
		const appIcon = new FakeActor();
		(appIcon as unknown as { icon: { icon: FakeActor } }).icon = {
			icon: inner,
		};
		const item = new FakeActor();
		(item as unknown as { child: FakeActor }).child = appIcon;
		box.add_child(item);
		made.push(appIcon);
	}
	return { dash, icons: made };
}

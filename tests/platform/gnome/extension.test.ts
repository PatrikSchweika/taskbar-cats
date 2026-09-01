import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import UbuntuCatsExtension from "../../../src/extension.ts";
import { makeDock, resetEnv, testEnv } from "../../support/gnome/env.ts";
import { Settings } from "../../support/gnome/stubs/Gio.ts";
import GLib from "../../support/gnome/stubs/GLib.ts";
import * as Main from "../../support/gnome/stubs/shellMain.ts";

const SRC = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"src",
);
const METADATA = JSON.parse(
	readFileSync(join(SRC, "metadata.json"), "utf8"),
) as ConstructorParameters<typeof UbuntuCatsExtension>[0];

const DEFAULTS: Record<string, unknown> = {
	"cat-count": 3,
	palettes: [],
	"max-speed": 220,
	"mouse-attraction": 60,
	"attract-radius": 260,
	"scratch-icons": true,
	"wiggle-icons": true,
	"sprite-size": 0,
	"sleep-after": 20,
	"animation-fps": 12,
};

interface Harness {
	ext: UbuntuCatsExtension;
	settings: Settings;
}

function enableExtension(over: Record<string, unknown> = {}): Harness {
	const { dash } = makeDock();
	Main.layoutManager.uiGroup.add_child(dash);

	const settings = new Settings({ ...DEFAULTS, ...over });
	const ext = new UbuntuCatsExtension(METADATA);
	(ext as unknown as { path: string }).path = SRC;
	(ext as unknown as { __settings: unknown }).__settings = settings;
	ext.enable();
	return { ext, settings };
}

/** The cat actors currently parented into the overlay. */
function catActors(): unknown[] {
	const layer = Main.layoutManager.uiGroup
		.get_children()
		.find((c) => c.style_class === "ubuntu-cats-layer");
	return layer ? layer.get_children() : [];
}

function tick(times = 1, dt = 1 / 30): void {
	for (let i = 0; i < times; i++) {
		GLib.__advance(dt);
		GLib.__tick();
	}
}

describe("UbuntuCatsExtension", () => {
	beforeEach(() => resetEnv());

	describe("enable", () => {
		it("puts the configured number of cats on an overlay", () => {
			enableExtension({ "cat-count": 4 });
			assert.equal(catActors().length, 4);
		});

		it("adds the overlay to uiGroup, not as chrome, and unreactive", () => {
			// Reactive chrome would steal clicks from the dock and affect struts.
			enableExtension();
			const layer = Main.layoutManager.uiGroup
				.get_children()
				.find((c) => c.style_class === "ubuntu-cats-layer");
			assert.ok(layer, "overlay not parented into uiGroup");
			assert.equal(layer.reactive, false);
			for (const cat of layer.get_children())
				assert.equal((cat as { reactive: boolean }).reactive, false);
		});

		it("starts a tick", () => {
			enableExtension();
			assert.equal(GLib.__sources().length, 1);
		});

		it("survives having no dock at all", () => {
			const settings = new Settings({ ...DEFAULTS });
			const ext = new UbuntuCatsExtension(METADATA);
			(ext as unknown as { path: string }).path = SRC;
			(ext as unknown as { __settings: unknown }).__settings = settings;
			assert.doesNotThrow(() => ext.enable());
			assert.doesNotThrow(() => tick(5));
			assert.deepEqual(testEnv().loggedErrors, []);
			ext.disable();
		});
	});

	describe("settings", () => {
		it("adds and removes cats live", () => {
			const { settings } = enableExtension({ "cat-count": 2 });
			assert.equal(catActors().length, 2);
			settings.__change("cat-count", 5);
			assert.equal(catActors().length, 5);
			settings.__change("cat-count", 1);
			assert.equal(catActors().length, 1);
		});

		it("applies a pinned cat size", () => {
			const { settings } = enableExtension();
			settings.__change("sprite-size", 72);
			tick(2);
			for (const cat of catActors())
				assert.equal((cat as { icon_size: number }).icon_size, 72);
		});

		it("matches the dock's logical icon size when set to auto", () => {
			// Regression: measuring the icon's stage height made cats
			// scale-factor times too big on HiDPI.
			resetEnv(2);
			enableExtension({ "sprite-size": 0 });
			tick(2);
			for (const cat of catActors())
				assert.equal((cat as { icon_size: number }).icon_size, 48);
		});
	});

	describe("the tick", () => {
		it("keeps exactly one source alive across interval changes", () => {
			enableExtension({ "sleep-after": 1 });
			tick(200);
			assert.equal(GLib.__sources().length, 1, "sources leaked");
		});

		it("slows down once the cats are asleep", () => {
			enableExtension({ "sleep-after": 1, "mouse-attraction": 0 });
			tick(5);
			const busy = GLib.__sources()[0].intervalMs;
			tick(400);
			const drowsy = GLib.__sources()[0].intervalMs;
			assert.ok(drowsy > busy, `${drowsy} should be slower than ${busy}`);
		});

		it("hides the cats when the dock goes away", () => {
			enableExtension();
			tick(2);
			const layer = Main.layoutManager.uiGroup
				.get_children()
				.find((c) => c.style_class === "ubuntu-cats-layer");
			assert.ok(layer, "overlay missing");
			assert.equal(layer.visible, true);

			Main.overview.visible = true;
			tick(2);
			assert.equal(layer.visible, false);

			Main.overview.visible = false;
			tick(2);
			assert.equal(layer.visible, true);
		});

		it("logs nothing while running normally", () => {
			enableExtension();
			tick(300);
			assert.deepEqual(testEnv().loggedErrors, []);
		});
	});

	describe("disable", () => {
		it("stops the tick, empties the overlay and detaches it", () => {
			const { ext } = enableExtension({ "cat-count": 3 });
			tick(10);
			ext.disable();

			assert.equal(GLib.__sources().length, 0, "tick still running");
			assert.equal(catActors().length, 0, "cats left behind");
			assert.equal(
				Main.layoutManager.uiGroup
					.get_children()
					.filter((c) => c.style_class === "ubuntu-cats-layer").length,
				0,
				"overlay left behind",
			);
		});

		it("disconnects every signal it connected", () => {
			// A leaked handler fires against torn-down state forever.
			const { ext, settings } = enableExtension();
			assert.ok(settings.__handlerCount() > 0);
			assert.ok(Main.overview.handlerCount() > 0);

			ext.disable();
			assert.equal(settings.__handlerCount(), 0, "settings handler leaked");
			assert.equal(Main.overview.handlerCount(), 0, "overview handler leaked");
			assert.equal(
				Main.extensionManager.handlerCount(),
				0,
				"extensionManager handler leaked",
			);
			assert.equal(
				Main.layoutManager.handlerCount(),
				0,
				"layoutManager handler leaked",
			);
		});

		it("puts every dock icon back exactly as it found it", () => {
			// The one thing that could outlive the extension.
			const { ext } = enableExtension({
				"cat-count": 6,
				"mouse-attraction": 0,
				"sleep-after": 0,
			});
			tick(600);
			const inner = Main.layoutManager.uiGroup
				.get_children()
				.filter((c) => c.name === "dash")
				.flatMap((d) =>
					(d as unknown as { _box: { get_children(): unknown[] } })._box
						.get_children()
						.map(
							(item) =>
								(
									item as {
										child: { icon: { icon: { rotation_angle_z: number } } };
									}
								).child.icon.icon,
						),
				);
			ext.disable();
			for (const icon of inner) assert.equal(icon.rotation_angle_z, 0);
		});

		it("reports no teardown failures", () => {
			const { ext } = enableExtension();
			tick(20);
			ext.disable();
			assert.deepEqual(testEnv().loggedErrors, []);
		});

		it("is safe on an extension that never enabled", () => {
			const ext = new UbuntuCatsExtension(METADATA);
			assert.doesNotThrow(() => ext.disable());
		});

		it("can be enabled again afterwards", () => {
			const { ext } = enableExtension({ "cat-count": 2 });
			ext.disable();
			(ext as unknown as { __settings: unknown }).__settings = new Settings({
				...DEFAULTS,
				"cat-count": 3,
			});
			ext.enable();
			assert.equal(catActors().length, 3);
			assert.equal(GLib.__sources().length, 1);
			ext.disable();
		});
	});
});

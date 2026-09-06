import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { defaultSettings } from "../../../src/core/config.ts";
import {
	ConfigStore,
	changedKeys,
} from "../../../src/platform/win32/config.ts";

describe("ConfigStore", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "taskbar-cats-test-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("starts from the defaults when there is no file", () => {
		const store = new ConfigStore(dir);
		assert.deepEqual(store.settings, defaultSettings());
	});

	it("does not create a file until something changes", () => {
		// A first run that writes nothing leaves nothing behind to explain.
		new ConfigStore(dir);
		assert.throws(() => readFileSync(join(dir, "settings.json")));
	});

	it("persists an update and reads it back in a new store", () => {
		const store = new ConfigStore(dir);
		store.update({ count: 6 });
		assert.equal(new ConfigStore(dir).settings.count, 6);
	});

	it("writes the file keyed the way the GSettings schema is", () => {
		// So a Windows settings.json and a gsettings dump read the same.
		const store = new ConfigStore(dir);
		store.update({ count: 5, scratchIcons: false });
		const raw = JSON.parse(
			readFileSync(join(dir, "settings.json"), "utf8"),
		) as Record<string, unknown>;
		assert.equal(raw["cat-count"], 5);
		assert.equal(raw["scratch-icons"], false);
	});

	it("persists the furniture positions, keyed as the schema is", () => {
		const store = new ConfigStore(dir);
		store.update({ bedPositions: [10, -1, 250] });
		const raw = JSON.parse(
			readFileSync(join(dir, "settings.json"), "utf8"),
		) as Record<string, unknown>;
		assert.deepEqual(raw["bed-positions"], [10, -1, 100], "clamped on the way");
		assert.deepEqual(new ConfigStore(dir).settings.bedPositions, [10, -1, 100]);
	});

	it("clamps what it stores, not just what it serves", () => {
		const store = new ConfigStore(dir);
		store.update({ maxSpeed: 100000 });
		assert.equal(store.settings.maxSpeed, 600);
		const raw = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
		assert.equal(raw["max-speed"], 600);
	});

	it("reports which keys changed and ignores a no-op update", () => {
		const store = new ConfigStore(dir);
		assert.deepEqual(store.update({ count: 4 }), ["count"]);
		assert.deepEqual(store.update({ count: 4 }), [], "no-op should be quiet");
	});

	it("notifies listeners only on a real change", () => {
		const store = new ConfigStore(dir);
		const seen: string[][] = [];
		store.onChange((_settings, changed) => seen.push(changed));

		store.update({ count: 2 });
		store.update({ count: 2 });
		store.update({ palettes: ["siamese"] });

		assert.deepEqual(seen, [["count"], ["palettes"]]);
	});

	it("falls back to the defaults on an unreadable file", () => {
		// A hand-edited file with a stray comma must not stop the app starting.
		writeFileSync(join(dir, "settings.json"), "{ not json");
		const store = new ConfigStore(dir);
		assert.deepEqual(store.settings, defaultSettings());
	});

	it("survives a file holding the wrong shape entirely", () => {
		writeFileSync(join(dir, "settings.json"), '"just a string"');
		assert.deepEqual(new ConfigStore(dir).settings, defaultSettings());
	});

	it("keeps the old file if a write fails", () => {
		const store = new ConfigStore(dir);
		store.update({ count: 7 });
		const before = readFileSync(join(dir, "settings.json"), "utf8");

		// Make the directory unwritable by pointing the store at a path that
		// cannot exist, then confirm the original is untouched.
		const broken = new ConfigStore(join(dir, "settings.json", "nested"));
		broken.update({ count: 2 });

		assert.equal(readFileSync(join(dir, "settings.json"), "utf8"), before);
	});
});

describe("changedKeys", () => {
	it("compares palette lists by contents, not identity", () => {
		const a = { ...defaultSettings(), palettes: ["siamese", "black"] };
		const b = { ...defaultSettings(), palettes: ["siamese", "black"] };
		assert.deepEqual(changedKeys(a, b), []);

		const c = { ...defaultSettings(), palettes: ["black", "siamese"] };
		assert.deepEqual(changedKeys(a, c), ["palettes"], "order is a change");

		const d = { ...defaultSettings(), palettes: ["siamese"] };
		assert.deepEqual(changedKeys(a, d), ["palettes"]);
	});

	it("finds every differing key", () => {
		const a = defaultSettings();
		const b = { ...a, count: 8, fps: 30 };
		assert.deepEqual(changedKeys(a, b).sort(), ["count", "fps"]);
	});
});

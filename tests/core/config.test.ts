import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	AUTO_POSITION,
	BOOL_SETTINGS,
	CAT_SIZES_KEY,
	DEFAULT_HOTKEY,
	defaultSettings,
	HOTKEY_KEY,
	INT_SETTINGS,
	normalizeCatSizes,
	normalizeHotkey,
	normalizePositions,
	normalizeSettings,
	normalizeStringList,
	POSITION_SETTINGS,
	STRING_LIST_SETTINGS,
	toStorage,
} from "../../src/core/config.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const SCHEMA_PATH = join(
	SRC,
	"schemas",
	"org.gnome.shell.extensions.taskbar-cats.gschema.xml",
);

interface SchemaKey {
	type: string;
	default: string;
	min?: string;
	max?: string;
}

/**
 * The GSettings schema as a plain table.
 *
 * A regex is enough for a file this shape, and it keeps the test suite free of
 * an XML parser dependency; `npm run validate` already has glib-compile-schemas
 * check that the file is well-formed XML.
 */
function parseSchema(): Map<string, SchemaKey> {
	const xml = readFileSync(SCHEMA_PATH, "utf8");
	const out = new Map<string, SchemaKey>();
	const keyRe = /<key\s+name="([^"]+)"\s+type="([^"]+)"\s*>([\s\S]*?)<\/key>/g;
	for (const [, name, type, body] of xml.matchAll(keyRe)) {
		const def = /<default>([\s\S]*?)<\/default>/.exec(body);
		const range = /<range\s+min="([^"]+)"\s+max="([^"]+)"\s*\/>/.exec(body);
		out.set(name, {
			type,
			default: def ? def[1].trim() : "",
			min: range?.[1],
			max: range?.[2],
		});
	}
	return out;
}

/**
 * One canonical description of every setting, checked against the other.
 *
 * GNOME's defaults and ranges live in XML because GSettings requires it, and
 * the Windows config store reads the same keys out of JSON. Nothing at runtime
 * forces the two to agree, so this test does: a setting whose range was
 * loosened on one platform and not the other is exactly the kind of drift that
 * shows up months later as "the cats are faster on Windows".
 */
describe("settings", () => {
	const schema = parseSchema();

	describe("agrees with the GSettings schema", () => {
		for (const [name, spec] of Object.entries(INT_SETTINGS)) {
			it(`${spec.key} (${name})`, () => {
				const key = schema.get(spec.key);
				assert.ok(key, `${spec.key} is missing from the schema`);
				assert.equal(key.type, "i", "should be an integer key");
				assert.equal(Number(key.default), spec.default, "default differs");
				assert.equal(Number(key.min), spec.min, "range minimum differs");
				assert.equal(Number(key.max), spec.max, "range maximum differs");
			});
		}

		for (const [name, spec] of Object.entries(BOOL_SETTINGS)) {
			it(`${spec.key} (${name})`, () => {
				const key = schema.get(spec.key);
				assert.ok(key, `${spec.key} is missing from the schema`);
				assert.equal(key.type, "b", "should be a boolean key");
				assert.equal(key.default === "true", spec.default, "default differs");
			});
		}

		for (const [name, spec] of Object.entries(POSITION_SETTINGS)) {
			it(`${spec.key} (${name}) is an integer list defaulting to empty`, () => {
				const key = schema.get(spec.key);
				assert.ok(key, `${spec.key} is missing from the schema`);
				assert.equal(key.type, "ai");
				assert.equal(key.default, "[]");
			});
		}

		for (const [name, spec] of Object.entries(STRING_LIST_SETTINGS)) {
			it(`${spec.key} (${name}) is a string list defaulting to empty`, () => {
				const key = schema.get(spec.key);
				assert.ok(key, `${spec.key} is missing from the schema`);
				assert.equal(key.type, "as");
				assert.equal(key.default, "[]");
			});
		}

		it(`${CAT_SIZES_KEY} is an integer list defaulting to empty`, () => {
			const key = schema.get(CAT_SIZES_KEY);
			assert.ok(key, `${CAT_SIZES_KEY} is missing from the schema`);
			assert.equal(key.type, "ai");
			assert.equal(key.default, "[]");
		});

		it(`${HOTKEY_KEY} is a string list defaulting to ${DEFAULT_HOTKEY}`, () => {
			const key = schema.get(HOTKEY_KEY);
			assert.ok(key, `${HOTKEY_KEY} is missing from the schema`);
			assert.equal(key.type, "as");
			// The XML escapes the angle brackets; GVariant text uses single quotes.
			const decoded = key.default.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
			assert.deepEqual(JSON.parse(decoded.replace(/'/g, '"')), [
				DEFAULT_HOTKEY,
			]);
		});

		it("covers every key the schema declares", () => {
			// The other direction: a key added to the schema but not to the
			// shared table would be honoured on GNOME and silently ignored on
			// Windows.
			const known = new Set<string>([
				CAT_SIZES_KEY,
				HOTKEY_KEY,
				...Object.values(INT_SETTINGS).map((s) => s.key),
				...Object.values(BOOL_SETTINGS).map((s) => s.key),
				...Object.values(POSITION_SETTINGS).map((s) => s.key),
				...Object.values(STRING_LIST_SETTINGS).map((s) => s.key),
			]);
			const unknown = [...schema.keys()].filter((k) => !known.has(k));
			assert.deepEqual(unknown, [], "schema keys missing from core/config");
		});
	});

	describe("normalizeSettings", () => {
		it("returns the defaults for an empty config", () => {
			assert.deepEqual(normalizeSettings({}), defaultSettings());
		});

		it("returns the defaults for junk", () => {
			assert.deepEqual(normalizeSettings(null), defaultSettings());
			assert.deepEqual(normalizeSettings("nope"), defaultSettings());
		});

		it("clamps numbers into range instead of trusting the file", () => {
			// The Windows config is hand-editable, and a 10000px/s cat would
			// leave the screen entirely.
			const s = normalizeSettings({ "max-speed": 99999, "cat-count": 0 });
			assert.equal(s.maxSpeed, INT_SETTINGS.maxSpeed.max);
			assert.equal(s.count, INT_SETTINGS.count.min);
		});

		it("falls back on the wrong type rather than passing NaN through", () => {
			const s = normalizeSettings({
				"max-speed": "fast",
				"scratch-icons": "yes",
			});
			assert.equal(s.maxSpeed, INT_SETTINGS.maxSpeed.default);
			assert.equal(s.scratchIcons, BOOL_SETTINGS.scratchIcons.default);
		});

		it("rounds a fractional count", () => {
			assert.equal(normalizeSettings({ "cat-count": 3.7 }).count, 4);
		});

		it("round-trips through storage", () => {
			const original = normalizeSettings({
				"cat-count": 5,
				"wiggle-icons": false,
				"cat-palettes": ["siamese"],
				"bed-positions": [10, -1, 90],
			});
			assert.deepEqual(normalizeSettings(toStorage(original)), original);
		});

		describe("positions", () => {
			it("keeps percentages and the auto marker, index for index", () => {
				// The index is the bed number, so a blank in the middle must stay
				// a blank rather than shifting the rest along.
				assert.deepEqual(normalizePositions([10, -1, 90]), [10, -1, 90]);
			});

			it("clamps to a percentage and rounds", () => {
				assert.deepEqual(normalizePositions([150, 33.6]), [100, 34]);
			});

			it("turns junk into automatic rather than dropping it", () => {
				assert.deepEqual(normalizePositions(["left", null, -7, NaN]), [
					AUTO_POSITION,
					AUTO_POSITION,
					AUTO_POSITION,
					AUTO_POSITION,
				]);
			});

			it("treats a non-list as empty", () => {
				assert.deepEqual(normalizePositions("10,20"), []);
				assert.deepEqual(
					normalizeSettings({ "bed-positions": 5 }).bedPositions,
					[],
				);
			});

			it("reads both lists from a config", () => {
				const s = normalizeSettings({
					"bed-positions": [20],
					"scratcher-positions": [80, 90],
				});
				assert.deepEqual(s.bedPositions, [20]);
				assert.deepEqual(s.scratcherPositions, [80, 90]);
			});
		});

		describe("per-cat lists", () => {
			it("default to empty, meaning every cat is on Auto", () => {
				const s = defaultSettings();
				assert.deepEqual(s.catPalettes, []);
				assert.deepEqual(s.catNames, []);
				assert.deepEqual(s.catSizes, []);
			});

			it("keeps a string list index for index, blanking junk", () => {
				// The index is the cat number, so junk must not shift the rest.
				assert.deepEqual(normalizeStringList(["a", 7, null, "b"]), [
					"a",
					"",
					"",
					"b",
				]);
				assert.deepEqual(normalizeStringList("a,b"), []);
			});

			it("clamps sizes into range and keeps 0 as Auto", () => {
				assert.deepEqual(
					normalizeCatSizes([0, 8, 64, 500, 33.4]),
					[0, 16, 64, 128, 33],
				);
				assert.deepEqual(normalizeCatSizes(["big", null, -5]), [0, 0, 0]);
				assert.deepEqual(normalizeCatSizes(42), []);
			});

			it("reads all three from a config", () => {
				const s = normalizeSettings({
					"cat-palettes": ["siamese", ""],
					"cat-names": ["Mochi"],
					"cat-sizes": [0, 72],
				});
				assert.deepEqual(s.catPalettes, ["siamese", ""]);
				assert.deepEqual(s.catNames, ["Mochi"]);
				assert.deepEqual(s.catSizes, [0, 72]);
			});

			it("round-trips through storage", () => {
				const original = normalizeSettings({
					"cat-palettes": ["siamese"],
					"cat-names": ["", "Bean"],
					"cat-sizes": [0, 72],
				});
				assert.deepEqual(normalizeSettings(toStorage(original)), original);
			});
		});

		describe("the hide hotkey", () => {
			it("defaults to Ctrl+Alt+C", () => {
				assert.deepEqual(defaultSettings().toggleHotkey, [DEFAULT_HOTKEY]);
				assert.deepEqual(normalizeSettings({}).toggleHotkey, [DEFAULT_HOTKEY]);
			});

			it("keeps an empty list, which means unbound", () => {
				assert.deepEqual(normalizeHotkey([]), []);
				assert.deepEqual(
					normalizeSettings({ "toggle-hotkey": [] }).toggleHotkey,
					[],
				);
			});

			it("keeps only the first accelerator that parses, in canonical form", () => {
				assert.deepEqual(
					normalizeHotkey(["nonsense", "<Alt><Control>x", "<Shift>y"]),
					["<Control><Alt>x"],
				);
			});

			it("falls back to the default when the key holds junk", () => {
				assert.deepEqual(normalizeHotkey("ctrl+alt+c"), [DEFAULT_HOTKEY]);
				assert.deepEqual(
					normalizeSettings({ "toggle-hotkey": 5 }).toggleHotkey,
					[DEFAULT_HOTKEY],
				);
			});

			it("round-trips through storage", () => {
				const original = normalizeSettings({ "toggle-hotkey": ["<Super>F2"] });
				assert.deepEqual(original.toggleHotkey, ["<Super>F2"]);
				assert.deepEqual(normalizeSettings(toStorage(original)), original);
			});
		});
	});
});

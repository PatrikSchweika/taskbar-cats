import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	AUTO_POSITION,
	BOOL_SETTINGS,
	defaultSettings,
	INT_SETTINGS,
	normalizePositions,
	normalizeSettings,
	PALETTES_KEY,
	POSITION_SETTINGS,
	toStorage,
} from "../../src/core/config.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const SCHEMA_PATH = join(
	SRC,
	"schemas",
	"org.gnome.shell.extensions.ubuntu-cats.gschema.xml",
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

		it(`${PALETTES_KEY} is a string list defaulting to empty`, () => {
			const key = schema.get(PALETTES_KEY);
			assert.ok(key, `${PALETTES_KEY} is missing from the schema`);
			assert.equal(key.type, "as");
			assert.equal(key.default, "[]");
		});

		for (const [name, spec] of Object.entries(POSITION_SETTINGS)) {
			it(`${spec.key} (${name}) is an integer list defaulting to empty`, () => {
				const key = schema.get(spec.key);
				assert.ok(key, `${spec.key} is missing from the schema`);
				assert.equal(key.type, "ai");
				assert.equal(key.default, "[]");
			});
		}

		it("covers every key the schema declares", () => {
			// The other direction: a key added to the schema but not to the
			// shared table would be honoured on GNOME and silently ignored on
			// Windows.
			const known = new Set<string>([
				PALETTES_KEY,
				...Object.values(INT_SETTINGS).map((s) => s.key),
				...Object.values(BOOL_SETTINGS).map((s) => s.key),
				...Object.values(POSITION_SETTINGS).map((s) => s.key),
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

		it("keeps only string palette names", () => {
			const s = normalizeSettings({ palettes: ["siamese", 7, null, "grey"] });
			assert.deepEqual(s.palettes, ["siamese", "grey"]);
		});

		it("round-trips through storage", () => {
			const original = normalizeSettings({
				"cat-count": 5,
				"wiggle-icons": false,
				palettes: ["siamese"],
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
	});
});

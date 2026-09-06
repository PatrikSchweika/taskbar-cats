# Per-cat settings, sprite previews, and hide/show hotkey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each cat have its own palette, name and size; show looping sprite previews in both settings UIs; add a configurable global hotkey that hides and shows the cats.

**Architecture:** All new settings are added to the shared tables in `src/core/config.ts` and the GSettings schema, so the GNOME extension and the Windows Electron app read the same keys. Pure helpers (`resolveCatPalette`, `previewFrames`, the accelerator functions in `src/core/hotkey.ts`) live in core and are unit tested on plain Node; each platform adds only I/O, widgets and key registration. The hidden state is a runtime flag on each platform's entry point, never persisted.

**Tech Stack:** TypeScript (Node 22 native type stripping for tests, `node --test`), GJS + GTK4/libadwaita for GNOME prefs, Electron 44 for Windows, Biome for lint/format.

**Spec:** `docs/superpowers/specs/2026-09-06-per-cat-settings-preview-hotkey-design.md`

## Global Constraints

- Node `>=22.22.2`. Run tests with `npm test`; run everything with `npm run check` (Biome lint with warnings as errors, `node tools/cli.ts check`, then tests).
- Formatting is Biome with tabs. Run `npm run fix` before every commit.
- Import specifiers between source files end in `.js` (TypeScript maps them); tests import sources with `.ts`.
- Every GSettings key in the schema must appear in the core tables; `tests/core/config.test.ts` fails otherwise.
- The preload (`src/platform/win32/preload.ts`) may only `require("electron")`; channels come from the `const enum CHANNELS` in `ipc.ts`.
- Per-cat size range is 16 to 128 logical pixels; 0 means "colony size".
- Default hotkey is `<Control><Alt>c` (GTK accelerator syntax). An empty list means unbound.
- Preview animation is `walk` at a fixed 125 ms per frame, falling back to `idle`.
- Cat names are labels in the settings UI only.
- Commit messages follow the repository style: an imperative sentence, no prefix (e.g. "Let each cat pick its own palette").

---

### Task 1: Accelerator helpers in core

**Files:**
- Create: `src/core/hotkey.ts`
- Test: `tests/core/hotkey.test.ts`

**Interfaces:**
- Produces:
  - `interface Accel { ctrl: boolean; alt: boolean; shift: boolean; super: boolean; key: string }` where `key` is a lower-case name from the table below, a single letter `a`-`z`, a digit, or `f1`-`f35`.
  - `parseAccelerator(text: string): Accel | null`
  - `formatAccelerator(a: Accel): string` (GTK form, modifiers ordered `<Control><Alt><Shift><Super>`)
  - `toElectronAccelerator(a: Accel): string`
  - `describeAccelerator(a: Accel): string`
  - `acceleratorFromKeyEvent(e: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): Accel | null`
  - `hasModifier(a: Accel): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/hotkey.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type Accel,
	acceleratorFromKeyEvent,
	describeAccelerator,
	formatAccelerator,
	hasModifier,
	parseAccelerator,
	toElectronAccelerator,
} from "../../src/core/hotkey.ts";

const CTRL_ALT_C: Accel = {
	ctrl: true,
	alt: true,
	shift: false,
	super: false,
	key: "c",
};

describe("parseAccelerator", () => {
	it("reads the GTK form", () => {
		assert.deepEqual(parseAccelerator("<Control><Alt>c"), CTRL_ALT_C);
	});

	it("accepts the aliases GTK itself accepts", () => {
		assert.deepEqual(parseAccelerator("<Ctrl><Alt>C"), CTRL_ALT_C);
		assert.deepEqual(parseAccelerator("<Primary><Alt>c"), CTRL_ALT_C);
		assert.deepEqual(parseAccelerator("<Meta>space"), {
			...CTRL_ALT_C,
			ctrl: false,
			alt: false,
			super: true,
			key: "space",
		});
	});

	it("lower-cases GDK key names so the table has one spelling", () => {
		assert.equal(parseAccelerator("<Control>Page_Up")?.key, "page_up");
		assert.equal(parseAccelerator("<Control>F9")?.key, "f9");
		assert.equal(parseAccelerator("<Control>BackSpace")?.key, "backspace");
	});

	it("rejects junk, bare modifiers and unknown keys", () => {
		assert.equal(parseAccelerator(""), null);
		assert.equal(parseAccelerator("<Control>"), null);
		assert.equal(parseAccelerator("<Hyper>x"), null);
		assert.equal(parseAccelerator("banana"), null);
		assert.equal(parseAccelerator("Control_L"), null);
	});
});

describe("formatAccelerator", () => {
	it("writes modifiers in one fixed order", () => {
		const all = { ...CTRL_ALT_C, shift: true, super: true };
		assert.equal(formatAccelerator(all), "<Control><Alt><Shift><Super>c");
		assert.equal(
			formatAccelerator(parseAccelerator("<Alt><Control>c") as Accel),
			"<Control><Alt>c",
		);
	});

	it("uses the GDK spelling for named keys", () => {
		assert.equal(
			formatAccelerator({ ...CTRL_ALT_C, key: "page_up" }),
			"<Control><Alt>Page_Up",
		);
		assert.equal(formatAccelerator({ ...CTRL_ALT_C, key: "f9" }), "<Control><Alt>F9");
	});

	it("round-trips through parse", () => {
		for (const text of ["<Control><Alt>c", "<Shift><Super>F12", "<Control>space"])
			assert.equal(formatAccelerator(parseAccelerator(text) as Accel), text);
	});
});

describe("toElectronAccelerator", () => {
	it("translates the common cases", () => {
		assert.equal(toElectronAccelerator(CTRL_ALT_C), "Ctrl+Alt+C");
		assert.equal(
			toElectronAccelerator(parseAccelerator("<Control><Shift>F9") as Accel),
			"Ctrl+Shift+F9",
		);
		assert.equal(
			toElectronAccelerator(parseAccelerator("<Super>space") as Accel),
			"Super+Space",
		);
		assert.equal(
			toElectronAccelerator(parseAccelerator("<Control>Page_Up") as Accel),
			"Ctrl+PageUp",
		);
		assert.equal(
			toElectronAccelerator(parseAccelerator("<Alt>comma") as Accel),
			"Alt+,",
		);
	});
});

describe("describeAccelerator", () => {
	it("is what a human would type on a sticky note", () => {
		assert.equal(describeAccelerator(CTRL_ALT_C), "Ctrl + Alt + C");
		assert.equal(
			describeAccelerator(parseAccelerator("<Super>Page_Down") as Accel),
			"Super + Page Down",
		);
		assert.equal(
			describeAccelerator(parseAccelerator("<Control>Return") as Accel),
			"Ctrl + Enter",
		);
	});
});

describe("acceleratorFromKeyEvent", () => {
	const event = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
		code,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		metaKey: false,
		...mods,
	});

	it("uses the physical key, so the layout does not matter", () => {
		assert.deepEqual(
			acceleratorFromKeyEvent(event("KeyC", { ctrlKey: true, altKey: true })),
			CTRL_ALT_C,
		);
		assert.equal(acceleratorFromKeyEvent(event("Digit7", { altKey: true }))?.key, "7");
		assert.equal(acceleratorFromKeyEvent(event("F5"))?.key, "f5");
		assert.equal(acceleratorFromKeyEvent(event("ArrowUp"))?.key, "up");
		assert.equal(acceleratorFromKeyEvent(event("Quote"))?.key, "apostrophe");
		assert.equal(acceleratorFromKeyEvent(event("Enter"))?.key, "return");
	});

	it("maps the Windows key to Super", () => {
		assert.equal(acceleratorFromKeyEvent(event("KeyC", { metaKey: true }))?.super, true);
	});

	it("returns null for a modifier on its own or an unknown key", () => {
		assert.equal(acceleratorFromKeyEvent(event("ControlLeft", { ctrlKey: true })), null);
		assert.equal(acceleratorFromKeyEvent(event("ShiftRight", { shiftKey: true })), null);
		assert.equal(acceleratorFromKeyEvent(event("MediaPlayPause")), null);
	});
});

describe("hasModifier", () => {
	it("is false for a bare key", () => {
		assert.equal(hasModifier({ ...CTRL_ALT_C, ctrl: false, alt: false }), false);
		assert.equal(hasModifier(CTRL_ALT_C), true);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/core/hotkey.test.ts`
Expected: FAIL, cannot find module `src/core/hotkey.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/hotkey.ts
/**
 * Keyboard accelerators, in the three spellings this project needs.
 *
 * GTK's form ("<Control><Alt>c") is what GNOME's keybinding API reads and so
 * what is stored on both platforms. Electron wants "Ctrl+Alt+C". Humans want
 * "Ctrl + Alt + C". This module converts between them without touching any
 * platform API, so the conversions are unit tested on plain Node.
 */

export interface Accel {
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	super: boolean;
	/** A lower-case key name: a letter, a digit, "f1".."f35", or a NAMED key. */
	key: string;
}

type Modifier = "ctrl" | "alt" | "shift" | "super";

/** GTK modifier names, including the aliases gtk_accelerator_parse accepts. */
const MODIFIERS: Record<string, Modifier> = {
	control: "ctrl",
	ctrl: "ctrl",
	primary: "ctrl",
	alt: "alt",
	shift: "shift",
	super: "super",
	meta: "super",
};

interface KeyName {
	/** The GDK keyval name, as GTK writes it. */
	gdk: string;
	/** The Electron accelerator token. */
	electron: string;
	/** Wording for the settings UI. */
	label: string;
	/** The KeyboardEvent.code that produces it. */
	code: string;
}

/** Keys with a name of their own. Letters, digits and F-keys are handled by rule. */
const NAMED: Record<string, KeyName> = {
	space: { gdk: "space", electron: "Space", label: "Space", code: "Space" },
	tab: { gdk: "Tab", electron: "Tab", label: "Tab", code: "Tab" },
	return: { gdk: "Return", electron: "Return", label: "Enter", code: "Enter" },
	backspace: { gdk: "BackSpace", electron: "Backspace", label: "Backspace", code: "Backspace" },
	delete: { gdk: "Delete", electron: "Delete", label: "Delete", code: "Delete" },
	insert: { gdk: "Insert", electron: "Insert", label: "Insert", code: "Insert" },
	home: { gdk: "Home", electron: "Home", label: "Home", code: "Home" },
	end: { gdk: "End", electron: "End", label: "End", code: "End" },
	page_up: { gdk: "Page_Up", electron: "PageUp", label: "Page Up", code: "PageUp" },
	page_down: { gdk: "Page_Down", electron: "PageDown", label: "Page Down", code: "PageDown" },
	up: { gdk: "Up", electron: "Up", label: "Up", code: "ArrowUp" },
	down: { gdk: "Down", electron: "Down", label: "Down", code: "ArrowDown" },
	left: { gdk: "Left", electron: "Left", label: "Left", code: "ArrowLeft" },
	right: { gdk: "Right", electron: "Right", label: "Right", code: "ArrowRight" },
	minus: { gdk: "minus", electron: "-", label: "-", code: "Minus" },
	equal: { gdk: "equal", electron: "=", label: "=", code: "Equal" },
	comma: { gdk: "comma", electron: ",", label: ",", code: "Comma" },
	period: { gdk: "period", electron: ".", label: ".", code: "Period" },
	slash: { gdk: "slash", electron: "/", label: "/", code: "Slash" },
	backslash: { gdk: "backslash", electron: "\\", label: "\\", code: "Backslash" },
	semicolon: { gdk: "semicolon", electron: ";", label: ";", code: "Semicolon" },
	apostrophe: { gdk: "apostrophe", electron: "'", label: "'", code: "Quote" },
	grave: { gdk: "grave", electron: "`", label: "`", code: "Backquote" },
	bracketleft: { gdk: "bracketleft", electron: "[", label: "[", code: "BracketLeft" },
	bracketright: { gdk: "bracketright", electron: "]", label: "]", code: "BracketRight" },
};

const CODE_TO_KEY = new Map(
	Object.entries(NAMED).map(([key, name]) => [name.code, key]),
);

const LETTER = /^[a-z]$/;
const DIGIT = /^[0-9]$/;
const FKEY = /^f([1-9]|[12][0-9]|3[0-5])$/;

/** A lower-cased GDK key name, or null when it is not one this project binds. */
function normalizeKey(raw: string): string | null {
	const key = raw.trim().toLowerCase();
	if (LETTER.test(key) || DIGIT.test(key) || FKEY.test(key) || key in NAMED)
		return key;
	return null;
}

export function parseAccelerator(text: string): Accel | null {
	const accel: Accel = { ctrl: false, alt: false, shift: false, super: false, key: "" };
	let rest = text.trim();
	const modifier = /^<([a-z]+)>/i;
	for (let m = modifier.exec(rest); m; m = modifier.exec(rest)) {
		const name = MODIFIERS[m[1].toLowerCase()];
		if (!name) return null;
		accel[name] = true;
		rest = rest.slice(m[0].length);
	}
	const key = normalizeKey(rest);
	if (!key) return null;
	accel.key = key;
	return accel;
}

export function hasModifier(a: Accel): boolean {
	return a.ctrl || a.alt || a.shift || a.super;
}

function modifierParts(a: Accel, names: Record<Modifier, string>): string[] {
	const out: string[] = [];
	if (a.ctrl) out.push(names.ctrl);
	if (a.alt) out.push(names.alt);
	if (a.shift) out.push(names.shift);
	if (a.super) out.push(names.super);
	return out;
}

/** The GTK form, the way it is stored. */
export function formatAccelerator(a: Accel): string {
	const key = NAMED[a.key]?.gdk ?? (FKEY.test(a.key) ? a.key.toUpperCase() : a.key);
	return `${modifierParts(a, {
		ctrl: "<Control>",
		alt: "<Alt>",
		shift: "<Shift>",
		super: "<Super>",
	}).join("")}${key}`;
}

/** The form Electron's globalShortcut wants. */
export function toElectronAccelerator(a: Accel): string {
	const key = NAMED[a.key]?.electron ?? a.key.toUpperCase();
	return [
		...modifierParts(a, { ctrl: "Ctrl", alt: "Alt", shift: "Shift", super: "Super" }),
		key,
	].join("+");
}

/** Wording for a settings row. */
export function describeAccelerator(a: Accel): string {
	const key = NAMED[a.key]?.label ?? a.key.toUpperCase();
	return [
		...modifierParts(a, { ctrl: "Ctrl", alt: "Alt", shift: "Shift", super: "Super" }),
		key,
	].join(" + ");
}

/**
 * The accelerator a DOM key event describes, from the physical key so the
 * keyboard layout does not matter. Null for a modifier pressed on its own or
 * a key this project does not bind.
 */
export function acceleratorFromKeyEvent(e: {
	code: string;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	metaKey: boolean;
}): Accel | null {
	let key: string | null = null;
	const letter = /^Key([A-Z])$/.exec(e.code);
	const digit = /^Digit([0-9])$/.exec(e.code);
	const fkey = /^F([0-9]{1,2})$/.exec(e.code);
	if (letter) key = letter[1].toLowerCase();
	else if (digit) key = digit[1];
	else if (fkey) key = normalizeKey(`f${fkey[1]}`);
	else key = CODE_TO_KEY.get(e.code) ?? null;
	if (!key) return null;
	return { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, super: e.metaKey, key };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import ./tests/support/hooks.ts --test tests/core/hotkey.test.ts`
Expected: all pass.

- [ ] **Step 5: Format, lint and commit**

```bash
npm run fix && npm run lint && git add src/core/hotkey.ts tests/core/hotkey.test.ts && git commit -m "Add accelerator parsing and formatting for the hide hotkey"
```

### Task 2: The four new settings in core and the schema

**Files:**
- Modify: `src/core/config.ts`
- Modify: `src/schemas/org.gnome.shell.extensions.taskbar-cats.gschema.xml`
- Test: `tests/core/config.test.ts`

**Interfaces:**
- Consumes: `parseAccelerator`, `formatAccelerator` from Task 1.
- Produces, all exported from `src/core/config.ts`:
  - `Settings` gains `catPalettes: string[]`, `catNames: string[]`, `catSizes: number[]`, `toggleHotkey: string[]`.
  - `STRING_LIST_SETTINGS = { catPalettes: { key: "cat-palettes" }, catNames: { key: "cat-names" } }`
  - `CAT_SIZES_KEY = "cat-sizes"`, `CAT_SIZE_MIN = 16`, `CAT_SIZE_MAX = 128`
  - `HOTKEY_KEY = "toggle-hotkey"`, `DEFAULT_HOTKEY = "<Control><Alt>c"`
  - `normalizeStringList(raw: unknown): string[]`, `normalizeCatSizes(raw: unknown): number[]`, `normalizeHotkey(raw: unknown): string[]`

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `tests/core/config.test.ts`:

```ts
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
	PALETTES_KEY,
	POSITION_SETTINGS,
	STRING_LIST_SETTINGS,
	toStorage,
} from "../../src/core/config.ts";
```

Inside `describe("agrees with the GSettings schema")`, after the `POSITION_SETTINGS` loop and before `it("covers every key the schema declares")`, add:

```ts
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
			assert.deepEqual(JSON.parse(decoded.replace(/'/g, '"')), [DEFAULT_HOTKEY]);
		});
```

In `it("covers every key the schema declares")`, extend the `known` set:

```ts
			const known = new Set<string>([
				PALETTES_KEY,
				CAT_SIZES_KEY,
				HOTKEY_KEY,
				...Object.values(INT_SETTINGS).map((s) => s.key),
				...Object.values(BOOL_SETTINGS).map((s) => s.key),
				...Object.values(POSITION_SETTINGS).map((s) => s.key),
				...Object.values(STRING_LIST_SETTINGS).map((s) => s.key),
			]);
```

Inside `describe("normalizeSettings")`, after the `positions` block, add:

```ts
		describe("per-cat lists", () => {
			it("default to empty, meaning every cat is on Auto", () => {
				const s = defaultSettings();
				assert.deepEqual(s.catPalettes, []);
				assert.deepEqual(s.catNames, []);
				assert.deepEqual(s.catSizes, []);
			});

			it("keeps a string list index for index, blanking junk", () => {
				// The index is the cat number, so junk must not shift the rest.
				assert.deepEqual(normalizeStringList(["a", 7, null, "b"]), ["a", "", "", "b"]);
				assert.deepEqual(normalizeStringList("a,b"), []);
			});

			it("clamps sizes into range and keeps 0 as 'colony size'", () => {
				assert.deepEqual(normalizeCatSizes([0, 8, 64, 500, 33.4]), [0, 16, 64, 128, 33]);
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
				assert.deepEqual(normalizeSettings({ "toggle-hotkey": [] }).toggleHotkey, []);
			});

			it("keeps only the first accelerator that parses, in canonical form", () => {
				assert.deepEqual(normalizeHotkey(["nonsense", "<Alt><Control>x", "<Shift>y"]), [
					"<Control><Alt>x",
				]);
			});

			it("falls back to the default when the key holds junk", () => {
				assert.deepEqual(normalizeHotkey("ctrl+alt+c"), [DEFAULT_HOTKEY]);
				assert.deepEqual(normalizeSettings({ "toggle-hotkey": 5 }).toggleHotkey, [
					DEFAULT_HOTKEY,
				]);
			});

			it("round-trips through storage", () => {
				const original = normalizeSettings({ "toggle-hotkey": ["<Super>F2"] });
				assert.deepEqual(original.toggleHotkey, ["<Super>F2"]);
				assert.deepEqual(normalizeSettings(toStorage(original)), original);
			});
		});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/core/config.test.ts`
Expected: FAIL, the new exports do not exist.

- [ ] **Step 3: Extend the schema**

Add before the closing `</schema>` in `src/schemas/org.gnome.shell.extensions.taskbar-cats.gschema.xml`:

```xml
    <key name="cat-palettes" type="as">
      <default>[]</default>
      <summary>Fur palette of each cat</summary>
      <description>One entry per cat: a palette name, or an empty string to follow the "palettes" setting. Missing entries mean the same.</description>
    </key>

    <key name="cat-names" type="as">
      <default>[]</default>
      <summary>Name of each cat</summary>
      <description>One entry per cat, shown in the settings only. Empty or missing means "Cat N".</description>
    </key>

    <key name="cat-sizes" type="ai">
      <default>[]</default>
      <summary>Size of each cat in pixels</summary>
      <description>One entry per cat. 0, or a missing entry, uses the "sprite-size" setting. Otherwise 16 to 128.</description>
    </key>

    <key name="toggle-hotkey" type="as">
      <default>['&lt;Control&gt;&lt;Alt&gt;c']</default>
      <summary>Hide or show the cats</summary>
      <description>Keyboard shortcut that hides every cat and brings them back. An empty list turns the shortcut off.</description>
    </key>
```

- [ ] **Step 4: Extend `src/core/config.ts`**

Add the import at the top:

```ts
import { formatAccelerator, parseAccelerator } from "./hotkey.js";
```

Add to the `Settings` interface after `scratcherPositions`:

```ts
	/** Fur palette per cat, indexed by cat. "" or missing means Auto. */
	catPalettes: string[];
	/** Display name per cat, for the settings UI only. "" means "Cat N". */
	catNames: string[];
	/** Size per cat in logical pixels. 0 or missing means the colony size. */
	catSizes: number[];
	/**
	 * The accelerator that hides and shows the cats, in GTK syntax
	 * ("<Control><Alt>c"). At most one entry; an empty list means unbound.
	 */
	toggleHotkey: string[];
```

Add after `POSITION_SETTINGS`:

```ts
/** String lists indexed by cat number; junk entries become "". */
export const STRING_LIST_SETTINGS = {
	catPalettes: { key: "cat-palettes" },
	catNames: { key: "cat-names" },
} as const satisfies Record<string, { key: string }>;

export const CAT_SIZES_KEY = "cat-sizes";
export const CAT_SIZE_MIN = 16;
export const CAT_SIZE_MAX = 128;

export const HOTKEY_KEY = "toggle-hotkey";
export const DEFAULT_HOTKEY = "<Control><Alt>c";

/** Coerce one stored string list, keeping the index of every entry. */
export function normalizeStringList(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw.map((value) => (typeof value === "string" ? value : ""));
}

/** Coerce the per-cat sizes: 0 stays "colony size", anything else is clamped. */
export function normalizeCatSizes(raw: unknown): number[] {
	if (!Array.isArray(raw)) return [];
	return raw.map((value) => {
		const n =
			typeof value === "number" && Number.isFinite(value)
				? Math.round(value)
				: 0;
		if (n <= 0) return 0;
		return Math.min(CAT_SIZE_MAX, Math.max(CAT_SIZE_MIN, n));
	});
}

/**
 * Coerce the hotkey list: the first entry that parses, written canonically.
 * An empty list is a deliberate "unbound" and is kept; anything that is not a
 * list at all falls back to the default.
 */
export function normalizeHotkey(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [DEFAULT_HOTKEY];
	for (const value of raw) {
		if (typeof value !== "string") continue;
		const accel = parseAccelerator(value);
		if (accel) return [formatAccelerator(accel)];
	}
	return [];
}
```

In `defaultSettings()`, extend the literal:

```ts
	const out = {
		palettes: [] as string[],
		bedPositions: [] as number[],
		scratcherPositions: [] as number[],
		catPalettes: [] as string[],
		catNames: [] as string[],
		catSizes: [] as number[],
		toggleHotkey: [DEFAULT_HOTKEY],
	} as Settings;
```

In `normalizeSettings()`, before `return out;`:

```ts
	for (const [name, spec] of Object.entries(STRING_LIST_SETTINGS))
		(out as unknown as Record<string, string[]>)[name] = normalizeStringList(
			src[spec.key],
		);
	out.catSizes = normalizeCatSizes(src[CAT_SIZES_KEY]);
	if (HOTKEY_KEY in src) out.toggleHotkey = normalizeHotkey(src[HOTKEY_KEY]);
```

In `toStorage()`, before `return out;`:

```ts
	for (const [name, spec] of Object.entries(STRING_LIST_SETTINGS))
		out[spec.key] = (settings as unknown as Record<string, string[]>)[name];
	out[CAT_SIZES_KEY] = settings.catSizes;
	out[HOTKEY_KEY] = settings.toggleHotkey;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --import ./tests/support/hooks.ts --test tests/core/config.test.ts`
Expected: all pass, including the schema drift tests.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: everything passes. `tests/platform/gnome/extension.test.ts` still passes because the Gio stub returns `[]` for unknown `get_strv` keys and the extension does not read the new keys yet.

- [ ] **Step 7: Format, lint and commit**

```bash
npm run fix && npm run lint && git add src/core/config.ts src/schemas tests/core/config.test.ts && git commit -m "Add per-cat and hotkey settings to the shared tables and the schema"
```

### Task 3: The colony honours per-cat palette and size

**Files:**
- Modify: `src/core/colony.ts` (the `_palettes` / `_paletteFor` helpers at lines 159-170 and `sync()` at lines 180-225)
- Test: `tests/core/colony.test.ts`

**Interfaces:**
- Consumes: `Settings.catPalettes`, `Settings.catSizes` from Task 2; `resolvePalettes` from `src/core/sprites.ts`.
- Produces, exported from `src/core/colony.ts`:
  - `resolveCatPalette(settings: Pick<Settings, "palettes" | "catPalettes">, index: number, available: readonly string[]): string`
  - `resolveCatSize(settings: Pick<Settings, "catSizes">, index: number, colonySize: number): number`

- [ ] **Step 1: Write the failing tests**

Add `resolveCatPalette` and `resolveCatSize` to the import from `../../src/core/colony.ts` in `tests/core/colony.test.ts`. Then add a new top-level `describe` after the `PointerTracker` block:

```ts
describe("resolveCatPalette", () => {
	const available = ["a", "b", "c"];

	it("uses the cat's own palette when it exists", () => {
		const s = makeSettings({ palettes: ["a"], catPalettes: ["", "c"] });
		assert.equal(resolveCatPalette(s, 1, available), "c");
	});

	it("falls back to the colony pool for Auto, a missing entry or a stranger", () => {
		const s = makeSettings({ palettes: ["a", "b"], catPalettes: ["", "", "gone"] });
		assert.equal(resolveCatPalette(s, 0, available), "a");
		assert.equal(resolveCatPalette(s, 1, available), "b");
		assert.equal(resolveCatPalette(s, 2, available), "a", "cycles the pool by index");
		assert.equal(resolveCatPalette(s, 3, available), "b", "a missing entry is Auto");
	});

	it("names a palette even when the install has none at all", () => {
		assert.equal(resolveCatPalette(makeSettings(), 0, []), "tabby-orange");
	});
});

describe("resolveCatSize", () => {
	it("is the colony size unless the cat has its own", () => {
		const s = makeSettings({ catSizes: [0, 64] });
		assert.equal(resolveCatSize(s, 0, 48), 48);
		assert.equal(resolveCatSize(s, 1, 48), 64);
		assert.equal(resolveCatSize(s, 5, 48), 48, "a missing entry is Auto");
	});
});
```

Inside the existing `describe("palettes")` block in the colony `sync` tests, add:

```ts
			it("lets one cat wear a palette outside the colony pool", () => {
				const colony = new Colony(fakeHost(["a", "b", "c"]));
				colony.sync(
					makeSettings({ count: 3, palettes: ["a"], catPalettes: ["", "c"] }),
					[],
					makeBounds(),
				);
				assert.deepEqual(
					colony.cats.map((c) => c.palette),
					["a", "c", "a"],
				);
			});
```

Next to the existing `it("resizes the cats it already had")` test, add:

```ts
		it("gives a cat its own size while the others keep the colony's", () => {
			const colony = new Colony(fakeHost());
			colony.sync(
				makeSettings({ count: 2, spriteSize: 40, catSizes: [0, 72] }),
				[],
				makeBounds(),
			);
			assert.deepEqual(
				colony.cats.map((c) => c.iconSize),
				[40, 72],
			);
			// And back to Auto again.
			colony.sync(makeSettings({ count: 2, spriteSize: 40 }), [], makeBounds());
			assert.deepEqual(
				colony.cats.map((c) => c.iconSize),
				[40, 40],
			);
		});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/core/colony.test.ts`
Expected: FAIL, `resolveCatPalette` is not exported.

- [ ] **Step 3: Implement in `src/core/colony.ts`**

Delete the private `_palettes` and `_paletteFor` methods. Add these exported functions at module level, after the `FALLBACK_PALETTE` constant:

```ts
/**
 * The palette cat `index` wears: its own, if it has one that exists on disk,
 * otherwise its turn in the colony's pool. Shared with the settings UIs so a
 * cat on Auto previews exactly what it will get.
 */
export function resolveCatPalette(
	settings: Pick<Settings, "palettes" | "catPalettes">,
	index: number,
	available: readonly string[],
): string {
	const own = settings.catPalettes[index];
	if (own && available.includes(own)) return own;
	const pool = resolvePalettes(settings.palettes, available);
	return pool[index % pool.length] ?? FALLBACK_PALETTE;
}

/** The size cat `index` is drawn at: its own, or the colony's. */
export function resolveCatSize(
	settings: Pick<Settings, "catSizes">,
	index: number,
	colonySize: number,
): number {
	return settings.catSizes[index] || colonySize;
}
```

In `sync()`, remove `const palettes = this._palettes(settings);`, and in the two places palettes and sizes are applied:

```ts
		const available = this._host.sprites.palettes;
		// ... the pop loop is unchanged ...
		while (this.cats.length < settings.count) {
			const i = this.cats.length;
			const x = bounds
				? bounds.roam.min +
					((bounds.roam.max - bounds.roam.min) * (i + 1)) / (settings.count + 1)
				: 100 + i * 60;
			this.cats.push(
				new Cat({
					view: this._host.createView(),
					sprites: this._host.sprites,
					palette: resolveCatPalette(settings, i, available),
					size: resolveCatSize(settings, i, size),
					x,
					index: i,
				}),
			);
		}

		// Palette assignment and size can change without the count changing.
		this.cats.forEach((cat, i) => {
			cat.palette = resolveCatPalette(settings, i, available);
			cat.index = i;
			cat.setSize(resolveCatSize(settings, i, size));
		});
		this._size = size;
```

`resolvePalettes` is already imported from `./sprites.js`; keep that import.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import ./tests/support/hooks.ts --test tests/core/colony.test.ts`
Expected: all pass, including the pre-existing palette tests.

- [ ] **Step 5: Type-check, format, lint and commit**

```bash
npm run typecheck && npm run fix && npm run lint && git add src/core/colony.ts tests/core/colony.test.ts && git commit -m "Let each cat have its own palette and size"
```

---

### Task 4: Preview frame paths in core

**Files:**
- Modify: `src/core/sprites.ts`
- Test: `tests/core/sprites.test.ts`

**Interfaces:**
- Produces, exported from `src/core/sprites.ts`:
  - `PREVIEW_FRAME_MS = 125`
  - `previewFrames(manifest: SpriteManifest, palette: string, animation = "walk"): string[]` (manifest-relative paths)

- [ ] **Step 1: Write the failing tests**

Add `PREVIEW_FRAME_MS, previewFrames` to the import in `tests/core/sprites.test.ts`, and a new `describe` at the end of the file:

```ts
describe("previewFrames", () => {
	it("lists the walk cycle for a palette, in order", () => {
		const manifest = { palettes: ["a"], animations: { idle: 2, walk: 3 } };
		assert.deepEqual(previewFrames(manifest, "a"), [
			"a/walk_0.svg",
			"a/walk_1.svg",
			"a/walk_2.svg",
		]);
	});

	it("falls back to idle when the animation is missing", () => {
		assert.deepEqual(previewFrames(MANIFEST, "b", "dance"), ["b/idle_0.svg", "b/idle_1.svg"]);
	});

	it("is empty for a manifest with neither", () => {
		assert.deepEqual(previewFrames({ palettes: ["a"], animations: {} }, "a"), []);
	});

	it("plays at 8 frames a second", () => {
		assert.equal(PREVIEW_FRAME_MS, 125);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/core/sprites.test.ts`
Expected: FAIL, `previewFrames` is not exported.

- [ ] **Step 3: Implement in `src/core/sprites.ts`**

Add after `resolvePalettes`:

```ts
/** How long each preview frame is shown in the settings UIs. */
export const PREVIEW_FRAME_MS = 125;

/**
 * The frames a settings preview loops through for one palette. Walk is the
 * animation that reads as "a cat" at a glance; idle stands in when a manifest
 * has no walk.
 */
export function previewFrames(
	manifest: SpriteManifest,
	palette: string,
	animation = "walk",
): string[] {
	const name = manifest.animations[animation] ? animation : FALLBACK_ANIMATION;
	const count = manifest.animations[name] ?? 0;
	return Array.from({ length: count }, (_, frame) =>
		framePath(palette, name, frame),
	);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import ./tests/support/hooks.ts --test tests/core/sprites.test.ts`
Expected: all pass.

- [ ] **Step 5: Format, lint and commit**

```bash
npm run fix && npm run lint && git add src/core/sprites.ts tests/core/sprites.test.ts && git commit -m "Name the frames a settings preview loops through"
```

### Task 5: GNOME extension reads the new keys, binds the hotkey, hides on demand

**Files:**
- Modify: `src/platform/gnome/extension.ts`
- Create: `tests/support/gnome/stubs/Meta.ts`, `tests/support/gnome/stubs/Shell.ts`
- Modify: `tests/support/gnome/stubs/shellMain.ts`
- Test: `tests/platform/gnome/extension.test.ts`

**Interfaces:**
- Consumes: `STRING_LIST_SETTINGS`, `CAT_SIZES_KEY`, `HOTKEY_KEY`, `normalizeStringList`, `normalizeCatSizes`, `normalizeHotkey` from Task 2.
- Produces: test stubs `Main.wm.addKeybinding(name, settings, flags, modes, handler)`, `Main.wm.removeKeybinding(name)`, `Main.wm.__press(name)`, `Main.wm.bindings: Map<string, () => void>`; `Meta.KeyBindingFlags.NONE`; `Shell.ActionMode.NORMAL | OVERVIEW`.

- [ ] **Step 1: Add the stubs**

`tests/support/gnome/stubs/Meta.ts`:

```ts
/** Just the flags the extension passes to addKeybinding. */
export const KeyBindingFlags = { NONE: 0 };
export default { KeyBindingFlags };
```

`tests/support/gnome/stubs/Shell.ts`:

```ts
/** Just the action modes the extension binds its hotkey in. */
export const ActionMode = { NORMAL: 1, OVERVIEW: 2 };
export default { ActionMode };
```

In `tests/support/gnome/stubs/shellMain.ts`, add after the `Overview` class:

```ts
/** Main.wm, reduced to the keybinding registry the extension uses. */
class WindowManager {
	bindings = new Map<string, () => void>();
	addKeybinding(
		name: string,
		_settings: unknown,
		_flags: number,
		_modes: number,
		handler: () => void,
	): number {
		this.bindings.set(name, handler);
		return this.bindings.size;
	}
	removeKeybinding(name: string): void {
		this.bindings.delete(name);
	}
	/** Test control: press the shortcut bound under `name`. */
	__press(name: string): void {
		const handler = this.bindings.get(name);
		if (!handler) throw new Error(`no keybinding named ${name}`);
		handler();
	}
}
```

Export it next to the others and clear it in `__reset()`:

```ts
export const wm = new WindowManager();
// inside __reset(), with the other clears:
	wm.bindings.clear();
```

- [ ] **Step 2: Write the failing tests**

In `tests/platform/gnome/extension.test.ts`, extend `DEFAULTS`:

```ts
	"cat-palettes": [],
	"cat-names": [],
	"cat-sizes": [],
	"toggle-hotkey": ["<Control><Alt>c"],
```

Add a helper next to `catActors()`:

```ts
function layer(): FakeActor {
	const found = Main.layoutManager.uiGroup
		.get_children()
		.find((c) => c.style_class === "taskbar-cats-layer");
	assert.ok(found, "overlay missing");
	return found;
}
```

Inside `describe("settings")`, add:

```ts
		it("gives one cat its own size, live", () => {
			const { settings } = enableExtension({ "cat-count": 2 });
			tick(2);
			settings.__change("cat-sizes", [72]);
			tick(2);
			const sizes = catActors().map((c) => (c as { icon_size: number }).icon_size);
			assert.deepEqual(sizes, [72, 48]);
		});

		it("dresses one cat in its own palette, live", () => {
			const { settings } = enableExtension({ "cat-count": 2, palettes: ["black"] });
			settings.__change("cat-palettes", ["", "siamese"]);
			tick(2);
			const worn = catActors().map((c) =>
				String((c as { gicon: { path: string } }).gicon.path),
			);
			assert.match(worn[0], /\/black\//);
			assert.match(worn[1], /\/siamese\//);
		});
```

Add a new `describe("the hide hotkey")` block after `describe("the tick")`:

```ts
	describe("the hide hotkey", () => {
		it("is bound under the settings key while enabled, and unbound after", () => {
			const { ext } = enableExtension();
			assert.ok(Main.wm.bindings.has("toggle-hotkey"));
			ext.disable();
			assert.equal(Main.wm.bindings.size, 0, "keybinding leaked");
		});

		it("hides the cats, idles the tick, and brings them back where they were", () => {
			enableExtension({ "sleep-after": 0, "mouse-attraction": 0 });
			tick(5);
			assert.equal(layer().visible, true);
			const before = catActors().map((c) => c.x);
			const busy = GLib.__sources()[0].intervalMs;

			Main.wm.__press("toggle-hotkey");
			tick(5);
			assert.equal(layer().visible, false);
			assert.ok(GLib.__sources()[0].intervalMs > busy, "should idle while hidden");
			assert.deepEqual(
				catActors().map((c) => c.x),
				before,
				"the simulation should pause while hidden",
			);

			Main.wm.__press("toggle-hotkey");
			tick(1);
			assert.equal(layer().visible, true);
			assert.equal(GLib.__sources()[0].intervalMs, busy);
		});

		it("comes back visible after a disable and enable while hidden", () => {
			const { ext } = enableExtension();
			Main.wm.__press("toggle-hotkey");
			tick(2);
			ext.disable();
			(ext as unknown as { __settings: unknown }).__settings = new Settings({ ...DEFAULTS });
			ext.enable();
			tick(2);
			assert.equal(layer().visible, true);
			ext.disable();
		});
	});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/platform/gnome/extension.test.ts`
Expected: FAIL, `Main.wm.bindings` has no `toggle-hotkey`, and `cat-sizes` has no effect.

- [ ] **Step 4: Implement in `src/platform/gnome/extension.ts`**

Imports:

```ts
import type Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
```

and extend the config import:

```ts
import {
	BOOL_SETTINGS,
	CAT_SIZES_KEY,
	defaultSettings,
	HOTKEY_KEY,
	INT_SETTINGS,
	normalizeCatSizes,
	normalizeHotkey,
	normalizePositions,
	normalizeStringList,
	PALETTES_KEY,
	POSITION_SETTINGS,
	type Settings,
	STRING_LIST_SETTINGS,
} from "../../core/config.js";
```

Add a field next to `_cfg`:

```ts
	/** Set by the hotkey. Runtime only: a fresh enable always shows the cats. */
	private _hidden = false;
```

In `enable()`, after the `settings.connect("changed", ...)` block:

```ts
		this._hidden = false;
		// GNOME re-reads the accelerator from the settings key whenever it
		// changes, so the prefs dialog needs no extra wiring to rebind it.
		Main.wm.addKeybinding(
			HOTKEY_KEY,
			rt.settings,
			Meta.KeyBindingFlags.NONE,
			Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
			() => this._toggleHidden(),
		);
```

In `disable()`, add a step right after the `settings` step:

```ts
		step("keybinding", () => {
			Main.wm.removeKeybinding(HOTKEY_KEY);
		});
```

In `_readConfig()`, before `this._cfg = cfg;`:

```ts
		for (const [name, spec] of Object.entries(STRING_LIST_SETTINGS))
			(cfg as unknown as Record<string, string[]>)[name] = normalizeStringList(
				s.get_strv(spec.key),
			);
		cfg.catSizes = normalizeCatSizes(
			s.get_value(CAT_SIZES_KEY).deepUnpack<number[]>(),
		);
		cfg.toggleHotkey = normalizeHotkey(s.get_strv(HOTKEY_KEY));
```

In `_onSettingChanged()`, extend the `if` that calls `_syncCats`:

```ts
			key === POSITION_SETTINGS.scratcherPositions.key ||
			key === STRING_LIST_SETTINGS.catPalettes.key ||
			key === CAT_SIZES_KEY
```

Add a method after `_rediscover()`:

```ts
	private _toggleHidden(): void {
		this._hidden = !this._hidden;
		// Wake the tick so the change shows at once rather than at the next
		// drowsy interval.
		this._setInterval(ACTIVE_INTERVAL_MS);
	}
```

In `_tick()`, make the hidden flag veto the monitor lookup so the existing else-branch (hide layer, release icons, idle) does the work:

```ts
		const monitor =
			!this._hidden && rt.tracker.isUsable() ? rt.tracker.getMonitorRect() : null;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --import ./tests/support/hooks.ts --test tests/platform/gnome/extension.test.ts`
Expected: all pass. If `_setInterval` returns early because the interval is unchanged, that is fine: the next tick already applies the flag.

- [ ] **Step 6: Type-check, format, lint and commit**

```bash
npm run typecheck && npm run fix && npm run lint && git add src/platform/gnome/extension.ts tests/support/gnome/stubs tests/platform/gnome/extension.test.ts && git commit -m "Bind a GNOME hotkey that hides and shows the cats"
```

### Task 6: Windows main process: global shortcut, hidden state, tray item

**Files:**
- Modify: `src/platform/win32/ipc.ts`
- Modify: `src/platform/win32/preload.ts`
- Modify: `src/platform/win32/renderer/overlay.ts`
- Modify: `src/platform/win32/main.ts`
- Test: `tests/platform/win32/preload.test.ts`, `tests/platform/win32/config.test.ts`

**Interfaces:**
- Consumes: `parseAccelerator`, `toElectronAccelerator` (Task 1); `Settings.toggleHotkey` (Task 2).
- Produces:
  - `CHANNELS.visible = "cats:visible"` (main to overlay, payload `boolean`).
  - `SettingsDescription.hotkeyError: string | null`.
  - Preload API `onVisible(fn: (visible: boolean) => void): void`.

- [ ] **Step 1: Write the failing tests**

In `tests/platform/win32/preload.test.ts`, add `"cats:visible"` to the channel list in `it("still names the channels rather than inventing its own")`.

In `tests/platform/win32/config.test.ts`, inside `describe("ConfigStore")`, add:

```ts
	it("persists the per-cat lists and the hotkey, keyed as the schema is", () => {
		const store = new ConfigStore(dir);
		store.update({
			catNames: ["Mochi"],
			catPalettes: ["siamese"],
			catSizes: [0, 500],
			toggleHotkey: ["<Alt><Control>x"],
		});
		const raw = JSON.parse(
			readFileSync(join(dir, "settings.json"), "utf8"),
		) as Record<string, unknown>;
		assert.deepEqual(raw["cat-names"], ["Mochi"]);
		assert.deepEqual(raw["cat-palettes"], ["siamese"]);
		assert.deepEqual(raw["cat-sizes"], [0, 128], "clamped on the way");
		assert.deepEqual(raw["toggle-hotkey"], ["<Control><Alt>x"], "canonical form");
		assert.deepEqual(new ConfigStore(dir).settings.toggleHotkey, ["<Control><Alt>x"]);
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/platform/win32/preload.test.ts tests/platform/win32/config.test.ts`
Expected: the preload test fails on the missing `cats:visible` channel. The config test passes already (Task 2 did the work); keep it as a regression guard.

- [ ] **Step 3: Extend `ipc.ts`**

Add to the `CHANNELS` enum, after `pointer`:

```ts
	/** main -> overlay: whether the cats should be simulated and drawn. */
	visible = "cats:visible",
```

Add to `SettingsDescription`:

```ts
	/**
	 * Null when the hide hotkey is registered (or unbound). Otherwise why it is
	 * not, usually because another program owns the combination.
	 */
	hotkeyError: string | null;
```

- [ ] **Step 4: Extend `preload.ts`**

Add to `api` after `onPointer`:

```ts
	onVisible: (fn: (visible: boolean) => void): void => {
		ipcRenderer.on(CHANNELS.visible, (_event, visible: boolean) => fn(visible));
	},
```

Update the header comment from "exactly the six messages" to "exactly the messages in ipc.ts".

- [ ] **Step 5: Pause the overlay while hidden (`overlay.ts`)**

Extend the declared API:

```ts
declare const cats: {
	onLayout(fn: (layout: Layout | null) => void): void;
	onPointer(fn: (pointer: { x: number; y: number }) => void): void;
	onVisible(fn: (visible: boolean) => void): void;
	onSettings(fn: (settings: Settings) => void): void;
	manifest(): Promise<SpriteManifest>;
	ready(): void;
};
```

After `let dirty = true;`:

```ts
	/** False while the hotkey has hidden the cats; the window is hidden too. */
	let shown = true;

	cats.onVisible((visible) => {
		shown = visible;
	});
```

In `frame`, change `if (!layout) return;` to:

```ts
		// `last` was refreshed above, so the cats resume without a dt jump.
		if (!layout || !shown) return;
```

- [ ] **Step 6: Register the shortcut in `main.ts`**

Add `globalShortcut` to the electron import, and:

```ts
import { parseAccelerator, toElectronAccelerator } from "../../core/hotkey.js";
```

Add fields to `CatsApp`:

```ts
	private _hidden = false;
	private _hotkeyError: string | null = null;
	/** The Electron accelerator currently registered, to unregister it later. */
	private _registeredHotkey: string | null = null;
```

In `start()`, replace the `this._config.onChange(...)` call with:

```ts
		this._config.onChange((settings, changed) => {
			for (const window of [this._overlay?.window, this._settingsWindow])
				if (window && !window.isDestroyed())
					window.webContents.send(CHANNELS.settings, settings);
			if (changed.includes("toggleHotkey")) this._registerHotkey(settings);
		});
		this._registerHotkey(this._config.settings);
```

Add `hotkeyError: this._hotkeyError` to the object returned by the `CHANNELS.describe` handler.

In `stop()`, add `globalShortcut.unregisterAll();` before `this._shell.dispose();`.

Replace `_createTray()` with a menu that can be rebuilt:

```ts
	private _createTray(): void {
		const tray = new Tray(trayImage());
		tray.setToolTip(app.getName());
		tray.setContextMenu(this._trayMenu());
		tray.on("double-click", () => this._openSettings());
		this._tray = tray;
	}

	private _trayMenu(): Menu {
		const updater = this._updater;
		return Menu.buildFromTemplate([
			{ label: "Settings…", click: () => this._openSettings() },
			{
				label: "Hide cats",
				type: "checkbox",
				checked: this._hidden,
				click: (item) => this._setHidden(item.checked),
			},
			{
				label: "Check for updates…",
				click: () => void updater?.checkNow(),
			},
			{
				label: "Start with Windows",
				type: "checkbox",
				checked: app.getLoginItemSettings().openAtLogin,
				click: (item) => {
					app.setLoginItemSettings({ openAtLogin: item.checked });
				},
			},
			{ type: "separator" },
			{
				label: "Open settings file",
				click: () => {
					void electronShell.openPath(this._config.path);
				},
			},
			{ type: "separator" },
			{ label: `Version ${app.getVersion()}`, enabled: false },
			{ label: "Quit", click: () => app.quit() },
		]);
	}
```

Add a `// -- hiding ---` section after `_pushSettings()`:

```ts
	/**
	 * (Re)register the global shortcut from the settings. Electron reports a
	 * clash by returning false rather than throwing, and says nothing about
	 * who owns the key, so the message is necessarily vague.
	 */
	private _registerHotkey(settings: Settings): void {
		if (this._registeredHotkey) {
			globalShortcut.unregister(this._registeredHotkey);
			this._registeredHotkey = null;
		}
		this._hotkeyError = null;
		const accel = settings.toggleHotkey[0]
			? parseAccelerator(settings.toggleHotkey[0])
			: null;
		if (!accel) return;
		const electronAccel = toElectronAccelerator(accel);
		let ok = false;
		try {
			ok = globalShortcut.register(electronAccel, () => this._toggleHidden());
		} catch (e) {
			console.error(`taskbar-cats: cannot register ${electronAccel}: ${e}`);
		}
		if (ok) this._registeredHotkey = electronAccel;
		else
			this._hotkeyError = `${electronAccel} could not be registered. Another program may already use it.`;
	}

	private _toggleHidden(): void {
		this._setHidden(!this._hidden);
	}

	private _setHidden(hidden: boolean): void {
		if (hidden === this._hidden) return;
		this._hidden = hidden;
		const window = this._overlay?.window;
		if (window && !window.isDestroyed())
			window.webContents.send(CHANNELS.visible, !hidden);
		// The tick hides or shows the window on its next pass.
		this._tray?.setContextMenu(this._trayMenu());
	}
```

In `_tick()`, change `const visible = this._tracker.isUsable();` to:

```ts
		const visible = !this._hidden && this._tracker.isUsable();
```

- [ ] **Step 7: Type-check and test**

Run: `npm run typecheck && npm test`
Expected: everything passes, including the preload channel test.

- [ ] **Step 8: Try it on Windows**

Run: `npm run win:dev`. Press Ctrl+Alt+C: the cats vanish; the tray menu shows "Hide cats" checked. Press again: they return where they were. Tick "Hide cats" in the tray: same effect. Quit the app cleanly from the tray.

- [ ] **Step 9: Format, lint and commit**

```bash
npm run fix && npm run lint && git add src/platform/win32 tests/platform/win32 && git commit -m "Hide and show the Windows cats with a global shortcut and a tray item"
```

### Task 7: Windows settings window: previews, per-cat rows, hotkey row

**Files:**
- Create: `src/platform/win32/renderer/preview.ts`
- Modify: `src/platform/win32/renderer/settings.ts`
- Modify: `src/platform/win32/renderer/settings.html`

**Interfaces:**
- Consumes: `previewFrames`, `PREVIEW_FRAME_MS` (Task 4); `resolveCatPalette` (Task 3); `CAT_SIZE_MIN`, `CAT_SIZE_MAX` (Task 2); `parseAccelerator`, `formatAccelerator`, `describeAccelerator`, `acceleratorFromKeyEvent`, `hasModifier` (Task 1); `SettingsDescription.hotkeyError` and the preload's `manifest()` (Task 6).
- Produces: `class SpritePreview { readonly element: HTMLImageElement; constructor(manifest: SpriteManifest, size?: number); setPalette(palette: string): void; destroy(): void }`.

This task has no unit tests: the renderer runs only inside Electron. Verify by hand in Step 5.

- [ ] **Step 1: Write `preview.ts`**

```ts
// src/platform/win32/renderer/preview.ts
/**
 * A looping cat for the settings window.
 *
 * Frames are the same SVGs the overlay draws, served from the bundle scheme.
 * They are decoded once per palette and shared, so eight previews of the same
 * palette cost one set of images. Every preview pauses while the window is
 * hidden: a settings window left open behind something else should not burn
 * a timer per cat.
 */
import {
	PREVIEW_FRAME_MS,
	previewFrames,
	type SpriteManifest,
} from "../../../core/sprites.js";

const ASSET_ROOT = "../../../assets/cats";

const decoded = new Map<string, Promise<HTMLImageElement[]>>();

function framesFor(
	manifest: SpriteManifest,
	palette: string,
): Promise<HTMLImageElement[]> {
	let pending = decoded.get(palette);
	if (!pending) {
		const images = previewFrames(manifest, palette).map((relative) => {
			const image = new Image();
			image.src = `${ASSET_ROOT}/${relative}`;
			return image;
		});
		pending = Promise.all(
			images.map((image) => image.decode().catch(() => {})),
		).then(() => images);
		decoded.set(palette, pending);
	}
	return pending;
}

const live = new Set<SpritePreview>();
document.addEventListener("visibilitychange", () => {
	for (const preview of live) preview.syncPlayback();
});

export class SpritePreview {
	readonly element: HTMLImageElement;
	private readonly _manifest: SpriteManifest;
	private _palette = "";
	private _frames: HTMLImageElement[] = [];
	private _index = 0;
	private _timer: ReturnType<typeof setInterval> | null = null;

	constructor(manifest: SpriteManifest, size = 48) {
		this._manifest = manifest;
		const element = document.createElement("img");
		element.className = "preview";
		element.alt = "";
		element.draggable = false;
		element.width = size;
		element.height = size;
		this.element = element;
		live.add(this);
	}

	setPalette(palette: string): void {
		if (palette === this._palette) return;
		this._palette = palette;
		this._index = 0;
		void framesFor(this._manifest, palette).then((frames) => {
			// The palette may have changed again while these decoded.
			if (this._palette !== palette) return;
			this._frames = frames;
			this._show();
			this.syncPlayback();
		});
	}

	/** Run the timer only while there is something to show and someone to see it. */
	syncPlayback(): void {
		const shouldRun = this._frames.length > 1 && !document.hidden;
		if (shouldRun && !this._timer)
			this._timer = setInterval(() => this._advance(), PREVIEW_FRAME_MS);
		else if (!shouldRun && this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
	}

	private _advance(): void {
		this._index = (this._index + 1) % this._frames.length;
		this._show();
	}

	private _show(): void {
		const frame = this._frames[this._index];
		if (frame && this.element.src !== frame.src) this.element.src = frame.src;
	}

	destroy(): void {
		live.delete(this);
		this._frames = [];
		this.syncPlayback();
		this.element.remove();
	}
}
```

- [ ] **Step 2: Add styles to `settings.html`**

Inside the `<style>` block, after the `.palette` rule:

```css
			.preview {
				width: 48px;
				height: 48px;
				image-rendering: pixelated;
				flex-shrink: 0;
			}
			.cats {
				padding: 14px 0 4px;
				border-top: 1px solid var(--line);
			}
			.cats .cat {
				display: grid;
				grid-template-columns: 48px 1fr;
				gap: 4px 12px;
				padding: 10px 0;
				border-top: 1px solid var(--line);
			}
			.cats .cat:first-of-type {
				border-top: none;
			}
			.cats .cat .preview {
				grid-row: span 3;
				align-self: center;
			}
			.cats .cat .row {
				padding: 2px 0;
				border-top: none;
			}
			.cats input[type="text"],
			.cats select {
				font: inherit;
				color: var(--fg);
				background: var(--bg);
				border: 1px solid var(--line);
				border-radius: 4px;
				padding: 3px 6px;
				min-width: 150px;
			}
			.cats .auto {
				display: flex;
				align-items: center;
				gap: 6px;
				margin-left: 4px;
			}
			button {
				font: inherit;
				color: var(--fg);
				background: var(--bg);
				border: 1px solid var(--line);
				border-radius: 4px;
				padding: 4px 10px;
				cursor: pointer;
			}
			.error {
				color: #c0392b;
				font-size: 12px;
			}
```

- [ ] **Step 3: Extend `settings.ts`**

Imports:

```ts
import { resolveCatPalette } from "../../../core/colony.js";
import {
	AUTO_POSITION,
	BOOL_SETTINGS,
	CAT_SIZE_MAX,
	CAT_SIZE_MIN,
	INT_SETTINGS,
	type Settings,
} from "../../../core/config.js";
import {
	acceleratorFromKeyEvent,
	describeAccelerator,
	formatAccelerator,
	hasModifier,
	parseAccelerator,
} from "../../../core/hotkey.js";
import type { SpriteManifest } from "../../../core/sprites.js";
import type { SettingsDescription } from "../ipc.js";
import { SpritePreview } from "./preview.js";
```

Extend the declared preload API:

```ts
declare const cats: {
	onSettings(fn: (settings: Settings) => void): void;
	apply(patch: Partial<Settings>): void;
	describe(): Promise<SettingsDescription>;
	manifest(): Promise<SpriteManifest>;
};
```

In `main()`, after `const description = await cats.describe();`:

```ts
	const manifest = await cats.manifest();
```

Insert the per-cat section builder after the `BOOL_SETTINGS` loop and before `// -- positions`, then call it:

```ts
	// -- each cat ----------------------------------------------------------
	// One block per cat: a name, a palette, a size with an Auto box, and a
	// preview of what that cat will actually wear. Rebuilt when the count
	// changes; otherwise every settings echo just refreshes the values.
	const catRows = (): void => {
		const section = element("div", "cats");
		section.appendChild(element("div", "title", "Each cat"));
		section.appendChild(
			element(
				"div",
				"hint",
				"Auto follows the fur palettes and the cat size above.",
			),
		);
		const list = element("div", "list");
		section.appendChild(list);
		form.appendChild(section);

		interface CatControls {
			block: HTMLElement;
			title: HTMLElement;
			name: HTMLInputElement;
			palette: HTMLSelectElement;
			size: HTMLInputElement;
			sizeReadout: HTMLElement;
			auto: HTMLInputElement;
			preview: SpritePreview;
		}
		let shownCount = -1;
		const controls: CatControls[] = [];

		const commit = (): void => {
			const catNames = [...current.catNames];
			const catPalettes = [...current.catPalettes];
			const catSizes = [...current.catSizes];
			controls.forEach((c, i) => {
				catNames[i] = c.name.value;
				catPalettes[i] = c.palette.value;
				catSizes[i] = c.auto.checked ? 0 : Number(c.size.value);
			});
			for (let k = 0; k < controls.length; k++) {
				catNames[k] ??= "";
				catPalettes[k] ??= "";
				catSizes[k] ??= 0;
			}
			cats.apply({ catNames, catPalettes, catSizes });
		};

		const reflect = (c: CatControls, i: number, settings: Settings): void => {
			c.title.textContent = c.name.value.trim() || `Cat ${i + 1}`;
			c.size.disabled = c.auto.checked;
			c.sizeReadout.textContent = c.auto.checked ? "auto" : c.size.value;
			c.preview.setPalette(resolveCatPalette(settings, i, description.palettes));
		};

		const render = (settings: Settings): void => {
			if (settings.count !== shownCount) {
				shownCount = settings.count;
				for (const c of controls) c.preview.destroy();
				list.textContent = "";
				controls.length = 0;
				for (let i = 0; i < settings.count; i++) {
					const block = element("div", "cat");
					const preview = new SpritePreview(manifest);
					block.appendChild(preview.element);

					const title = element("div", "title");
					block.appendChild(title);

					const name = element("input");
					name.type = "text";
					name.placeholder = `Cat ${i + 1}`;
					name.maxLength = 24;
					block.appendChild(row("Name", undefined, name));

					const palette = element("select");
					const auto = new Option("Auto", "");
					palette.appendChild(auto);
					for (const p of description.palettes)
						palette.appendChild(new Option(p, p));
					block.appendChild(row("Fur palette", undefined, palette));

					const size = element("input");
					size.type = "range";
					size.min = String(CAT_SIZE_MIN);
					size.max = String(CAT_SIZE_MAX);
					size.step = "1";
					size.value = "48";
					const sizeReadout = element("span", "value");
					const autoBox = element("input");
					autoBox.type = "checkbox";
					const autoLabel = element("label", "auto");
					autoLabel.appendChild(autoBox);
					autoLabel.appendChild(element("span", undefined, "Auto"));
					const side = element("div", "control");
					side.appendChild(sizeReadout);
					side.appendChild(size);
					side.appendChild(autoLabel);
					const sizeRow = element("div", "row");
					const text = element("div", "text");
					text.appendChild(element("div", "title", "Size"));
					sizeRow.appendChild(text);
					sizeRow.appendChild(side);
					block.appendChild(sizeRow);

					list.appendChild(block);
					const c: CatControls = {
						block,
						title,
						name,
						palette,
						size,
						sizeReadout,
						auto: autoBox,
						preview,
					};
					name.addEventListener("input", () => {
						reflect(c, i, current);
						commit();
					});
					palette.addEventListener("change", commit);
					size.addEventListener("input", () => {
						reflect(c, i, current);
						commit();
					});
					autoBox.addEventListener("change", () => {
						reflect(c, i, current);
						commit();
					});
					controls.push(c);
				}
			}
			controls.forEach((c, i) => {
				const name = settings.catNames[i] ?? "";
				// Only touch the field when it differs, or the caret jumps.
				if (c.name.value !== name) c.name.value = name;
				const palette = settings.catPalettes[i] ?? "";
				c.palette.value = description.palettes.includes(palette) ? palette : "";
				const size = settings.catSizes[i] ?? 0;
				c.auto.checked = size === 0;
				if (size) c.size.value = String(size);
				reflect(c, i, settings);
			});
		};
		render(current);
		sync.push(render);
	};
	catRows();
```

In the `// -- palettes` block, put a preview before each checkbox. After `const label = element("label", "palette");` add:

```ts
			const preview = new SpritePreview(manifest);
			preview.setPalette(palette);
			label.appendChild(preview.element);
```

Add the hotkey row builder after the palettes block and before `footer.textContent = ...`, then call it:

```ts
	// -- the hide hotkey ---------------------------------------------------
	const hotkeyRow = (): void => {
		const shown = element("span", "value");
		const button = element("button", undefined, "Change");
		const wrapper = row(
			"Hide or show the cats",
			"a keyboard shortcut that works in any program",
			button,
			shown,
		);
		const status = element("div", "error");
		status.hidden = true;
		wrapper.querySelector(".text")?.appendChild(status);
		form.appendChild(wrapper);

		const show = (settings: Settings): void => {
			const accel = settings.toggleHotkey[0]
				? parseAccelerator(settings.toggleHotkey[0])
				: null;
			shown.textContent = accel ? describeAccelerator(accel) : "Not set";
		};
		const refreshStatus = async (): Promise<void> => {
			const { hotkeyError } = await cats.describe();
			status.textContent = hotkeyError ?? "";
			status.hidden = !hotkeyError;
		};

		let capturing = false;
		const stop = (): void => {
			capturing = false;
			button.textContent = "Change";
			document.removeEventListener("keydown", onKey, true);
			show(current);
		};
		const onKey = (event: KeyboardEvent): void => {
			event.preventDefault();
			event.stopPropagation();
			if (event.key === "Escape") return stop();
			const accel = acceleratorFromKeyEvent(event);
			if (event.key === "Backspace" && accel && !hasModifier(accel)) {
				cats.apply({ toggleHotkey: [] });
				stop();
				void refreshStatus();
				return;
			}
			if (!accel) return; // a modifier on its own: keep waiting
			if (!hasModifier(accel)) {
				shown.textContent = "Add Ctrl, Alt, Shift or Win";
				return;
			}
			cats.apply({ toggleHotkey: [formatAccelerator(accel)] });
			stop();
			void refreshStatus();
		};
		button.addEventListener("click", () => {
			if (capturing) return stop();
			capturing = true;
			button.textContent = "Cancel";
			shown.textContent = "Press the new shortcut…";
			document.addEventListener("keydown", onKey, true);
		});

		show(current);
		sync.push((settings) => {
			if (!capturing) show(settings);
		});
		status.textContent = description.hotkeyError ?? "";
		status.hidden = !description.hotkeyError;
	};
	hotkeyRow();
```

- [ ] **Step 4: Type-check, lint**

Run: `npm run typecheck && npm run fix && npm run lint`
Expected: clean. If Biome complains about `??=` on array elements, rewrite as `if (catNames[k] === undefined) catNames[k] = "";` (and the same for the other two).

- [ ] **Step 5: Try it on Windows**

Run: `npm run win:dev`, open Settings from the tray.
- Each fur palette shows a walking cat beside its checkbox. Each cat block shows a preview; setting a cat to a palette changes its preview and the cat on the taskbar at once; setting it back to Auto shows the pool palette.
- Typing a name updates the block title; the caret stays put.
- Unticking Auto on size and dragging changes that one cat only.
- Set the cat count to 8 and back to 1: blocks appear and disappear; the cat 2..8 settings come back when the count goes up again.
- Hotkey: click Change, press Ctrl+Shift+F9. The row shows "Ctrl + Shift + F9" and the shortcut works. Click Change and press Escape: nothing changes. Click Change and press Backspace: "Not set", and the shortcut no longer works. Set it back to Ctrl+Alt+C.
- Minimise the window and check in Task Manager that the renderer's CPU drops to idle.

- [ ] **Step 6: Commit**

```bash
git add src/platform/win32/renderer && git commit -m "Show sprite previews, per-cat rows and the hotkey in the Windows settings"
```

### Task 8: GNOME preferences: previews, per-cat rows, hotkey row

**Files:**
- Create: `src/platform/gnome/preview.ts`
- Modify: `src/platform/gnome/prefs.ts`

**Interfaces:**
- Consumes: `previewFrames`, `PREVIEW_FRAME_MS`, `parseManifest`, `SpriteManifest` (Task 4 and existing); `resolveCatPalette` (Task 3); `CAT_SIZE_MIN`, `CAT_SIZE_MAX`, `CAT_SIZES_KEY`, `HOTKEY_KEY`, `STRING_LIST_SETTINGS`, `normalizeCatSizes`, `normalizeStringList` (Task 2); `parseAccelerator`, `formatAccelerator`, `hasModifier` (Task 1).
- Produces: `loadManifest(extensionPath: string): SpriteManifest | null`; `class SpritePreview { readonly widget: Gtk.Picture; constructor(spriteRoot: string, manifest: SpriteManifest, size?: number); setPalette(palette: string): void }`.

Prefs run in a plain GTK4 process, not inside the shell: no St, no Clutter, no `Main`. There are no unit tests for prefs; verify with `npm run dev` (nested shell) or `npm run ext:install` then `npm run ext:prefs` on a GNOME machine. If no GNOME machine is available, get the code type-checking and ask the user to try it.

- [ ] **Step 1: Write `preview.ts`**

```ts
// src/platform/gnome/preview.ts
import Gdk from "gi://Gdk";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";

import {
	PREVIEW_FRAME_MS,
	parseManifest,
	previewFrames,
	type SpriteManifest,
} from "../../core/sprites.js";

/** The manifest, read from the installed extension; null (and logged) if unreadable. */
export function loadManifest(extensionPath: string): SpriteManifest | null {
	const path = GLib.build_filenamev([
		extensionPath,
		"assets",
		"cats",
		"manifest.json",
	]);
	try {
		const [ok, bytes] = GLib.file_get_contents(path);
		if (!ok) throw new Error(`cannot read ${path}`);
		return parseManifest(new TextDecoder().decode(bytes), path);
	} catch (e) {
		logError(e as Error, "taskbar-cats: cannot read sprite manifest");
		return null;
	}
}

/**
 * A looping cat for the preferences window.
 *
 * Runs in the prefs process, which has GTK but not the shell, so frames are
 * Gdk.Textures on a Gtk.Picture rather than St icons. The timer exists only
 * while the widget is realized: a closed window stops every preview.
 */
export class SpritePreview {
	readonly widget: Gtk.Picture;
	private readonly _root: string;
	private readonly _manifest: SpriteManifest;
	private _palette = "";
	private _frames: Gdk.Texture[] = [];
	private _index = 0;
	private _timer = 0;

	/** @param spriteRoot the directory holding `<palette>/<animation>_<n>.svg` */
	constructor(spriteRoot: string, manifest: SpriteManifest, size = 48) {
		this._root = spriteRoot;
		this._manifest = manifest;
		this.widget = new Gtk.Picture({
			width_request: size,
			height_request: size,
			can_shrink: true,
			content_fit: Gtk.ContentFit.CONTAIN,
			valign: Gtk.Align.CENTER,
		});
		this.widget.connect("realize", () => this._start());
		this.widget.connect("unrealize", () => this._stop());
	}

	setPalette(palette: string): void {
		if (palette === this._palette) return;
		this._palette = palette;
		this._index = 0;
		this._frames = previewFrames(this._manifest, palette).flatMap((relative) => {
			try {
				return [
					Gdk.Texture.new_from_filename(
						GLib.build_filenamev([this._root, relative]),
					),
				];
			} catch {
				// A missing frame is a broken install, not a reason to crash prefs.
				return [];
			}
		});
		this._show();
		this._start();
	}

	private _show(): void {
		const frame = this._frames[this._index];
		if (frame) this.widget.set_paintable(frame);
	}

	private _start(): void {
		if (this._timer || this._frames.length < 2 || !this.widget.get_realized())
			return;
		this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PREVIEW_FRAME_MS, () => {
			this._index = (this._index + 1) % this._frames.length;
			this._show();
			return GLib.SOURCE_CONTINUE;
		});
	}

	private _stop(): void {
		if (this._timer) GLib.Source.remove(this._timer);
		this._timer = 0;
	}
}
```

- [ ] **Step 2: Extend `prefs.ts` imports and the manifest lookup**

Imports:

```ts
import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { resolveCatPalette } from "../../core/colony.js";
import {
	AUTO_POSITION,
	CAT_SIZE_MAX,
	CAT_SIZE_MIN,
	CAT_SIZES_KEY,
	HOTKEY_KEY,
	normalizeCatSizes,
	normalizePositions,
	normalizeStringList,
	PALETTES_KEY,
	STRING_LIST_SETTINGS,
} from "../../core/config.js";
import {
	formatAccelerator,
	hasModifier,
	parseAccelerator,
} from "../../core/hotkey.js";
import type { SpriteManifest } from "../../core/sprites.js";
import { loadManifest, SpritePreview } from "./preview.js";
```

In `fillPreferencesWindow`, right after `const settings = this.getSettings();`:

```ts
		const manifest = loadManifest(this.path);
		const palettes = manifest?.palettes ?? [];
		const spriteRoot = GLib.build_filenamev([this.path, "assets", "cats"]);
		const preview = (): SpritePreview | null =>
			manifest ? new SpritePreview(spriteRoot, manifest, 48) : null;
```

Change the palette row call to `colony.add(this._paletteRow(settings, palettes, preview));` and add, directly after it, `page.add(this._catsGroup(settings, palettes, preview));`.

In `_paletteRow`, change the signature to
`private _paletteRow(settings: Gio.Settings, palettes: string[], preview: () => SpritePreview | null): Adw.ExpanderRow`,
delete the whole `let palettes: string[] = []; try { ... } catch { ... }` block (the manifest is loaded once now), and inside the `for (const name of palettes)` loop, after the row is created:

```ts
			const picture = preview();
			if (picture) {
				picture.setPalette(name);
				row.add_prefix(picture.widget);
			}
```

- [ ] **Step 3: Add the per-cat group to `prefs.ts`**

Add this method to the class:

```ts
	/**
	 * One expander per cat, following the cat count: a name, a palette, a size
	 * with an Auto switch, and a preview of what the cat will wear. Entries
	 * beyond the current count are kept in the arrays so a cat that comes back
	 * gets its old settings.
	 */
	private _catsGroup(
		settings: Gio.Settings,
		palettes: string[],
		preview: () => SpritePreview | null,
	): Adw.PreferencesGroup {
		const group = new Adw.PreferencesGroup({
			title: "Each cat",
			description: "Auto follows the fur palettes and the cat size above.",
		});

		const names = (): string[] =>
			normalizeStringList(settings.get_strv(STRING_LIST_SETTINGS.catNames.key));
		const catPalettes = (): string[] =>
			normalizeStringList(
				settings.get_strv(STRING_LIST_SETTINGS.catPalettes.key),
			);
		const sizes = (): number[] =>
			normalizeCatSizes(settings.get_value(CAT_SIZES_KEY).deepUnpack());

		interface CatRow {
			row: Adw.ExpanderRow;
			name: Adw.EntryRow;
			palette: Adw.ComboRow;
			size: Gtk.SpinButton;
			auto: Gtk.Switch;
			picture: SpritePreview | null;
		}
		const rows: CatRow[] = [];
		let rebuilding = false;

		const commit = (): void => {
			if (rebuilding) return;
			const n = names();
			const p = catPalettes();
			const s = sizes();
			rows.forEach((r, i) => {
				n[i] = r.name.text ?? "";
				p[i] = r.palette.selected > 0 ? palettes[r.palette.selected - 1] : "";
				s[i] = r.auto.active ? 0 : Math.round(r.size.value);
			});
			for (let k = 0; k < rows.length; k++) {
				if (n[k] === undefined) n[k] = "";
				if (p[k] === undefined) p[k] = "";
				if (s[k] === undefined) s[k] = 0;
			}
			settings.set_strv(STRING_LIST_SETTINGS.catNames.key, n);
			settings.set_strv(STRING_LIST_SETTINGS.catPalettes.key, p);
			settings.set_value(CAT_SIZES_KEY, new GLib.Variant("ai", s));
		};

		const refreshPreviews = (): void => {
			const view = {
				palettes: settings.get_strv(PALETTES_KEY),
				catPalettes: catPalettes(),
			};
			rows.forEach((r, i) => {
				r.picture?.setPalette(resolveCatPalette(view, i, palettes));
			});
		};

		const rebuild = (): void => {
			rebuilding = true;
			for (const { row } of rows) group.remove(row);
			rows.length = 0;
			const n = names();
			const p = catPalettes();
			const s = sizes();
			const count = settings.get_int("cat-count");
			for (let i = 0; i < count; i++) {
				const row = new Adw.ExpanderRow({ title: n[i] || `Cat ${i + 1}` });

				const name = new Adw.EntryRow({ title: "Name", text: n[i] ?? "" });
				name.connect("changed", () => {
					row.title = (name.text ?? "").trim() || `Cat ${i + 1}`;
					commit();
				});
				row.add_row(name);

				const palette = new Adw.ComboRow({
					title: "Fur palette",
					model: Gtk.StringList.new(["Auto", ...palettes]),
					selected: Math.max(0, palettes.indexOf(p[i] ?? "") + 1),
				});
				palette.connect("notify::selected", () => {
					commit();
					refreshPreviews();
				});
				row.add_row(palette);

				const own = s[i] ?? 0;
				const size = new Gtk.SpinButton({
					adjustment: new Gtk.Adjustment({
						lower: CAT_SIZE_MIN,
						upper: CAT_SIZE_MAX,
						step_increment: 1,
						page_increment: 8,
						value: own || 48,
					}),
					numeric: true,
					valign: Gtk.Align.CENTER,
					sensitive: own !== 0,
				});
				const auto = new Gtk.Switch({
					active: own === 0,
					valign: Gtk.Align.CENTER,
				});
				const autoBox = new Gtk.Box({
					spacing: 8,
					valign: Gtk.Align.CENTER,
					margin_start: 12,
				});
				autoBox.append(new Gtk.Label({ label: "Auto" }));
				autoBox.append(auto);
				const sizeRow = new Adw.ActionRow({
					title: "Size",
					subtitle: "In pixels.",
					activatable_widget: size,
				});
				sizeRow.add_suffix(size);
				sizeRow.add_suffix(autoBox);
				size.connect("value-changed", commit);
				auto.connect("notify::active", () => {
					size.sensitive = !auto.active;
					commit();
				});
				row.add_row(sizeRow);

				const picture = preview();
				if (picture) row.add_prefix(picture.widget);

				rows.push({ row, name, palette, size, auto, picture });
				group.add(row);
			}
			rebuilding = false;
			refreshPreviews();
		};

		rebuild();
		settings.connect("changed::cat-count", rebuild);
		settings.connect(`changed::${PALETTES_KEY}`, refreshPreviews);
		return group;
	}
```

- [ ] **Step 4: Add the hotkey row to `prefs.ts`**

In `fillPreferencesWindow`, in the `Behaviour` group after the `sleep-after` spin row:

```ts
		behaviour.add(this._hotkeyRow(settings, window));
```

Add the method:

```ts
	/**
	 * The hide/show shortcut: a label showing the current one and a button
	 * that opens a small window waiting for the next key press. Escape keeps
	 * the old shortcut, Backspace removes it, and a key without a modifier is
	 * refused because GNOME would grab it from every application.
	 */
	private _hotkeyRow(
		settings: Gio.Settings,
		parent: Gtk.Window,
	): Adw.ActionRow {
		const row = new Adw.ActionRow({
			title: "Hide or show the cats",
			subtitle: "A keyboard shortcut that works in any program.",
		});
		const label = new Gtk.ShortcutLabel({
			accelerator: settings.get_strv(HOTKEY_KEY)[0] ?? "",
			disabled_text: "Not set",
			valign: Gtk.Align.CENTER,
		});
		const button = new Gtk.Button({
			label: "Change…",
			valign: Gtk.Align.CENTER,
		});
		row.add_suffix(label);
		row.add_suffix(button);
		row.activatable_widget = button;

		settings.connect(`changed::${HOTKEY_KEY}`, () => {
			label.accelerator = settings.get_strv(HOTKEY_KEY)[0] ?? "";
		});

		button.connect("clicked", () => {
			const dialog = new Gtk.Window({
				transient_for: parent,
				modal: true,
				title: "Hide or show the cats",
				default_width: 380,
				resizable: false,
			});
			const box = new Gtk.Box({
				orientation: Gtk.Orientation.VERTICAL,
				spacing: 8,
				margin_top: 24,
				margin_bottom: 24,
				margin_start: 24,
				margin_end: 24,
			});
			box.append(
				new Gtk.Label({ label: "Press the new shortcut.", css_classes: ["title-3"] }),
			);
			const hint = new Gtk.Label({
				label: "Escape keeps the old one. Backspace removes it.",
				css_classes: ["dim-label"],
				wrap: true,
			});
			box.append(hint);
			dialog.set_child(box);

			const keys = new Gtk.EventControllerKey();
			keys.connect("key-pressed", (_controller, keyval, _keycode, state) => {
				const mods = state & Gtk.accelerator_get_default_mod_mask();
				if (keyval === Gdk.KEY_Escape && !mods) {
					dialog.close();
					return Gdk.EVENT_STOP;
				}
				if (keyval === Gdk.KEY_BackSpace && !mods) {
					settings.set_strv(HOTKEY_KEY, []);
					dialog.close();
					return Gdk.EVENT_STOP;
				}
				// A modifier on its own names a key ("Control_L") that is not in
				// the table, so parse returns null and we keep waiting.
				const accel = parseAccelerator(Gtk.accelerator_name(keyval, mods));
				if (!accel) return Gdk.EVENT_STOP;
				if (!hasModifier(accel)) {
					hint.label = "Add Ctrl, Alt, Shift or Super.";
					return Gdk.EVENT_STOP;
				}
				settings.set_strv(HOTKEY_KEY, [formatAccelerator(accel)]);
				dialog.close();
				return Gdk.EVENT_STOP;
			});
			dialog.add_controller(keys);
			dialog.present();
		});
		return row;
	}
```

- [ ] **Step 5: Type-check, format, lint**

Run: `npm run typecheck && npm run fix && npm run lint`
Expected: clean. If `Gtk.StringList.new` is not in the typings, use `new Gtk.StringList({ strings: ["Auto", ...palettes] })`. If `Gdk.EVENT_STOP` is missing, return `true`.

- [ ] **Step 6: Try it in a nested shell (GNOME machine)**

Run: `npm run dev`. In the nested shell run the prefs (`gnome-extensions prefs taskbar-cats@patrikschweika.github.io` inside it). Check: previews animate beside each palette and each cat; a cat set to a palette changes coat live; a per-cat size applies; Change… records Ctrl+Shift+F9 and the shortcut hides and shows the cats; Backspace clears it; the label follows. Close prefs: no warnings in `npm run logs` about leaked sources.

If no GNOME machine is available, note that in the commit message body and ask the user to test.

- [ ] **Step 7: Commit**

```bash
git add src/platform/gnome/preview.ts src/platform/gnome/prefs.ts && git commit -m "Show sprite previews, per-cat rows and the hotkey in the GNOME prefs"
```

### Task 9: Documentation and the full check

**Files:**
- Modify: `README.md` (the Settings table)
- Modify: `docs/windows.md`

- [ ] **Step 1: Extend the README settings table**

Add these rows after the `Fur palettes` row:

```markdown
| Each cat: name | Cat N | A label for the settings only |
| Each cat: fur palette | Auto | This cat's palette. Auto takes its turn through the fur palettes above |
| Each cat: size | Auto | This cat's size in pixels (16 to 128). Auto uses the cat size above |
```

and after the `Nap after` row:

```markdown
| Hide or show the cats | Ctrl+Alt+C | A keyboard shortcut that hides every cat and brings them back. Works in any program. Clear it to turn it off |
```

Add a sentence under the table:

```markdown
The settings show a small animated preview of every fur palette, and of what
each cat will wear.
```

- [ ] **Step 2: Extend `docs/windows.md`**

In the "What is different" table, add a row:

```markdown
| Hide/show shortcut | GNOME's keybinding, works in the overview too | Electron global shortcut. If another program already owns the combination, the settings window says so |
```

After the sentence "After installing, right-click the cat icon in the notification area for settings, autostart, updates, and quit." add:

```markdown
The tray menu also has **Hide cats**, which does the same as the keyboard
shortcut (Ctrl+Alt+C unless you change it in the settings).
```

- [ ] **Step 3: Run the full check**

Run: `npm run check`
Expected: Biome clean, `node tools/cli.ts check` (which includes the typecheck and, on a machine with glib, the schema compile) clean, all tests pass.

If `glib-compile-schemas` is available, also run `npm run validate` and confirm `schema: ok`. The `toggle-hotkey` default uses `&lt;` and `&gt;` entities; a strict compile rejects raw `<` inside `<default>`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/windows.md && git commit -m "Document per-cat settings, previews and the hide shortcut"
```

- [ ] **Step 5: Final manual pass on Windows**

Run `npm run win:dev` once more and walk through: default install (no settings file) shows three cats and Ctrl+Alt+C works; the settings window opens with previews; quit from the tray leaves no process behind.

---

## Self-review notes

- Spec section 1 (storage, resolution, UI) is covered by Tasks 2, 3, 7, 8.
- Spec section 2 (previews on both platforms, fixed 8 fps, pause when hidden) is covered by Tasks 4, 7, 8.
- Spec section 3 (hotkey storage, core conversions, GNOME keybinding, Electron shortcut, tray item, error surfacing, capture UI) is covered by Tasks 1, 2, 5, 6, 7, 8.
- Spec section 5 testing: unit tests in Tasks 1 to 6; manual checks in Tasks 6, 7, 8, 9.
- Names used across tasks: `resolveCatPalette`, `resolveCatSize`, `previewFrames`, `PREVIEW_FRAME_MS`, `STRING_LIST_SETTINGS`, `CAT_SIZES_KEY`, `CAT_SIZE_MIN`, `CAT_SIZE_MAX`, `HOTKEY_KEY`, `DEFAULT_HOTKEY`, `normalizeStringList`, `normalizeCatSizes`, `normalizeHotkey`, `CHANNELS.visible`, `SettingsDescription.hotkeyError`, `SpritePreview.setPalette`, `Main.wm.__press`.


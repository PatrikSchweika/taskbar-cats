# Playful Cats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cats chase, tussle with and groom each other; food bowls and hunger; a name tag over a hovered cat; petting by rubbing the pointer over a cat.

**Architecture:** Every behaviour lives in `src/core/`, so both platforms get it. A gesture detector (`rub.ts`), a hover tag controller (`nameTag.ts`) and a play coordinator (`social.ts`) are new core modules that the `Colony` drives each tick. `Cat` gains four states and a fixed priority order. Bowls are a third `Prop` kind. The only new platform work is a `LabelView` (an `St.Label` on GNOME, a `<div>` on Windows), plus settings rows. The overlay stays click-through. Every interaction comes from the pointer position the colony already receives.

**Tech Stack:** TypeScript on Node 22 (`node --test` with native type stripping), GJS/St and libadwaita on GNOME, Electron 44 on Windows, Biome.

**Spec:** `docs/superpowers/specs/2026-11-16-playful-cats-design.md`

## Global Constraints

- Node `>=22.22.2`. Run one test file with `node --import ./tests/support/hooks.ts --test <file>`. Run everything with `npm run check` (Biome with warnings as errors, `node tools/cli.ts check`, then all tests).
- Format with Biome (tabs). Run `npm run fix` before every commit.
- Imports between source files end in `.js`. Tests import sources with `.ts`.
- Every GSettings key in the schema must appear in the core tables. `tests/core/config.test.ts` fails otherwise.
- Nothing new may be reactive or catch input. GNOME actors use `reactive: false`. Windows elements use `pointer-events: none`.
- User-written names are plain text everywhere: GNOME `St.Label.text` (never markup), Windows `textContent` (never `innerHTML`).
- Positions and sizes inside the simulation are in the positioning space (`cat.size`, not `cat.iconSize`). The pointer arrives in the same space on both platforms.
- The Electron binary isn't installed on the development machine. Windows renderer code is checked by `npm run typecheck` and CI, not by running it.
- Commit messages follow the repository style: one imperative sentence, no prefix (for example "Let cats purr when petted"). End each one with the `Co-Authored-By` line required for this session.
- Values that the spec pins (copy them exactly): tag delay 0.4 s, linger 0.8 s, gap 2 px, max 24 characters. Rub: 3 reversals, within 1.2 s, strokes of at least 0.15 sizes. Purr linger 1.5 s. Play rate 0.04/s, range 4 sizes, rest 15 s. Game odds chase 0.4, tussle 0.35, groom 0.25. Durations chase 4–7 s, tussle 2.5–4 s, groom 4–6 s. Tag reach 0.4 sizes, tag pause 1 s. Tussle reach 0.7. Groom gap 0.6. Flee speed 0.8. Bowl 3 portions, eat 4 s, stance 0.45 sizes. Ask 8 s, ask cooldown 60 s. Heart colour `#e5484d`. Windows name-tag room 24 px.

## Review Focus

1. **A cat removed from the settings while it is tagged, playing or eating.** Expected: the tag hides, the game ends for its partner, and the bowl is free for others. Tests: Task 5 "hides the tag when its cat is gone", Task 8 "frees the bowl when a cat is removed", Task 9 "ends a game whose cat is gone".
2. **Moving the pointer across the taskbar normally.** A single sweep over a cat or a bowl must not count as petting or refilling. Test: Task 3 "a single sweep across the target is not a rub".
3. **Long or odd names** (40 characters, `<b>&amp;</b>`). Expected: the tag shows the text literally, cut to 24 characters plus "…". Tests: Task 5 "cuts long names" and "shows markup literally", Task 6 GNOME label test.
4. **A 2× HiDPI display.** Hover squares and stroke lengths must use the on-screen size, so hovering at the cat's visible top still counts. Test: Task 4 "finds a cat at 2x by its on-screen square".
5. **The bowl count lowered during a meal.** The props are rebuilt and the eating cat holds a destroyed bowl. Expected: the meal ends, nothing is eaten, and there is no throw. Test: Task 8 "abandons a meal when its bowl is removed".

---

### Task 1: Sprite frames for purr, groom, play, eat and the bowl

**Files:**
- Modify: `tools/gen-sprites.ts` (`Cell`, `ORDER`, `Pose`, `drawSitting`, `POSES`, `PROP_PALETTES`, `PROP_PLANS`, `PROP_POSES`, `toSvg`)
- Regenerate: `src/assets/cats/**` (via `npm run sprites`)
- Test: `tests/tools/gen-sprites.test.ts`, `tests/assets.test.ts`

**Interfaces:**
- Produces: cat animations `purr` (2 frames), `groom` (2), `play` (3), `eat` (2), and prop `bowl` (3 frames: frame 0 empty, 1 low, 2 full) in `src/assets/cats/manifest.json`. Later tasks refer to them by these exact names.

- [ ] **Step 1: Write the failing tests**

In `tests/tools/gen-sprites.test.ts`, import `buildFrame`, `buildPropFrame` and `PALETTES` from `../../tools/gen-sprites.ts`:

```ts
const cells = (c: { g: string[][] }) => new Set(c.g.flat());

describe("new art", () => {
	it("draws a heart in the purr pose, in its own colour cell", () => {
		const c = buildFrame(PALETTES.black, "sit", { eye: "closed", heart: 0 });
		assert.ok(cells(c).has("H"));
	});
	it("draws no heart unless asked", () => {
		const c = buildFrame(PALETTES.black, "sit", {});
		assert.ok(!cells(c).has("H"));
	});
	it("fills the bowl with kibble only when it has food", () => {
		assert.ok(!cells(buildPropFrame("bowl", { fill: 0 })).has("P"));
		assert.ok(cells(buildPropFrame("bowl", { fill: 2 })).has("P"));
	});
});
```

In `tests/assets.test.ts`, extend "has the furniture and the mouse the simulation asks for":

```ts
assert.equal(manifest.props.bowl, 3, "empty, low, full");
assert.equal(manifest.animations.purr, 2);
assert.equal(manifest.animations.groom, 2);
assert.equal(manifest.animations.play, 3);
assert.equal(manifest.animations.eat, 2);
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/tools/gen-sprites.test.ts tests/assets.test.ts`
Expected: FAIL. The `heart` and `fill` pose fields don't exist, and `bowl` and `purr` aren't in the manifest.

- [ ] **Step 3: Add the heart cell and pose fields**

- `Cell` gains `"H"`, and `ORDER` gets `"H"` appended last.
- In `toSvg`, colour an `H` run with `const HEART_COLOUR = "#e5484d"`, whatever the palette.
- `Pose` gains `heart?: number` (how many pixels the heart has risen; leave it undefined for no heart) and `fill?: number` (0–2, bowls only).
- `drawSitting` draws the heart last, when `p.heart !== undefined`. It is a 5×4 shape with its top-left at `(25, 3 - p.heart)`:

```
.H.H.
HHHHH
.HHH.
..H..
```

- [ ] **Step 4: Add the poses**

Add these to `POSES`:

```ts
purr: ["sit", [
	{ eye: "closed", earPerk: 0.5, tailAngle: 120, tailCurl: 1.3, heart: 0 },
	{ eye: "closed", earPerk: 0.5, tailAngle: 114, tailCurl: 1.4, headDy: 0.4, heart: 1 },
]],
groom: ["sit", [
	{ eye: "half", headDx: -1.2, headDy: 2.2, lookUp: -0.6, earPerk: 0.4, tailAngle: 124 },
	{ eye: "closed", headDx: -1.0, headDy: 2.8, lookUp: -0.8, earPerk: 0.4, tailAngle: 118 },
]],
play: ["scratch", [{ reach: 0.2 }, { reach: 0.9 }, { reach: 0.5 }]],
eat: ["quad", [
	{ phase: 0, swing: 0, crouch: 0.6, headDy: 4.0, lookUp: -0.8, earPerk: 0.3, tailAngle: 112 },
	{ phase: 0, swing: 0, crouch: 0.6, headDy: 4.8, lookUp: -0.8, earPerk: 0.3, tailAngle: 108 },
]],
```

If the generator's `checkFrame` reports a clipped edge, reduce `headDy` (eat) or move the heart one column left. Keep both the frame counts and the frame order.

- [ ] **Step 5: Add the bowl prop**

- `PROP_PALETTES.bowl`: `{ B: "#4f7fbf", D: "#335a8c", L: "#9cc0ea", K: "#1f3350", E: "#000000", P: "#a5672f", W: "#ffffff" }`.
- `drawBowl(c, p)`:
  - The dish is a `B` ellipse about 14 px wide, centred at x 16.
  - Its base is a `D` rect that reaches row 31.
  - Its rim is an `L` ellipse.
  - For `fill >= 1`, draw a mound of kibble with `P` cells in the dish. It is taller at `fill` 2. Frame 0 has no `P` at all.
- Register it in `PROP_PLANS`, and set `PROP_POSES.bowl = [{ fill: 0 }, { fill: 1 }, { fill: 2 }]`.

- [ ] **Step 6: Regenerate and run the tests**

Run: `npm run sprites && node --import ./tests/support/hooks.ts --test tests/tools/gen-sprites.test.ts tests/assets.test.ts`
Expected: PASS. The manifest lists `eat`, `groom`, `play` and `purr`, and the props include `bowl: 3`. Open `src/assets/cats/black/purr_0.svg` and `props/bowl_2.svg` in an image viewer and check by eye that they look right.

- [ ] **Step 7: Commit**

```bash
npm run fix
git add tools/gen-sprites.ts src/assets/cats tests/tools/gen-sprites.test.ts tests/assets.test.ts
git commit -m "Draw purring, grooming, play-fighting and eating cats, and a food bowl"
```

---

### Task 2: The four new settings in core and the schema

**Files:**
- Modify: `src/core/config.ts`, `src/core/cat.ts` (`CatConfig` only), `src/schemas/org.gnome.shell.extensions.taskbar-cats.gschema.xml`, `tests/support/core/harness.ts` (`DEFAULT_CFG`)
- Test: `tests/core/config.test.ts`

**Interfaces:**
- Produces:
  - `CatConfig.hungerAfter: number` (seconds).
  - `Settings.social: boolean`, `Settings.nameTags: boolean`, `Settings.bowls: number`.
  - `INT_SETTINGS.bowls = { key: "bowl-count", default: 0, min: 0, max: 8 }`, inserted right after `scratchers`.
  - `INT_SETTINGS.hungerAfter = { key: "hunger-after", default: 1800, min: 60, max: 14400 }`, inserted right after `bowls`.
  - `BOOL_SETTINGS.social = { key: "cats-play", default: true }`.
  - `BOOL_SETTINGS.nameTags = { key: "name-tags", default: true }`.

- [ ] **Step 1: Write the failing tests** in `tests/core/config.test.ts`

```ts
it("defaults the play, tag, bowl and hunger settings", () => {
	const s = defaultSettings();
	assert.equal(s.social, true);
	assert.equal(s.nameTags, true);
	assert.equal(s.bowls, 0);
	assert.equal(s.hungerAfter, 1800);
});

it("clamps hunger-after and bowl-count from a hand-edited file", () => {
	const s = normalizeSettings({ "hunger-after": 5, "bowl-count": 99, "cats-play": "yes" });
	assert.equal(s.hungerAfter, 60);
	assert.equal(s.bowls, 8);
	assert.equal(s.social, true, "a non-boolean keeps the default");
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/core/config.test.ts`
Expected: FAIL. The properties are undefined.

- [ ] **Step 3: Implement the tables, the interface fields and the schema keys**

- Add the four entries to the core tables, and the fields to `Settings` and `CatConfig`.
- Add `hungerAfter: 1800` to `DEFAULT_CFG` in the harness.
- Change the `catNames` doc comment to: "Display name per cat, shown in the settings and on the cat's name tag. "" means "Cat N"."
- Add these schema keys:

```xml
<key name="bowl-count" type="i">
  <default>0</default>
  <range min="0" max="8"/>
  <summary>Food bowls</summary>
  <description>Bowls on the floor beside the dock. Hungry cats eat from them. Rub the pointer over an empty bowl to fill it.</description>
</key>
<key name="hunger-after" type="i">
  <default>1800</default>
  <range min="60" max="14400"/>
  <summary>Hungry after</summary>
  <description>Seconds after a meal before a cat is hungry again. Only matters when there are bowls.</description>
</key>
<key name="cats-play" type="b">
  <default>true</default>
  <summary>Cats play together</summary>
  <description>Idle cats sometimes chase, play-fight or groom each other.</description>
</key>
<key name="name-tags" type="b">
  <default>true</default>
  <summary>Show names on hover</summary>
  <description>Hold the pointer over a cat to see its name.</description>
</key>
```

- Change the `cat-names` description to: `One entry per cat, shown in the settings and on the cat's name tag. Empty or missing means "Cat N".`

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `node --import ./tests/support/hooks.ts --test tests/core/config.test.ts && npm run typecheck`
Expected: PASS. The existing schema-drift test also passes.

- [ ] **Step 5: Commit**

```bash
npm run fix
git add src/core/config.ts src/core/cat.ts src/schemas tests/support/core/harness.ts tests/core/config.test.ts
git commit -m "Add settings for play, name tags, food bowls and hunger"
```

---

### Task 3: The rub gesture detector

**Files:**
- Create: `src/core/rub.ts`
- Test: `tests/core/rub.test.ts`

**Interfaces:**
- Produces:
  - `RUB_REVERSALS = 3`, `RUB_WINDOW = 1.2`, `RUB_MIN_STROKE = 0.15`.
  - `class RubDetector { update(dt: number, x: number, target: object | null, size: number): void; get rubbing(): object | null; reset(): void }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { RubDetector } from "../../src/core/rub.ts";

/** Feed the detector one x per 1/30 s tick, all over `target`. */
function feed(d: RubDetector, target: object | null, xs: number[], size = 48): void {
	for (const x of xs) d.update(1 / 30, x, target, size);
}
/** Back and forth between a and b, `strokes` times, 6 ticks per stroke. */
function rub(a: number, b: number, strokes: number): number[] {
	const out: number[] = [];
	for (let s = 0; s < strokes; s++)
		for (let i = 1; i <= 6; i++) {
			const t = i / 6;
			out.push(s % 2 === 0 ? a + (b - a) * t : b + (a - b) * t);
		}
	return out;
}

describe("RubDetector", () => {
	const cat = {};
	it("recognises three direction changes over one target within 1.2 s", () => {
		const d = new RubDetector();
		feed(d, cat, rub(100, 120, 4)); // 4 strokes = 3 reversals, 0.8 s
		assert.equal(d.rubbing, cat);
	});
	it("a single sweep across the target is not a rub", () => {
		const d = new RubDetector();
		feed(d, cat, Array.from({ length: 30 }, (_, i) => 80 + i * 2));
		assert.equal(d.rubbing, null);
	});
	it("ignores strokes shorter than 15% of the target's size", () => {
		const d = new RubDetector();
		feed(d, cat, rub(100, 106, 8), 48); // 6 px < 7.2 px
		assert.equal(d.rubbing, null);
	});
	it("does not count reversals spread over more than 1.2 s", () => {
		const d = new RubDetector();
		// Each stroke takes 0.8 s, so the three reversals span ~1.6 s.
		const slow = rub(100, 120, 4).flatMap((x) => [x, x, x, x]);
		feed(d, cat, slow);
		assert.equal(d.rubbing, null);
	});
	it("starts over when the pointer moves to another target", () => {
		const d = new RubDetector();
		feed(d, cat, rub(100, 120, 3));
		feed(d, {}, rub(120, 100, 2));
		assert.equal(d.rubbing, null);
	});
	it("keeps rubbing while strokes continue and stops 1.2 s after the last", () => {
		const d = new RubDetector();
		feed(d, cat, rub(100, 120, 8));
		assert.equal(d.rubbing, cat);
		// The last reversal came ~0.1–0.2 s before the final stroke ended.
		feed(d, cat, Array(20).fill(100)); // +0.67 s: still within 1.2 s
		assert.equal(d.rubbing, cat);
		feed(d, cat, Array(30).fill(100)); // +1.0 s more: well past it
		assert.equal(d.rubbing, null);
	});
	it("forgets everything when the pointer leaves every target", () => {
		const d = new RubDetector();
		feed(d, cat, rub(100, 120, 4));
		d.update(1 / 30, 500, null, 48);
		assert.equal(d.rubbing, null);
	});
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/core/rub.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `RubDetector` in `src/core/rub.ts`**

The algorithm:
- Keep an internal clock (`dt` summed), the current target, the extreme x of the current stroke, the stroke direction (−1, 0 or +1), and the times of recent reversals.
- **On a target change** (including to null): forget everything. The detector stops rubbing.
- **Moving in the current direction** (or with no direction yet): push the extreme further. With no direction yet, the first movement past the minimum stroke sets the direction.
- **Moving back** at least `RUB_MIN_STROKE * size` from the extreme: record a reversal at the current time, flip the direction, and make the current x the new extreme.
- Drop reversals older than `RUB_WINDOW`.
- `rubbing` becomes the target once there are at least `RUB_REVERSALS` recent reversals. It stays the target until there are none left in the window, or the target changes.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `node --import ./tests/support/hooks.ts --test tests/core/rub.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
npm run fix
git add src/core/rub.ts tests/core/rub.test.ts
git commit -m "Recognise the pointer rubbing back and forth over something"
```

---

### Task 4: Hover and petting

**Files:**
- Modify: `src/core/cat.ts`, `src/core/colony.ts`
- Test: `tests/core/cat.test.ts`, `tests/core/colony.test.ts`

**Interfaces:**
- Consumes: `RubDetector` (Task 3). The `purr` animation (Task 1).
- Produces:
  - `State.PURR = "purr"`, with `FRAME_RATE_SCALE[PURR] = 0.3`.
  - `export const PET_LINGER = 1.5`.
  - `Cat.hovered: boolean` (a public field the colony sets before each update).
  - `Cat.pet(): void` and `get petted(): boolean`.
  - `export function catUnderPointer(cats: readonly Cat[], pointer: { x: number; y: number }, floorY: number): Cat | null` in `colony.ts`.
  - `Colony` owns a private `RubDetector` and runs it each tick on the cat under the pointer.

- [ ] **Step 1: Write the failing tests**

In `tests/core/cat.test.ts`:

```ts
describe("petting", () => {
	it("purrs and holds still while petted", () => {
		const cat = makeCat({ x: 400 });
		const ctx = makeContext();
		for (let t = 0; t < 1; t += 1 / 30) { cat.pet(); cat.update(1 / 30, ctx); }
		assert.equal(cat.state, State.PURR);
		assert.equal(shownAnimation(cat), "purr");
		assert.ok(Math.abs(cat.x - 400) < 1);
	});
	it("keeps purring 1.5 s after the last stroke, then carries on", () => {
		const cat = makeCat();
		cat.pet();
		run([cat], makeContext(), 1.4);
		assert.equal(cat.state, State.PURR);
		run([cat], makeContext(), 0.2);
		assert.notEqual(cat.state, State.PURR);
	});
	it("ignores petting while a mouse is out", () => {
		const cat = makeCat({ x: 400 });
		const ctx = makeContext({ mouse: makeMouse(900) });
		cat.pet();
		run([cat], ctx, 0.3);
		assert.notEqual(cat.state, State.PURR);
	});
});

describe("hover", () => {
	it("holds still and looks up while the pointer is over it", () => {
		// Pointer right on the cat, near the floor: without hover the fan-out
		// would walk cat 0 of 3 to a slot beside the pointer.
		const cats = [0, 1, 2].map((i) => makeCat({ x: 400 + i * 200, index: i }));
		const ctx = makeContext({ neighbours: cats, pointer: { x: 400, y: 880, idleTime: 0 } });
		cats[0].hovered = true;
		run(cats, ctx, 1);
		assert.ok(Math.abs(cats[0].x - 400) < 1);
		assert.equal(cats[0].state, State.ALERT);
	});
});
```

In `tests/core/colony.test.ts`:

```ts
describe("catUnderPointer", () => {
	// floor 900, size 48: the square spans x 376..424 and y 852..900
	it("finds the cat whose square holds the pointer", () => { /* cats at 400 and 600; pointer (410, 870) → the first */ });
	it("returns null above the cat's head", () => { /* pointer (400, 851) → null */ });
	it("prefers the cat drawn on top when two overlap", () => { /* cats at 400 and 410; pointer (405, 880) → the second */ });
	it("finds a cat at 2x by its on-screen square", () => {
		// logical 48 at scale 2 is 96 on screen: (400, 810) is inside it.
	});
});

it("makes a cat purr when the pointer rubs it", () => {
	// colony with 1 cat at a known x (sync with bounds that put it at 600);
	// feed world.pointer back and forth ±12 px around cat.x at y = floorY - 10
	// for 1 s with update(1/30, ...); assert cats[0].state === State.PURR.
});
```

Write the bodies from the comments. Use `fakeHost`, `makeSettings({ count: N })`, `makeWorld` and `FakeCatView.scale`.

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/core/cat.test.ts tests/core/colony.test.ts`
Expected: FAIL. `pet`, `State.PURR` and `catUnderPointer` don't exist.

- [ ] **Step 3: Implement in `cat.ts`**

- `pet()` sets a private `_pettedFor = PET_LINGER`, which `update` counts down. `petted` is `_pettedFor > 0`.
- In `update`:
  - When **hunting**, a petted cat is treated as not petted.
  - When **petted**, it targets its own x, which overrides pointer interest and sleep.
  - When **hovered** (and not hunting), it also targets its own x.
- In the state machine, add two branches right after the POUNCE branch and before the `speed > 6` branch:
  - `petted` → `PURR`.
  - `hovered` → `ALERT`.
- Add `PURR` to the "no longer applies" list that drops to IDLE.
- A mouse breaks a purr at once. The `hunting` branch already wins, as long as the PURR check is skipped while hunting.

- [ ] **Step 4: Implement in `colony.ts`**

- `catUnderPointer`: return the last cat in the list whose square holds the pointer. The square spans `x − size/2` to `x + size/2` and `floorY − size` to `floorY`, inclusive.
- In `Colony.update`, before the cats update:

```ts
const hovered = catUnderPointer(this.cats, world.pointer, world.floorY);
for (const cat of this.cats) cat.hovered = cat === hovered;
this._rub.update(dt, world.pointer.x, hovered, hovered?.size ?? 0);
const rubbed = this._rub.rubbing;
if (rubbed instanceof Cat) rubbed.pet();
```

- `destroy()` calls `this._rub.reset()`.

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `node --import ./tests/support/hooks.ts --test tests/core/cat.test.ts tests/core/colony.test.ts`
Expected: PASS, including every existing test.

- [ ] **Step 6: Commit**

```bash
npm run fix
git add src/core/cat.ts src/core/colony.ts tests/core/cat.test.ts tests/core/colony.test.ts
git commit -m "Let cats hold still under the pointer and purr when petted"
```

---

### Task 5: Name tags in core

**Files:**
- Create: `src/core/nameTag.ts`
- Modify: `src/core/types.ts`, `src/core/colony.ts`, `tests/support/core/harness.ts`
- Test: `tests/core/nameTag.test.ts`, `tests/core/colony.test.ts`

**Interfaces:**
- Consumes: `Cat.hovered` / `catUnderPointer` (Task 4). `Settings.nameTags` (Task 2).
- Produces:
  - In `types.ts`: `interface LabelView { setText(text: string): void; place(centreX: number, bottomY: number): void; setVisible(visible: boolean): void; destroy(): void }`. `place` anchors the label's bottom centre.
  - `ColonyHost.createLabelView(): LabelView` (a new required member).
  - `export function resolveCatName(settings: Pick<Settings, "catNames">, index: number): string` in `colony.ts`. It returns the trimmed name, or `` `Cat ${index + 1}` `` when that is empty.
  - In `nameTag.ts`: `NAME_TAG_DELAY = 0.4`, `NAME_TAG_LINGER = 0.8`, `NAME_TAG_GAP = 2` and `NAME_TAG_MAX_CHARS = 24`, plus:
    - `function tagText(name: string): string`, which cuts the name to 24 characters plus "…".
    - `class NameTag { constructor(view: LabelView); update(dt: number, hovered: Cat | null, cats: readonly Cat[], floorY: number, settings: Pick<Settings, "nameTags" | "catNames">): void; get shownFor(): Cat | null; destroy(): void }`.
  - In the harness: `class FakeLabelView implements LabelView { text = ""; centreX = 0; bottomY = 0; visible = false; destroyed = false }`. `fakeHost()` gains `labels: FakeLabelView[]` and `createLabelView`.

- [ ] **Step 1: Write the failing tests** in `tests/core/nameTag.test.ts`

```ts
describe("tagText", () => {
	it("cuts long names", () => {
		assert.equal(tagText("x".repeat(40)), `${"x".repeat(24)}…`);
	});
	it("shows markup literally", () => {
		assert.equal(tagText("<b>&amp;</b>"), "<b>&amp;</b>");
	});
});

describe("resolveCatName", () => {
	it("uses the cat's name, trimmed, or Cat N", () => {
		const s = makeSettings({ catNames: ["  Miso ", ""] });
		assert.equal(resolveCatName(s, 0), "Miso");
		assert.equal(resolveCatName(s, 1), "Cat 2");
		assert.equal(resolveCatName(s, 4), "Cat 5");
	});
});

describe("NameTag", () => {
	// cat built as in cat.test.ts makeCat, x 400, size 48, index 0; floor 900
	it("appears after 0.4 s of hover, above the cat's head", () => {
		// update with hovered=cat for 0.37 s → view.visible false;
		// 0.06 s more → visible true, text "Cat 1", centreX 400, bottomY 900 - 48 - 2.
	});
	it("follows the cat as it moves", () => { /* move cat.x to 450, update → centreX 450 */ });
	it("lingers 0.8 s after the pointer leaves, then hides", () => { /* ... */ });
	it("moves straight to another cat while showing, without a new delay", () => { /* ... */ });
	it("stays hidden when name tags are off, and hides at once when switched off", () => { /* ... */ });
	it("hides the tag when its cat is gone", () => {
		// shown for cat A; next update with cats = [] and hovered null → visible false at once
	});
});
```

In `tests/core/colony.test.ts`:

```ts
it("shows a hovered cat's name from the settings", () => {
	// colony, 1 cat named "Miso"; pointer on it for 0.5 s → host.labels[0].text === "Miso", visible
});
it("destroys the label with the colony", () => { /* ... */ });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/core/nameTag.test.ts tests/core/colony.test.ts`
Expected: FAIL. The module, `createLabelView` and `resolveCatName` don't exist.

- [ ] **Step 3: Implement**

`NameTag.update`:
- **A hovered cat that isn't the tag's cat:** if the tag is visible, switch to the hovered cat at once. If not, count up hover time and show the tag once it reaches the delay. Hovering a different cat resets the count.
- **Nothing hovered:** count down the linger, and hide the tag when it runs out.
- **The tag's cat is not in `cats`:** hide the tag at once.
- **Settings off:** hide the tag and reset.
- **While visible**, every tick: `setText(tagText(resolveCatName(settings, cat.index)))` and `place(cat.x, floorY - cat.size - NAME_TAG_GAP)`.

`Colony` creates its `NameTag` lazily on the first `update` (`host.createLabelView()`). It calls `tag.update(dt, hovered, this.cats, world.floorY, settings)` after the cats have moved. `destroy()` destroys the tag and sets it back to null.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `node --import ./tests/support/hooks.ts --test tests/core/nameTag.test.ts tests/core/colony.test.ts && npm run typecheck`
Expected: the tests PASS. Typecheck FAILS only in the two platform hosts (`src/platform/gnome/extension.ts`, `src/platform/win32/renderer/overlay.ts`), which don't provide `createLabelView` yet. Tasks 6 and 7 fix those. Make sure no other error appears.

- [ ] **Step 5: Commit**

```bash
npm run fix
git add src/core tests/core tests/support/core/harness.ts
git commit -m "Show a hovered cat's name on a tag above it"
```

---

### Task 6: The GNOME name tag

**Files:**
- Create: `src/platform/gnome/labelView.ts`
- Modify: `src/platform/gnome/catLayer.ts`, `src/platform/gnome/extension.ts` (the `Colony` host literal), `src/stylesheet.css`, `tests/support/gnome/stubs/St.ts`
- Test: `tests/platform/gnome/labelView.test.ts`, `tests/platform/gnome/extension.test.ts`

**Interfaces:**
- Consumes: `LabelView` (Task 5).
- Produces:
  - `class GnomeLabelView implements LabelView { readonly actor: St.Label }`.
  - `CatLayer.createLabelView(): GnomeLabelView`.
  - The stub `St.Label` (a `FakeActor` subclass with `text`, `style_class` and fixed preferred sizes, set with `__setPreferredSize(w, h)` in the style of the existing stubs).

- [ ] **Step 1: Write the failing tests**

```ts
describe("GnomeLabelView", () => {
	it("is an unreactive label with the tag style", () => { /* actor.reactive === false, style_class "taskbar-cats-tag" */ });
	it("sets plain text, never markup", () => {
		// setText("<b>x</b>") → actor.text === "<b>x</b>"; actor.clutter_text.use_markup is not set to true
	});
	it("anchors its bottom centre at the given point", () => {
		// preferred size 60x18; place(400, 850) → position (370, 832)
	});
	it("raises itself above the cats when shown", () => { /* parent child order: label last after setVisible(true) */ });
});
```

In `extension.test.ts`, add "draws one name tag on the cat layer, unreactive". Enable the extension, tick with the pointer on a cat for 0.5 s, and check that the layer has a visible `St.Label` child with `reactive === false`.

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/platform/gnome/labelView.test.ts tests/platform/gnome/extension.test.ts`
Expected: FAIL. `St.Label` isn't stubbed and the module doesn't exist.

- [ ] **Step 3: Implement**

- `GnomeLabelView` builds `new St.Label({ style_class: "taskbar-cats-tag", reactive: false, can_focus: false, track_hover: false })` and starts hidden.
- `place`: `const [, w] = actor.get_preferred_width(-1); const [, h] = actor.get_preferred_height(-1); actor.set_position(Math.round(cx - w / 2), Math.round(bottom - h))`.
- `setVisible(true)`: call `show()`, then `actor.get_parent()?.set_child_above_sibling(actor, null)`.
- `CatLayer.createLabelView` adds the label with `add_child`.
- `extension.ts` passes `createLabelView: () => layer.createLabelView()`.
- Add the stylesheet rule:

```css
.taskbar-cats-tag {
	background-color: rgba(20, 20, 20, 0.8);
	color: #ffffff;
	font-size: 9pt;
	border-radius: 4px;
	padding: 1px 6px;
}
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `node --import ./tests/support/hooks.ts --test tests/platform/gnome && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Check by hand in a nested shell**

Run: `npm run dev`, then hold the pointer over a cat.
Expected: "Cat 1" appears above it after a moment, and clicks on the dock under the cat still work.

- [ ] **Step 6: Commit**

```bash
npm run fix
git add src/platform/gnome src/stylesheet.css tests/platform/gnome tests/support/gnome
git commit -m "Draw the name tag on GNOME"
```

---

### Task 7: The Windows name tag

**Files:**
- Create: `src/platform/win32/renderer/labelView.ts`, `src/platform/win32/strip.ts`
- Modify: `src/platform/win32/renderer/overlay.ts`, `src/platform/win32/renderer/overlay.html`, `src/platform/win32/main.ts` (`stripFor`, `MAX_CAT_HEIGHT`, `STRIP_SLACK`)
- Test: `tests/platform/win32/strip.test.ts`

**Interfaces:**
- Consumes: `LabelView` (Task 5), `CAT_SIZE_MAX` from core config.
- Produces:
  - `export const STRIP_SLACK = 24`, `export const NAME_TAG_ROOM = 24`.
  - `export function stripHeight(taskbarH: number, monitorH: number): number`, equal to `Math.min(monitorH, Math.round(taskbarH + CAT_SIZE_MAX + STRIP_SLACK + NAME_TAG_ROOM))`.
  - `class DomLabelView implements LabelView` (constructed with `parent: HTMLElement`).

- [ ] **Step 1: Write the failing test**

```ts
describe("stripHeight", () => {
	it("leaves room for a name tag above the largest cat", () => {
		assert.equal(stripHeight(48, 1080), 48 + 128 + 24 + 24);
	});
	it("never exceeds the monitor", () => {
		assert.equal(stripHeight(48, 150), 150);
	});
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --import ./tests/support/hooks.ts --test tests/platform/win32/strip.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement**

- `strip.ts` holds the constants and `stripHeight`.
- `main.ts`'s `stripFor` calls `stripHeight(overTaskbar, desktop.monitor.h)`. Delete the two local constants it replaces.
- `DomLabelView`:
  - A `div.tag` appended to `parent` and hidden by default.
  - `setText` assigns `textContent` (only when the text changed).
  - `place` sets `transform = translate(${x}px, ${y}px) translate(-50%, -100%)`.
  - `setVisible` toggles `hidden`.
- `overlay.html`:
  - Add `<div id="tags"></div>` after `#stage`, with `position: absolute; inset: 0; pointer-events: none`.
  - Add a `.tag` rule: `position: absolute; top: 0; left: 0; background: rgba(20, 20, 20, 0.8); color: #fff; font: 12px system-ui, sans-serif; border-radius: 4px; padding: 1px 6px; white-space: nowrap; pointer-events: none;`.
- `overlay.ts` looks up `#tags` the way it does `#stage`, and passes `createLabelView: () => new DomLabelView(tags)`.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `node --import ./tests/support/hooks.ts --test tests/platform/win32 && npm run typecheck`
Expected: PASS, with no type errors left anywhere.

- [ ] **Step 5: Commit**

```bash
npm run fix
git add src/platform/win32 tests/platform/win32
git commit -m "Draw the name tag on Windows, in a strip tall enough to hold it"
```

---

### Task 8: Food bowls and hunger

**Files:**
- Modify: `src/core/props.ts`, `src/core/cat.ts`, `src/core/colony.ts`, `src/platform/gnome/extension.ts` (`_onSettingChanged` resync list), `tests/support/core/harness.ts` (`makeContext` gains `bowls: []`)
- Test: `tests/core/props.test.ts`, `tests/core/cat.test.ts`, `tests/core/colony.test.ts`

**Interfaces:**
- Consumes: the `eat` animation and `bowl` frames (Task 1). `Settings.bowls` and `CatConfig.hungerAfter` (Task 2). `RubDetector` wiring (Task 4).
- Produces:
  - In `props.ts`:
    - `PropKind` becomes `"bed" | "scratcher" | "bowl"`.
    - `export const BOWL_PORTIONS = 3`.
    - `Prop.food: number` (starts at `BOWL_PORTIONS`) and `Prop.eater: Cat | null`.
    - `Prop.refill(): void`.
    - `get fillFrame(): number`: 0 when food is 0, 1 when food is 1, otherwise 2.
  - In `cat.ts`:
    - `State.EAT = "eat"`, with `FRAME_RATE_SCALE[EAT] = 0.6`.
    - `export const EAT_SECONDS = 4, ASK_SECONDS = 8, ASK_COOLDOWN = 60, BOWL_STANCE = 0.45`.
    - `CatContext.bowls: readonly Prop[]`.
    - `Cat.hunger: number` (starts at `Math.random() * 0.5`), `get hungry(): boolean`, `get bowl(): Prop | null`.
    - EAT counts as `rooted`.
  - In `colony.ts`:
    - `interleaveProps(beds: number, scratchers: number, bowls = 0): PropKind[]`, ordering each round as bed, scratcher, bowl.
    - `get bowls(): Prop[]`.
    - `export function bowlUnderPointer(bowls: readonly Prop[], pointer: { x: number; y: number }, floorY: number): Prop | null`, using the same square rule as cats.

- [ ] **Step 1: Write the failing tests**

`tests/core/props.test.ts`:

```ts
it("a bowl starts full and shows its fill", () => {
	const bowl = makeProp("bowl", 300);
	bowl.update(1 / 30, 900, 12, false);
	assert.equal(bowl.food, 3);
	assert.equal(shownPropFrame(bowl), 2);
	bowl.food = 1; bowl.update(1 / 30, 900, 12, false);
	assert.equal(shownPropFrame(bowl), 1);
	bowl.food = 0; bowl.update(1 / 30, 900, 12, false);
	assert.equal(shownPropFrame(bowl), 0);
});
it("refill puts back three portions", () => {
	const bowl = makeProp("bowl", 300);
	bowl.food = 0; bowl.refill();
	assert.equal(bowl.food, 3);
});
```

`tests/core/cat.test.ts`, under `describe("hunger")`, with `cfg: { ...DEFAULT_CFG, hungerAfter: 60 }`:

```ts
it("does not get hungry without bowls", () => { /* hunger 0, run 120 s with bowls [] → hunger 0 */ });
it("grows hungry over hungerAfter seconds", () => {
	// hunger = 0, bowls = [an empty bowl far away at x 1500]; run 30 s → hunger within 0.5 ± 0.02
});
it("walks to a bowl with food, eats for 4 s, and takes one portion", () => {
	// cat at 400, hunger = 1, bowl at 700 full; run until state EAT (≤ 10 s);
	// assert |cat.x - (700 ± 0.45*size)| ≤ 14 and cat facing the bowl;
	// run 4.1 s more → bowl.food 2, cat.hunger < 0.1, bowl.eater null, state not EAT
});
it("eats before napping", () => {
	// pointer idle 999 (sleepy), hunger 1, full bowl → reaches EAT, not SLEEP
});
it("only one cat eats from a bowl at a time", () => {
	// two hungry cats, one full bowl → never both in EAT on the same tick over 10 s
});
it("asks beside an empty bowl for 8 s, then leaves it alone for 60 s", () => {
	// hunger 1, empty bowl at 700; run until within reach → ALERT;
	// run 8.1 s more → no longer ALERT and target ≠ bowl stance for the next 60 s (sample every second)
});
it("drops a meal for a mouse without using the food", () => {
	// reach EAT, then ctx.mouse = makeMouse(...) → next tick not EAT, bowl.food still 3, bowl.eater null
});
it("abandons a meal when its bowl is removed", () => {
	// reach EAT, then ctx.bowls = [] → no throw, not EAT within 2 ticks, hunger still ≥ 1
});
```

`tests/core/colony.test.ts`:

```ts
it("interleaves bowls after beds and posts", () => {
	assert.deepEqual(interleaveProps(2, 1, 2), ["bed", "scratcher", "bowl", "bed", "bowl"]);
});
it("rubbing the pointer over a bowl fills it", () => { /* settings bowls: 1; empty it; rub at its x for 1 s → food 3 */ });
it("frees the bowl when a cat is removed", () => { /* cat eating; sync count down to 0 → bowl.eater null */ });
it("adds and removes bowls live", () => { /* sync bowls 2 → host.propViews has 2 bowl props; sync 0 → destroyed */ });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/core/props.test.ts tests/core/cat.test.ts tests/core/colony.test.ts`
Expected: FAIL. There is no bowl kind or hunger yet.

- [ ] **Step 3: Implement the bowl in `props.ts`**

`Prop.update` for a bowl always shows `fillFrame` and ignores `active`. `destroy()` also clears `eater`.

- [ ] **Step 4: Implement hunger in `cat.ts`**

**Bookkeeping:**
- Hunger rises by `dt / cfg.hungerAfter` per tick, only when `ctx.bowls.length > 0`.
- Like `_bed`, a claimed `_bowl` is re-checked against `ctx.bowls` each tick.
- `destroy()` releases the bowl.
- A cat is **seeking food** when it is hungry, there are bowls, it isn't hunting, petted or hovered, and its ask cooldown has run out. Seeking food outranks pointer interest and sleep (the spec's priority list).

**While seeking food:**
- Claim the nearest bowl with `food > 0` and `eater` null (or this cat), the way `_claimBed` does. If there is one:
  - Target the side of the bowl nearest the cat, at `BOWL_STANCE * size`.
  - On arrival (within `ARRIVE_PX * 2`), switch to `EAT`, facing the bowl.
  - After `EAT_SECONDS`: `food = max(0, food − 1)`, `hunger = 0`, release the bowl, and go to IDLE.
- If no bowl has food:
  - Target the stance beside the nearest bowl and show `ALERT` there.
  - After `ASK_SECONDS` there, start the `ASK_COOLDOWN`. Until it runs out, the cat behaves as if it weren't hungry.

**Interruptions:**
- When hunting starts, a cat in `EAT` goes to IDLE at once and releases the bowl without eating.
- A cat whose bowl disappears mid-meal does the same.

- [ ] **Step 5: Wire up `colony.ts`**

- `_syncProps` counts bowls too. Bowls have no position list, so `pinned` stays null.
- The context gets `bowls: this.bowls`.
- The rub target becomes `hovered ?? bowlUnderPointer(this.bowls, world.pointer, world.floorY)`, with that target's `size`.
- `if (rubbed instanceof Prop && rubbed.kind === "bowl") rubbed.refill()`.
- In `src/platform/gnome/extension.ts`, add `INT_SETTINGS.bowls.key` to the keys that trigger `_syncCats` in `_onSettingChanged`.

- [ ] **Step 6: Run the tests to make sure they pass**

Run: `node --import ./tests/support/hooks.ts --test tests/core && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npm run fix
git add src/core src/platform/gnome/extension.ts tests/core tests/support/core/harness.ts
git commit -m "Give the cats food bowls, and an appetite"
```

---

### Task 9: Play: chase, tussle and groom

**Files:**
- Create: `src/core/social.ts`
- Modify: `src/core/cat.ts`, `src/core/colony.ts`
- Test: `tests/core/social.test.ts`, `tests/core/cat.test.ts`, `tests/core/colony.test.ts`

**Interfaces:**
- Consumes: the `play` and `groom` animations (Task 1). `Settings.social` (Task 2). `Cat.hovered`, `petted` (Task 4) and `hungry` (Task 8).
- Produces:
  - In `social.ts`:
    - `type GameKind = "chase" | "tussle" | "groom"`.
    - `interface PlayRole { kind: GameKind; partner: Cat; lead: boolean }`.
    - `interface Game { kind: GameKind; a: Cat; b: Cat; left: number; tagPause: number }`.
    - `PLAY_RATE = 0.04`, `PLAY_RANGE = 4`, `PLAY_REST = 15`, `TAG_REACH = 0.4`, `TAG_PAUSE = 1`.
    - `GAME_ODDS: Record<GameKind, number> = { chase: 0.4, tussle: 0.35, groom: 0.25 }`.
    - `GAME_SECONDS: Record<GameKind, [number, number]> = { chase: [4, 7], tussle: [2.5, 4], groom: [4, 6] }`.
    - `class Playground { readonly games: Game[]; update(dt: number, cats: readonly Cat[], enabled: boolean): void; clear(): void }`.
  - In `cat.ts`:
    - `State.PLAY = "play"` and `State.GROOM = "groom"`, with `FRAME_RATE_SCALE` 1.2 and 0.5.
    - `export const TUSSLE_REACH = 0.7, GROOM_GAP = 0.6, FLEE_SPEED = 0.8`.
    - `Cat.play: PlayRole | null` (set only by `Playground`).
    - `get interrupted(): boolean` is true when the last tick had a mouse, petting, hover, food seeking, pointer interest or sleepiness.
    - `get free(): boolean` is `!interrupted && play === null` with the state in IDLE, SIT or WALK.
    - PLAY and GROOM count as `rooted`.

- [ ] **Step 1: Write the failing tests**

`tests/core/social.test.ts`. Build real cats with the `makeCat` pattern, and let them update once (`run(cats, makeContext({ neighbours: cats }), 0.1)`) so that `free` is meaningful.

`Playground.update` consumes `Math.random` in this order, which makes `withRandom` tests deterministic:
1. the start roll (`< PLAY_RATE * dt` starts a game);
2. the pick of the first cat among the free, rested cats (`Math.floor(r * n)`);
3. the pick of the partner among the first cat's free, rested cats within range;
4. the kind, walking `GAME_ODDS` in the order chase, tussle, groom;
5. the duration within that kind's range (`min + r * (max − min)`).

```ts
it("starts no game when play is off", () => { /* withRandom([0]) update(1/30, cats, false) → games empty */ });
it("pairs two free cats within four sizes", () => {
	// cats at 400 and 500 (size 48); withRandom([0, 0, 0, 0, 0.5]) → one chase game,
	// left 5.5, a.play = { kind: "chase", partner: b, lead: true }, b.play.lead false
});
it("never pairs cats more than four sizes apart", () => { /* cats at 400 and 700 → no game */ });
it("picks tussle and groom by the odds", () => { /* kind roll 0.5 → tussle; 0.9 → groom */ });
it("ends the game when either cat is interrupted, and rests both for 15 s", () => {
	// start a game; set b.hovered = true; run one tick; update → games empty, both play null;
	// clear hover; withRandom([0, 0, 0, 0, 0]) for 14.9 s of updates → no game; after 15 s → a game
});
it("ends a game whose cat is gone", () => { /* update with cats = [a] → games empty, a.play null */ });
it("swaps chase roles on a tag, at most once a second", () => { /* place b within 0.4 sizes of a … */ });
it("ends every game when switched off", () => { /* … */ });
```

`tests/core/cat.test.ts`, under `describe("play")`. Set `play` by hand, mirroring the roles:

```ts
it("chases its partner at a run", () => { /* lead at 400, partner at 600 (follow) → lead.state RUN within 0.5 s, moving right */ });
it("flees its chaser and dashes past when cornered at an edge", () => {
	// follow at roam.min + size, lead to its right → follow ends up on the lead's right within 3 s
});
it("tussles: both rear up facing each other once close", () => { /* both PLAY, facings opposite and towards each other */ });
it("grooms: the lead grooms, the other sits facing it", () => { /* lead GROOM within 0.6 sizes + 7 px; partner SIT facing lead */ });
it("partners in a game are not pushed apart", () => { /* tussling pair stays within TUSSLE_REACH sizes for 3 s */ });
it("drops play for a mouse", () => { /* tussling pair + mouse → neither PLAY next tick; interrupted true */ });
```

`tests/core/colony.test.ts`:

```ts
it("lets the cats play only when cats-play is on", () => {
	// 2 cats close together, withRandom([0]) for 2 s: social false → no cat ever has play; social true → some cat does
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/core/social.test.ts tests/core/cat.test.ts tests/core/colony.test.ts`
Expected: FAIL. The module and the states don't exist.

- [ ] **Step 3: Implement `Playground`**

Each update:
1. **End games** that are over:
   - their time is up;
   - either cat is `interrupted` or no longer in `cats`;
   - `enabled` is false.
   Set both cats' `play` to null, and give both rest timers of `PLAY_REST`.
2. **Chase tags:** when `tagPause <= 0` and the lead is within `TAG_REACH * lead.size` of the other cat, swap the `lead` flags and set `tagPause = TAG_PAUSE`.
3. **Count down** rest timers, and drop the timers of cats that are gone.
4. **Maybe start** one game, consuming random numbers in the documented order.

`clear()` ends every game without starting rest timers.

- [ ] **Step 4: Implement play in `Cat.update`**

Play only steers when nothing earlier in the priority list applies. It sits after sleepiness and before wandering. `side` is `Math.sign(partner.x − x) || 1`.

- **Chase, lead:** target `partner.x`, at top speed.
- **Chase, follower:**
  - Target `x − side * 3 * size`, clamped to the roam range, at `FLEE_SPEED` of top speed.
  - If the clamped target is within `ARRIVE_PX` of `x` (cornered), target `partner.x + side * 2 * size` instead.
- **Tussle:**
  - Each cat targets `partner.x − side * 0.55 * size`.
  - Once within `TUSSLE_REACH * size`, switch to `PLAY`, facing the partner.
- **Groom, lead:**
  - Target `partner.x − side * GROOM_GAP * size`.
  - On arrival, switch to `GROOM`, facing the partner.
- **Groom, follower:**
  - Target its own x.
  - Hold `SIT`, facing the lead, while the lead is within `GROOM_GAP * size + ARRIVE_PX`. The `_sitFor` timeout must not end it.

**Separation:** skip `other === this.play?.partner`.

**Leaving play:** PLAY and GROOM drop to IDLE as soon as `play` is null or the cat is hunting. Add them to the "no longer applies" handling.

**Bookkeeping:** record `interrupted` from this tick's drives before the state machine runs.

- [ ] **Step 5: Wire up `colony.ts`**

`Colony` owns a `Playground`:
- `this._playground.update(dt, this.cats, settings.social)` runs before the cats update.
- `destroy()` calls `clear()`.

- [ ] **Step 6: Run the tests to make sure they pass**

Run: `node --import ./tests/support/hooks.ts --test tests/core && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npm run fix
git add src/core tests/core
git commit -m "Let idle cats chase, play-fight and groom each other"
```

---

### Task 10: Settings rows on both platforms

**Files:**
- Modify: `src/platform/gnome/prefs.ts`, `src/platform/win32/renderer/settings.ts` (`LABELS`)
- Test: by hand. Neither settings UI has unit tests. `npm run typecheck` covers both.

**Interfaces:**
- Consumes: the four keys (Task 2).

- [ ] **Step 1: Add the GNOME rows**

- Under **Behaviour**, add `switchRow(settings, "cats-play", "Cats play together", "Idle cats sometimes chase, play-fight or groom each other.")` and `switchRow(settings, "name-tags", "Show names on hover", "Hold the pointer over a cat to see its name.")`.
- Under **Furniture and toys**, after the post positions row:
  - `spinRow(settings, "bowl-count", "Food bowls", "Hungry cats eat here. Rub the pointer over an empty bowl to fill it.", 0, 8)`.
  - `spinRow(settings, "hunger-after", "Hungry after", "Seconds after a meal before a cat is hungry again.", 60, 14400, 60)`. Bind its `sensitive` to `bowl-count` > 0, the way the positions rows follow their counts, or leave it always sensitive if that pattern doesn't fit a spin row.
- Update the "Name" row's subtitle (if it has one) so it no longer says the name is for the settings only.

- [ ] **Step 2: Add the Windows labels**

Add to `LABELS`, after `scratchers`:

```ts
bowls: { title: "Food bowls", hint: "hungry cats eat here; rub the pointer over an empty bowl to fill it" },
hungerAfter: { title: "Hungry after", hint: "seconds after a meal before a cat is hungry again" },
```

and after `wiggleIcons`:

```ts
social: { title: "Cats play together", hint: "idle cats sometimes chase, play-fight or groom each other" },
nameTags: { title: "Show names on hover", hint: "hold the pointer over a cat to see its name" },
```

- [ ] **Step 3: Typecheck, then check by hand**

Run: `npm run typecheck && npm run ext:install && npm run ext:prefs`
Expected: the new rows appear on GNOME and changing them takes effect live. For Windows, this is checked in CI and on a Windows machine.

- [ ] **Step 4: Commit**

```bash
npm run fix
git add src/platform/gnome/prefs.ts src/platform/win32/renderer/settings.ts
git commit -m "Add the play, name tag and bowl settings to both settings windows"
```

---

### Task 11: Documentation and the full check

**Files:**
- Modify: `README.md`, `docs/windows.md` (only if it lists settings)

- [ ] **Step 1: Update the README**

- Intro: add that the cats play with each other, eat from bowls, show their names when you hover, and purr when you rub the pointer over them.
- Settings table:
  - Change "Each cat: name" to "Shown in the settings and on the cat's name tag".
  - Add rows for **Cats play together** (on), **Show names on hover** (on), **Food bowls** (0, "Bowls next to the dock (0 to 8). Hungry cats eat from them. Rub the pointer over an empty bowl to fill it") and **Hungry after** (1800, "Seconds after a meal before a cat is hungry again").
- Add a short "Petting" line: rub the pointer back and forth over a cat.

- [ ] **Step 2: Run the full check**

Run: `npm run check`
Expected: Biome clean, `tools/cli.ts check` passes, every test passes.

- [ ] **Step 3: Check the whole thing by hand on GNOME**

Run `npm run dev` with 3 cats, 1 bed, 1 bowl, `hunger-after` 60 and `mouse-interval` 0. Check:
- The cats play within a couple of minutes.
- A hungry cat eats, and the bowl frame changes.
- Rubbing an empty bowl fills it.
- Rubbing a cat shows the purr with its heart.
- The name tag appears and follows the cat.
- Dock clicks under a cat still work.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/windows.md
git commit -m "Document play, food bowls, name tags and petting"
```

---

## Self-review notes

- Spec coverage:
  - Priority list: Tasks 4, 8 and 9.
  - Hover and tag: Tasks 4–7.
  - Petting: Tasks 3 and 4.
  - Play: Task 9.
  - Hunger and bowls: Tasks 3 (gesture) and 8.
  - Sprites and heart colour: Task 1.
  - Label views and strip height: Tasks 6 and 7.
  - Settings: Tasks 2 and 10.
  - Docs: Task 11.
- Names used across tasks: `RubDetector.rubbing`, `Cat.hovered`, `Cat.pet`, `Cat.petted`, `Cat.hunger`, `Cat.hungry`, `Cat.bowl`, `Cat.play`, `Cat.interrupted`, `Cat.free`, `State.PURR|EAT|PLAY|GROOM`, `catUnderPointer`, `bowlUnderPointer`, `resolveCatName`, `tagText`, `NameTag`, `LabelView`, `ColonyHost.createLabelView`, `FakeLabelView`, `Prop.food`, `Prop.eater`, `Prop.refill`, `Prop.fillFrame`, `BOWL_PORTIONS`, `interleaveProps(beds, scratchers, bowls)`, `Playground`, `PlayRole`, `GameKind`, `stripHeight`, `NAME_TAG_ROOM`, `GnomeLabelView`, `DomLabelView`.
- Task order: Task 5 leaves the two platform hosts failing the typecheck until Tasks 6 and 7. Run those three back to back, or fold Tasks 6 and 7 into 5 if the branch must typecheck after every commit.

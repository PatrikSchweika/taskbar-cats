# Food Bowls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Food bowls stand on the floor beside the beds and posts. Cats slowly get hungry, walk to a bowl and eat. The user refills an empty bowl by rubbing the pointer over it.

**Architecture:** A bowl is a third `Prop` kind with a portion count. `Cat` gains a hunger value and an EAT state, at the "food" place in its priority chain. A rub gesture detector (`src/core/rub.ts`), driven by the colony with the pointer it already receives, refills the bowl under the pointer. No new platform code apart from settings rows.

**Tech Stack:** TypeScript on Node 22 (`node --test` with native type stripping), GJS/St and libadwaita on GNOME, Electron 44 on Windows, Biome.

**Spec:** `docs/superpowers/specs/2026-11-16-playful-cats-design.md` (sections "What a cat does, in priority order", "Hunger and bowls", "New sprite frames", "Settings summary").

## Fitting in with the other three plans

Four plans implement the design: cat play (already implemented), food bowls (this one), [name tags](2026-11-16-name-tags.md) and [petting](2026-11-16-petting.md). They can land in any order. They touch the same few places, so every plan follows these rules:

- **The priority chain.** `Cat.update` decides each tick with drive flags (`hunting`, `interested`, `sleepy` today) and one `if / else if` chain that sets `_target`. The design's full order is hunt → purr (`beingPetted`) → hover (`underPointer`) → food (`seekingFood`) → pointer interest (`interested`) → sleep (`sleepy`) → play → wander. Add your flag and branch at your place among the ones that exist. Your flag is false when any flag above it is true. Each existing flag below yours gets `&& !yourFlag`. Branches for new states in the state machine go right after the POUNCE branch, in the same order.
- **Shared building blocks.** Two pieces belong to two plans each: hover (name tags, petting) and the rub detector (petting, food bowls). Each plan that needs one carries the same task for it. If the code already exists, check it against that task's Interfaces block, run that task's tests, and move on.
- **The rub target.** In `Colony.update` the rub target is the hovered cat, and otherwise the bowl under the pointer: `hovered ?? bowlUnderPointer(…)`. Each plan wires only its own half.
- **Shared files.** New tests go in new `describe` blocks. New sprite poses, settings, settings rows and README lines go at the stated spot; leave entries from the other plans alone. If two plans are built on parallel branches, expect simple merge conflicts in `State`, `FRAME_RATE_SCALE`, `POSES`, the settings tables, the schema and the README. Keep both sides.

## Global Constraints

- Node `>=22.22.2`. Run one test file with `node --import ./tests/support/hooks.ts --test <file>`. Run everything with `npm run check` (Biome with warnings as errors, `node tools/cli.ts check`, then all tests).
- Format with Biome (tabs). Run `npm run fix` before every commit.
- Imports between source files end in `.js`. Tests import sources with `.ts`.
- Every GSettings key in the schema must appear in the core tables. `tests/core/config.test.ts` fails otherwise.
- Nothing new may be reactive or catch input. Refilling works from the pointer position alone.
- Positions and sizes inside the simulation are in the positioning space (`cat.size`, `prop.size`, not `iconSize`). The pointer arrives in the same space on both platforms.
- The Electron binary isn't installed on the development machine. Windows renderer code is checked by `npm run typecheck` and CI, not by running it.
- Commit messages follow the repository style: one imperative sentence, no prefix. End each one with the `Co-Authored-By` line required for the session.
- Values the spec pins (copy them exactly): `bowl-count` default 0, range 0–8. `hunger-after` default 1800, range 60–14400. Starting hunger below 0.5. Bowl 3 portions. Eat 4 s. Stance 0.45 sizes. Ask 8 s, ask cooldown 60 s. Rub: 3 reversals, within 1.2 s, strokes of at least 0.15 sizes.

## Review Focus

1. **The bowl count lowered during a meal.** The props are rebuilt and the eating cat holds a destroyed bowl. Expected: the meal ends, nothing is eaten, no throw. Test: Task 4 "abandons a meal when its bowl is removed".
2. **A cat removed from the settings while eating.** Expected: the bowl is free for the others. Test: Task 4 "frees the bowl when a cat is removed".
3. **Moving the pointer across the taskbar normally.** A single sweep over a bowl must not refill it. Test: Task 3 "a single sweep across the target is not a rub".
4. **No bowls (the default).** Expected: hunger never rises and no behaviour changes. Test: Task 4 "does not get hungry without bowls".
5. **Two hungry cats and one bowl.** Expected: they take turns, never both eating at once. Test: Task 4 "only one cat eats from a bowl at a time".

---

### Task 1: Sprite frames for eating and the bowl

**Files:**
- Modify: `tools/gen-sprites.ts` (`Pose`, `POSES`, `PROP_PALETTES`, `PROP_PLANS`, `PROP_POSES`)
- Regenerate: `src/assets/cats/**` (via `npm run sprites`)
- Test: `tests/tools/gen-sprites.test.ts`, `tests/assets.test.ts`

**Interfaces:**
- Produces: cat animation `eat` (2 frames) and prop `bowl` (3 frames: 0 empty, 1 low, 2 full) in `src/assets/cats/manifest.json`.

- [ ] **Step 1: Write the failing tests**

In `tests/tools/gen-sprites.test.ts` (import `buildPropFrame`):

```ts
describe("bowl art", () => {
	const cells = (c: { g: string[][] }) => new Set(c.g.flat());
	it("fills the bowl with kibble only when it has food", () => {
		assert.ok(!cells(buildPropFrame("bowl", { fill: 0 })).has("P"));
		assert.ok(cells(buildPropFrame("bowl", { fill: 2 })).has("P"));
	});
});
```

In `tests/assets.test.ts`, extend "has the furniture and the mouse the simulation asks for":

```ts
assert.equal(manifest.props.bowl, 3, "empty, low, full");
assert.equal(manifest.animations.eat, 2);
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/tools/gen-sprites.test.ts tests/assets.test.ts`
Expected: FAIL. The `fill` pose field and the `bowl` prop don't exist.

- [ ] **Step 3: Add the eat pose**

`Pose` gains `fill?: number` (0–2, bowls only). Add to `POSES`:

```ts
eat: ["quad", [
	{ phase: 0, swing: 0, crouch: 0.6, headDy: 4.0, lookUp: -0.8, earPerk: 0.3, tailAngle: 112 },
	{ phase: 0, swing: 0, crouch: 0.6, headDy: 4.8, lookUp: -0.8, earPerk: 0.3, tailAngle: 108 },
]],
```

If `checkFrame` reports a clipped edge, reduce `headDy`. Keep the frame count and order.

- [ ] **Step 4: Add the bowl prop**

- `PROP_PALETTES.bowl`: `{ B: "#4f7fbf", D: "#335a8c", L: "#9cc0ea", K: "#1f3350", E: "#000000", P: "#a5672f", W: "#ffffff" }`.
- `drawBowl(c, p)`: a `B` ellipse dish about 14 px wide centred at x 16, a `D` base rect reaching row 31, and an `L` ellipse rim. For `fill >= 1`, a mound of `P` kibble in the dish, taller at `fill` 2. Frame 0 has no `P` at all.
- Register it in `PROP_PLANS`, and set `PROP_POSES.bowl = [{ fill: 0 }, { fill: 1 }, { fill: 2 }]`.

- [ ] **Step 5: Regenerate and run the tests**

Run: `npm run sprites && node --import ./tests/support/hooks.ts --test tests/tools/gen-sprites.test.ts tests/assets.test.ts`
Expected: PASS. Open `src/assets/cats/props/bowl_0.svg`, `bowl_2.svg` and `black/eat_0.svg` in an image viewer and check them by eye.

- [ ] **Step 6: Commit**

```bash
npm run fix
git add tools/gen-sprites.ts src/assets/cats tests/tools/gen-sprites.test.ts tests/assets.test.ts
git commit -m "Draw an eating cat and a food bowl"
```

---

### Task 2: The bowl-count and hunger-after settings

**Files:**
- Modify: `src/core/config.ts`, `src/core/cat.ts` (`CatConfig` only), `src/schemas/org.gnome.shell.extensions.taskbar-cats.gschema.xml`, `tests/support/core/harness.ts` (`DEFAULT_CFG`)
- Test: `tests/core/config.test.ts`

**Interfaces:**
- Produces:
  - `INT_SETTINGS.bowls = { key: "bowl-count", default: 0, min: 0, max: 8 }`, right after `scratchers`.
  - `INT_SETTINGS.hungerAfter = { key: "hunger-after", default: 1800, min: 60, max: 14400 }`, right after `bowls`.
  - `Settings.bowls: number`, `Settings.hungerAfter: number`, `CatConfig.hungerAfter: number` (seconds).

- [ ] **Step 1: Write the failing tests** in `tests/core/config.test.ts`

```ts
describe("bowl and hunger settings", () => {
	it("defaults to no bowls and 1800 s", () => {
		const s = defaultSettings();
		assert.equal(s.bowls, 0);
		assert.equal(s.hungerAfter, 1800);
	});
	it("clamps them from a hand-edited file", () => {
		const s = normalizeSettings({ "hunger-after": 5, "bowl-count": 99 });
		assert.equal(s.hungerAfter, 60);
		assert.equal(s.bowls, 8);
	});
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/core/config.test.ts`
Expected: FAIL. The properties are undefined.

- [ ] **Step 3: Add the table entries, the fields and the schema keys**

Add `hungerAfter: 1800` to `DEFAULT_CFG` in the harness, and pass `hungerAfter` wherever the colony builds a `CatConfig` from `Settings`.

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
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `node --import ./tests/support/hooks.ts --test tests/core/config.test.ts && npm run typecheck`
Expected: PASS, including the existing schema-drift test.

- [ ] **Step 5: Commit**

```bash
npm run fix
git add src/core/config.ts src/core/cat.ts src/schemas tests/support/core/harness.ts tests/core/config.test.ts
git commit -m "Add settings for food bowls and hunger"
```

---

### Task 3: The rub gesture detector

> **Shared with the petting plan.** If `src/core/rub.ts` already exists, check it against the Interfaces block below, run this task's tests, and go on to Task 4.

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

### Task 4: Bowls and hunger

**Files:**
- Modify: `src/core/props.ts`, `src/core/cat.ts`, `src/core/colony.ts`, `src/platform/gnome/extension.ts` (`_onSettingChanged` resync list), `tests/support/core/harness.ts` (`makeContext` gains `bowls: []`)
- Test: `tests/core/props.test.ts`, `tests/core/cat.test.ts`, `tests/core/colony.test.ts`

**Interfaces:**
- Consumes: the `eat` animation and `bowl` frames (Task 1). `Settings.bowls` and `CatConfig.hungerAfter` (Task 2). `RubDetector` (Task 3).
- Produces:
  - In `props.ts`: `PropKind` becomes `"bed" | "scratcher" | "bowl"`. `export const BOWL_PORTIONS = 3`. `Prop.food: number` (starts at `BOWL_PORTIONS`), `Prop.eater: Cat | null`, `Prop.refill(): void`, and `get fillFrame(): number` (0 when food is 0, 1 when food is 1, otherwise 2).
  - In `cat.ts`: `State.EAT = "eat"`, with `FRAME_RATE_SCALE[EAT] = 0.6`. `export const EAT_SECONDS = 4, ASK_SECONDS = 8, ASK_COOLDOWN = 60, BOWL_STANCE = 0.45`. `CatContext.bowls: readonly Prop[]`. `Cat.hunger: number` (starts at `Math.random() * 0.5`), `get hungry(): boolean` (`hunger >= 1`), `get bowl(): Prop | null`. The drive flag `seekingFood`. EAT counts as `rooted`.
  - In `colony.ts`: `interleaveProps(beds: number, scratchers: number, bowls = 0): PropKind[]`, ordering each round as bed, scratcher, bowl. `get bowls(): Prop[]`. `export function bowlUnderPointer(bowls: readonly Prop[], pointer: { x: number; y: number }, floorY: number): Prop | null`: the last bowl whose square (`x ± size/2`, `floorY − size` to `floorY`, inclusive) holds the pointer.

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
it("rubbing the pointer over a bowl fills it", () => { /* settings bowls: 1; empty it; rub ±12 px around its x at floorY - 4 for 1 s → food 3 */ });
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

**The drive:** `seekingFood` is true when the cat is hungry, there are bowls, its ask cooldown has run out, and no flag above food in the chain is true (`hunting` today, plus `beingPetted` and `underPointer` if those plans have landed). Add `&& !seekingFood` to `interested` and `sleepy`. In the target chain, its branch goes after `hunting` (and after any purr or hover branch) and before `interested`. That is how hunger outranks sleep.

**While seeking food:**
- Claim the nearest bowl with `food > 0` and `eater` null (or this cat), the way `_claimBed` does. If there is one:
  - Target the side of the bowl nearest the cat, at `BOWL_STANCE * size`.
  - On arrival (within `ARRIVE_PX * 2`), switch to `EAT`, facing the bowl.
  - After `EAT_SECONDS`: `food = max(0, food − 1)`, `hunger = 0`, release the bowl, and go to IDLE.
- If no bowl has food:
  - Target the stance beside the nearest bowl and show `ALERT` there.
  - After `ASK_SECONDS` there, start the `ASK_COOLDOWN`. Until it runs out, `seekingFood` is false.

**Interruptions:** when a higher drive starts (a mouse, and petting or hover if they exist), a cat in `EAT` goes to IDLE at once and releases the bowl without eating. A cat whose bowl disappears mid-meal does the same.

- [ ] **Step 5: Wire up `colony.ts`**

- `_syncProps` counts bowls too. Bowls have no position list, so `pinned` stays null.
- The context gets `bowls: this.bowls`.
- **Refilling.** If the colony doesn't own a `RubDetector` yet, add `private _rub = new RubDetector()`, and call `this._rub.reset()` in `destroy()`. Each tick before the cats update:

```ts
const rubTarget = bowlUnderPointer(this.bowls, world.pointer, world.floorY);
this._rub.update(dt, world.pointer.x, rubTarget, rubTarget?.size ?? 0);
const rubbed = this._rub.rubbing;
if (rubbed instanceof Prop && rubbed.kind === "bowl") rubbed.refill();
```

  If the petting plan has landed, the detector already runs with the hovered cat as its target. Keep its code and change the target to `hovered ?? bowlUnderPointer(this.bowls, world.pointer, world.floorY)`, then add the refill line.
- In `src/platform/gnome/extension.ts`, add `INT_SETTINGS.bowls.key` to the keys that trigger `_syncCats` in `_onSettingChanged`.

- [ ] **Step 6: Run the tests to make sure they pass**

Run: `node --import ./tests/support/hooks.ts --test tests/core && npm run typecheck`
Expected: PASS, including every existing test.

- [ ] **Step 7: Commit**

```bash
npm run fix
git add src/core src/platform/gnome/extension.ts tests/core tests/support/core/harness.ts
git commit -m "Give the cats food bowls, and an appetite"
```

---

### Task 5: Settings rows, docs and the full check

**Files:**
- Modify: `src/platform/gnome/prefs.ts`, `src/platform/win32/renderer/settings.ts` (`LABELS`), `README.md`

- [ ] **Step 1: Add the settings rows**

- GNOME, under **Furniture and toys**, after the post positions row:
  - `spinRow(settings, "bowl-count", "Food bowls", "Hungry cats eat here. Rub the pointer over an empty bowl to fill it.", 0, 8)`.
  - `spinRow(settings, "hunger-after", "Hungry after", "Seconds after a meal before a cat is hungry again.", 60, 14400, 60)`. Bind its `sensitive` to `bowl-count` > 0 the way the position rows follow their counts, or leave it always sensitive if that pattern doesn't fit a spin row.
- Windows `LABELS`, after `scratchers`:

```ts
bowls: { title: "Food bowls", hint: "hungry cats eat here; rub the pointer over an empty bowl to fill it" },
hungerAfter: { title: "Hungry after", hint: "seconds after a meal before a cat is hungry again" },
```

- [ ] **Step 2: Update the README**

Add to the intro that the cats eat from food bowls. Add settings rows for **Food bowls** (0, "Bowls next to the dock (0 to 8). Hungry cats eat from them. Rub the pointer over an empty bowl to fill it") and **Hungry after** (1800, "Seconds after a meal before a cat is hungry again").

- [ ] **Step 3: Run the full check**

Run: `npm run check && npm run typecheck`
Expected: Biome clean, `tools/cli.ts check` passes, every test passes, no type errors.

- [ ] **Step 4: Check by hand on GNOME**

Run `npm run dev` with 2 cats, 1 bowl, `hunger-after` 60 and `mouse-interval` 0.
Expected: within a couple of minutes a cat walks to the bowl and eats, and the bowl's frame changes. Once it is empty, a hungry cat sits beside it looking up. Rubbing the pointer back and forth over the bowl fills it. Dock clicks under the bowl still work.

- [ ] **Step 5: Commit**

```bash
npm run fix
git add src/platform/gnome/prefs.ts src/platform/win32/renderer/settings.ts README.md
git commit -m "Add the bowl settings to both settings windows and document them"
```

---

## Self-review notes

- Spec coverage: hunger and bowls (Task 4), refilling (Tasks 3 and 4), sprites (Task 1), settings (Tasks 2 and 5), priority place (Task 4).
- Names used across tasks: `RubDetector.rubbing`, `Prop.food`, `Prop.eater`, `Prop.refill`, `Prop.fillFrame`, `BOWL_PORTIONS`, `Cat.hunger`, `Cat.hungry`, `Cat.bowl`, `State.EAT`, `CatContext.bowls`, `interleaveProps(beds, scratchers, bowls)`, `bowlUnderPointer`, `Settings.bowls`, `CatConfig.hungerAfter`.
- Independence: needs nothing from the other plans. Task 3 is shared with the petting plan, and Task 4 Step 5 says how to join the rub wiring if petting landed first.

# Arrange Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag beds, scratching posts and food bowls along the real dock or taskbar to place them, saving the result in the existing position settings.

**Architecture:** A platform-neutral `Arranger` in `src/core/arrange.ts` does the hit test, drag, double-click and timeout. It returns a settings patch for the position lists. Each platform does three things:
- turns arrange mode on and off;
- makes only the prop sprites (and a small toolbar) take the mouse while it is on;
- feeds the `Arranger` presses, pointer positions and releases, and writes back the patch it returns.

**Tech Stack:** TypeScript on Node 22 (`node --test` with native type stripping), GJS/St/Clutter and libadwaita on GNOME, Electron 44 on Windows, Biome.

**Spec:** `docs/superpowers/specs/2026-11-16-arrange-mode-design.md`

**Base:** food bowls (PR #14), which adds `bowl-positions`, `Colony.bowls` and `bowlUnderPointer`. If #14 is not merged, branch from `claude/food-bowls-80c3b7`.

## Global Constraints

- Node `>=22.22.2`. Run one test file with `node --import ./tests/support/hooks.ts --test <file>`. Run everything with `npm run check` (Biome with warnings as errors, `node tools/cli.ts check`, then all tests).
- Format with Biome (tabs). Run `npm run fix` before every commit.
- Imports between source files end in `.js`. Tests import sources with `.ts`.
- Every GSettings key in the schema must appear in `src/core/config.ts`. `tests/core/config.test.ts` fails otherwise.
- Outside arrange mode nothing may become reactive or take the mouse. Inside it, only prop sprites and the toolbar may.
- Positions stay as today: a whole-number percentage of the floor (0–100), or `AUTO_POSITION` (-1), per prop of each kind.
- Values the spec pins (copy them exactly):
  - drag threshold 4 px;
  - double-click 0.4 s;
  - timeout 120 s without a press;
  - key `arrange-mode` (b, default false);
  - labels "Arrange on screen", "Arrange furniture", "Arrange on screen…", "Reset all" and "Done";
  - hint "Drag the furniture. Double-click one to place it automatically.";
  - empty hint "Add a bed, post or bowl first".
- The Electron binary isn't installed on the development machine. Windows main and renderer code is checked by `npm run typecheck` and CI.
- Never run `npm run dev` without asking: it touches the live GNOME Shell.
- Commit messages: one imperative sentence, no prefix, ending with the session's `Co-Authored-By` line.

## Review Focus

1. **Arrange mode left on, so the dock can't be clicked.** Only prop squares and the toolbar take the mouse, and every exit in the spec ends the mode. Tests: Task 2 "ends after 120 s without a press", "ends when the cats are hidden" and "disable leaves nothing reactive". Windows needs a manual check (Task 5 Step 4).
2. **The shell restarts while arranging.** GNOME keeps `arrange-mode` true across the restart. Expected: the shell comes back not arranging. Test: Task 2 "enable clears a leftover arrange-mode".
3. **A plain click on a prop.** Expected: nothing is saved and the prop doesn't move. Test: Task 1 "a click without a drag changes nothing".
4. **A drop past the screen edge or off the floor.** Expected: the prop stays inside the roam range and the saved value is 0–100. Test: Task 1 "keeps the dragged prop on the floor".
5. **A prop count changed in settings mid-drag.** Expected: the drag is dropped, nothing is saved, no throw. Test: Task 1 "drops a drag whose prop was rebuilt".

---

### Task 1: The drag logic

**Files:**
- Create: `src/core/arrange.ts`
- Modify: `src/core/colony.ts`: add `propUnderPointer`; make `bowlUnderPointer` call it; make `_syncProps` take its list names from `POSITION_LISTS` instead of the inline `kind === "bed" ? … : …` chain.
- Test: `tests/core/arrange.test.ts` (new), `tests/core/colony.test.ts`

**Interfaces:**
- Produces, in `src/core/arrange.ts`:
  - `DRAG_THRESHOLD = 4`, `DOUBLE_CLICK_SECONDS = 0.4`, `ARRANGE_TIMEOUT = 120`.
  - `type PositionList = "bedPositions" | "scratcherPositions" | "bowlPositions"`.
  - `POSITION_LISTS: Readonly<Record<PropKind, PositionList>>`.
  - `type PositionPatch = Partial<Pick<Settings, PositionList>>`.
  - `percentAt(x: number, roam: Span): number`: rounds, clamped to 0–100. The inverse of `pinnedX`.
  - `withPosition(list: readonly number[], index: number, value: number): number[]`: a copy, padded with `AUTO_POSITION`.
  - `resetAllPositions(): PositionPatch`: all three lists `[]`.
  - `class Arranger`:
    - `constructor(colony: Colony)`;
    - `get pressed(): Prop | null`: the prop under a press that hasn't been released yet;
    - `get dragging(): Prop | null`: only once the pointer has moved past the threshold;
    - `press(time: number, x: number, y: number, floorY: number): boolean`: true when it hit a prop;
    - `move(x: number, roam: Span): void`;
    - `release(time: number, settings: Settings, roam: Span): PositionPatch | null`;
    - `cancel(): void`;
    - `tick(dt: number): boolean`: false once `ARRANGE_TIMEOUT` passes with no press.
- Produces, in `src/core/colony.ts`: `propUnderPointer(props: readonly Prop[], pointer: { x: number; y: number }, floorY: number): Prop | null`. Same square and rule as `bowlUnderPointer` today: the last hit wins, edges inclusive.

- [ ] **Step 1: Write the failing tests** in `tests/core/arrange.test.ts`

Build the colony with `fakeHost()`, `makeSettings(...)` and `makeBounds()` (roam 0–1200, floor 900); props are 48 px.

- `percentAt`:
  - `percentAt(120, {min:0,max:1200})` is 10;
  - `percentAt(126, …)` is 11;
  - `percentAt(-50, …)` is 0;
  - `percentAt(5000, …)` is 100.
- `withPosition([], 2, 40)` deep-equals `[-1, -1, 40]`. `withPosition([10, 20], 0, -1)` deep-equals `[-1, 20]`, and the input is unchanged.
- `resetAllPositions()` deep-equals `{ bedPositions: [], scratcherPositions: [], bowlPositions: [] }`.
- "a press on bare floor is not a press": `press` returns false, and `pressed` and `dragging` are null.
- "a click without a drag changes nothing": press on a bed, `move` +3 px, then `release` → null, and `bed.x` is unchanged.
- "dragging a bed pins it where it is dropped": with `beds: 2`, press on the second bed 10 px right of its centre, then move +240.
  - `bed.x` is its old x + 240: the grab offset is kept.
  - `release` returns `{ bedPositions: withPosition([], 1, percentAt(bed.x, roam)) }`.
- "writes the list for the prop's own kind": dragging a bowl returns a patch whose only key is `bowlPositions`.
- "keeps the dragged prop on the floor": `move(99999)` → `prop.x === 1200 - 24`, and the saved value is ≤ 100.
- "double-clicking sets a prop back to automatic":
  - With `bedPositions: [25]`, two press/releases 0.3 s apart return null, then `{ bedPositions: [-1] }`.
  - With the same clicks 0.6 s apart, both return null.
- "drops a drag whose prop was rebuilt": press and move, then `colony.sync` with a different `beds` count; `release` → null, with no throw.
- "ends after 120 s without a press": `tick(119)` is true. A press and release reset the clock. `tick(119)` is true again, then `tick(2)` is false.

In `tests/core/colony.test.ts`: "propUnderPointer picks the last prop whose square holds the pointer". Use two overlapping props and points on an edge, inside, and 1 px above `floorY - size`.

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/core/arrange.test.ts tests/core/colony.test.ts`
Expected: FAIL. The module doesn't exist.

- [ ] **Step 3: Implement**

Notes the tests leave open:
- Import `Colony` with `import type` in `arrange.ts`, because `colony.ts` imports `POSITION_LISTS` from it.
- Find a prop's index within its own kind from `colony.props` filtered by `kind`.
- A press only counts towards a double-click if both clicks hit the same prop with no drag between them.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `node --import ./tests/support/hooks.ts --test "tests/core/*.test.ts" && npm run typecheck`
Expected: PASS, including every existing colony test.

- [ ] **Step 5: Commit** "Work out where a dragged piece of furniture should stand"

---

### Task 2: Arrange mode in the GNOME Shell extension

**Files:**
- Modify:
  - `src/core/config.ts`: `ARRANGE_KEY`;
  - the schema: key `arrange-mode`;
  - `src/platform/gnome/catLayer.ts`;
  - `src/platform/gnome/extension.ts`;
  - `src/stylesheet.css`.
- Create: `src/platform/gnome/arrangeBar.ts`
- Test: `tests/platform/gnome/extension.test.ts`, `tests/core/config.test.ts`. Extend the fakes in `tests/support/gnome/` as needed: pointer modifiers on `global.get_pointer()`, `set_boolean`, and emitting `button-press-event` on a prop actor.

**Interfaces:**
- Consumes: `Arranger`, `propUnderPointer`, `resetAllPositions`, `POSITION_LISTS` (Task 1).
- Produces:
  - `export const ARRANGE_KEY = "arrange-mode"` in `config.ts`. It is GNOME-only and not in `Settings`. Add it to the known keys in "covers every key the schema declares".
  - Schema key `arrange-mode`, type `b`, default `false`. Summary "Arranging the furniture"; description "Set by the preferences while you drag the furniture on screen. Always false when the shell starts."
  - `CatLayer.setArranging(on: boolean, onPress: (x: number, y: number) => void)`. It sets `reactive` and adds the style class `taskbar-cats-arranging` on every prop view, including ones created later while it is on. It connects `button-press-event` to `onPress`, returning `Clutter.EVENT_STOP`. Turning it off undoes all of this.
  - `class ArrangeBar` in `arrangeBar.ts`:
    - `constructor(parent: Clutter.Actor, handlers: { reset(): void; done(): void })`;
    - `place(centreX: number, bottomY: number): void`;
    - `setEmpty(empty: boolean): void`: switches to the empty hint;
    - `destroy(): void`.

    It is a reactive `St.BoxLayout` holding the hint label and two `St.Button`s.

- [ ] **Step 1: Write the failing tests** in `extension.test.ts` (new `describe("arrange mode")`)

- "turning arrange-mode on makes only the furniture reactive": with `bed-count` 1 and `cat-count` 1, set `arrange-mode` true. Every prop actor is `reactive` and has `taskbar-cats-arranging`; no cat actor is reactive.
- "drags a bed and saves where it lands":
  - Emit a press on the bed at its centre.
  - Set the fake pointer to 10% of the 1600 px stage with button 1 held, and `tick(2)`.
  - Release the button and `tick()`.
  - `bed-positions` is `[10]`.
- "a click without a drag saves nothing": press and release at the same spot; `bed-positions` stays `[]`.
- "Done ends arrange mode": invoke the bar's done handler. `arrange-mode` is false and no actor on the layer is reactive.
- "Reset all clears every position": start with `bed-positions [10]` and `bowl-positions [50]`; reset leaves all three lists `[]`.
- "ends after 120 s without a press": `tick(121 * 30)` → `arrange-mode` false.
- "ends when the cats are hidden": toggle the hide hotkey → `arrange-mode` false.
- "enable clears a leftover arrange-mode": enable with `arrange-mode: true` → it is false after enable, and nothing is reactive.
- "disable leaves nothing reactive": disable while arranging → no reactive actors, the bar is destroyed, and `arrange-mode` is false.

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --import ./tests/support/hooks.ts --test tests/platform/gnome/extension.test.ts tests/core/config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **Entering:** on `changed::arrange-mode` → true, create an `Arranger` for `rt.colony`, call `layer.setArranging(true, …)` and create the `ArrangeBar`.
- **Each tick while arranging:**
  - force `ACTIVE_INTERVAL_MS`;
  - feed `arranger.tick(dt)`;
  - place the bar centred on the monitor, with its bottom 8 px above the tallest prop (`floorY - size - 8`);
  - if `arranger.pressed` is set, read `global.get_pointer()`:
    - `Clutter.ModifierType.BUTTON1_MASK` held → `move(px, roam)`;
    - released → `release(now, this._cfg, roam)` and write any patch with `set_value(key, new GLib.Variant("ai", list))`, using `POSITION_SETTINGS` for the key names.
- **Leaving:** on any exit in the spec, `layer.setArranging(false)`, destroy the bar, `arranger.cancel()`, and `set_boolean(ARRANGE_KEY, false)`. The exits are `changed::arrange-mode` → false, Done, the timeout, `_toggleHidden`, the overview showing, the tracker becoming unusable, and `disable`. In `enable`, set the key to false before connecting `changed`.
- Polling the pointer avoids a stage grab. A press is consumed by the prop actor, so the dock never sees a click.
- Outline a prop with `taskbar-cats-arranging` using CSS (`outline`/`border` on the St.Icon). Mark a pinned one with `taskbar-cats-pinned` and a pin glyph via `::after` if St supports it there; otherwise use a thicker border.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `node --import ./tests/support/hooks.ts --test "tests/platform/gnome/*.test.ts" "tests/core/*.test.ts" && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** "Let the furniture be dragged into place on the GNOME dock"

---

### Task 3: Arrange mode state in the Windows main process

**Files:**
- Modify: `src/platform/win32/ipc.ts`, `src/platform/win32/preload.ts`, `src/platform/win32/main.ts`
- Test: `tests/platform/win32/preload.test.ts`

**Interfaces:**
- Produces, in `CHANNELS`:
  - `arrange = "cats:arrange"`: main → overlay and settings, a boolean;
  - `setArranging = "cats:set-arranging"`: overlay or settings → main, a boolean;
  - `capture = "cats:capture"`: overlay → main, a boolean meaning "take the mouse now".
- Produces, on the preload API: `onArrange(fn: (on: boolean) => void)`, `setArranging(on: boolean)`, `capture(on: boolean)`.
- Main:
  - `_arranging` state and `_setArranging(on)`, which sends `arrange` to both windows and rebuilds the tray menu.
  - A tray checkbox item "Arrange furniture", after "Hide cats".
  - On `capture(on)`, while arranging, `overlay.window.setIgnoreMouseEvents(!on, { forward: true })`.
  - Ending arrange mode always restores `setIgnoreMouseEvents(true, { forward: true })`.
  - Arrange mode ends when the cats are hidden or the taskbar isn't usable.

- [ ] **Step 1: Write the failing tests** in `preload.test.ts`, following its existing channel tests: `onArrange` relays `cats:arrange`; `setArranging(true)` sends `cats:set-arranging` with `true`; `capture(false)` sends `cats:capture` with `false`.
- [ ] **Step 2: Run them to make sure they fail.** Run: `node --import ./tests/support/hooks.ts --test tests/platform/win32/preload.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the channels, the preload API and main's state.
- [ ] **Step 4: Run the tests to make sure they pass.** Run: `node --import ./tests/support/hooks.ts --test "tests/platform/win32/*.test.ts" && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** "Keep track of arranging the furniture in the Windows app"

---

### Task 4: Dragging in the Windows overlay and settings window

**Files:**
- Modify:
  - `src/platform/win32/renderer/overlay.ts`;
  - `src/platform/win32/renderer/overlay.html`: the bar markup and the `.arranging` and `.pinned` styles;
  - `src/platform/win32/renderer/settings.ts`: the "Arrange on screen…" button in the furniture section.

**Interfaces:**
- Consumes: `Arranger`, `propUnderPointer` and `resetAllPositions` (Task 1); `onArrange`, `setArranging`, `capture` and `apply` (Task 3, plus the existing `apply`).

- [ ] **Step 1: Implement the overlay**
  - Add the new API methods to the `declare const cats` block.
  - On `onArrange(true)`:
    - create an `Arranger`;
    - show `#arrange-bar`, centred at the top of the strip;
    - add `arranging` to `#stage`;
    - mark each prop element `.pinned` from `prop.pinned`.
  - Each frame while arranging:
    - feed `arranger.tick(dt)`; on false, call `cats.setArranging(false)`;
    - work out `want = arranger.dragging !== null || propUnderPointer(colony.props, latestPointer, layout.floorY) !== null || pointerOverBar`;
    - call `cats.capture(want)` only when it changes.
  - Pointer events on `window`:
    - `pointerdown` → `arranger.press(e.timeStamp / 1000, e.clientX, e.clientY, layout.floorY)`; when it hits, `setPointerCapture`.
    - `pointermove` → `move(e.clientX, layout.roam)`.
    - `pointerup` → `release(...)`, then `cats.apply(patch)` when not null.
  - Bar buttons: Reset all → `cats.apply(resetAllPositions())`; Done → `cats.setArranging(false)`.
  - On `onArrange(false)`: `cancel()`, hide the bar, remove the classes, and `cats.capture(false)`.
- [ ] **Step 2: Implement the settings button.** It calls `cats.setArranging(true)` and is disabled while arrange mode is on (follow `onArrange`). Place it at the top of the positions sections.
- [ ] **Step 3: Verify.** Run `npm run typecheck && npm run check`. Expected: PASS. This is typecheck only: the renderer can't run here.
- [ ] **Step 4: Commit** "Let the furniture be dragged into place on the Windows taskbar"

---

### Task 5: GNOME preferences row, README and the full check

**Files:**
- Modify: `src/platform/gnome/prefs.ts`, `README.md`

- [ ] **Step 1: Add the preferences row.** Under *Furniture and toys*, before the position rows, add an `Adw.SwitchRow` titled "Arrange on screen" with the subtitle "Drag the furniture where you want it, right on the dock". Bind it to `arrange-mode`, using `settings.bind(…, "active", Gio.SettingsBindFlags.DEFAULT)`.
- [ ] **Step 2: Update the README.** Add a short "Placing the furniture" paragraph:
  - how to start arrange mode on each platform;
  - drag to place, double-click for automatic, Reset all, Done;
  - it ends by itself after two idle minutes.

  Keep the positions settings row.
- [ ] **Step 3: Run the full check.** Run: `npm run check && npm run typecheck`. Expected: all pass.
- [ ] **Step 4: Check by hand** (say in the PR whether it was done).
  - GNOME: run `npm run dev` *after asking*, with 1 bed, 1 post, 1 bowl and 2 cats.
    - Drag each prop, then double-click one.
    - Reset all.
    - Click dock icons right next to a prop while arranging: the app opens.
    - Wait 2 minutes: the mode ends by itself.
    - Toggle the hide hotkey: the mode ends.
  - Windows (CI build or a Windows machine): the same, and after Done, clicks on the taskbar under the props work again.
- [ ] **Step 5: Commit** "Add the arrange switch to the GNOME preferences and document arranging"

---

## Self-review notes

- Spec coverage:
  - turning arrange mode on and off: Tasks 2, 3, 4 and 5;
  - only props and the bar take the mouse: Tasks 2 and 4;
  - every exit: Tasks 2 and 3;
  - restart safety: Task 2;
  - drag, threshold, double-click, Reset all and timeout: Task 1;
  - outlines and pins: Tasks 2 and 4;
  - the empty hint: Task 2's `setEmpty`, and Task 4's bar text when `colony.props` is empty.
- Names used across tasks: `Arranger.press/move/release/cancel/tick/pressed/dragging`, `propUnderPointer`, `POSITION_LISTS`, `PositionPatch`, `resetAllPositions`, `ARRANGE_KEY`, `CatLayer.setArranging`, `ArrangeBar`, and the channels `CHANNELS.arrange/setArranging/capture`.
- Not covered by automated tests: the Windows renderer and main behaviour. Task 5 Step 4 checks them by hand.

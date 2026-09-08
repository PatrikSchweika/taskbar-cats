# Per-cat settings, sprite previews, and a hide/show hotkey

Date: 2026-09-06
Status: approved design

> **Revision, 2026-09-08.** Fur palette and size are now cat-specific only.
> The colony-wide `palettes` and `sprite-size` keys were removed in review,
> so wherever this document (and the plan beside it) says a per-cat Auto
> falls back to those, read: Auto takes a turn through every palette on
> disk, and Auto size is the dock's own icon size. The palette toggles with
> previews went with the `palettes` key; the per-cat previews remain.

## Goal

Three additions that all live in the settings layer and both settings UIs:

1. **Per-cat settings.** Each cat can have its own fur palette, a display
   name, and a size. Everything else stays colony-wide.
2. **Sprite previews.** The settings UI shows a small looping animation of a
   cat next to every fur palette toggle and in every per-cat row.
3. **Hide/show hotkey.** A configurable global shortcut hides and shows the
   cats. Default `Ctrl+Alt+C`.

Both platforms (GNOME extension, Windows Electron app) get all three, driven
from the shared tables in `src/core/config.ts` so neither can drift.

## Non-goals

- Per-cat speed, attraction, or nap thresholds. Out of scope for this round.
- Displaying cat names on screen. Names are labels in the settings UI only.
- Persisting the hidden state across restarts.
- Any change to cat behaviour or to the sprite art.

## 1. Per-cat settings

### Storage

Parallel arrays indexed by cat number, following the `bed-positions` pattern.
Entries beyond the current cat count are kept so a cat that is removed and
re-added gets its old settings back. Missing entries mean "Auto".

| Property on `Settings` | GSettings key | Type | Entry meaning |
|---|---|---|---|
| `catPalettes` | `cat-palettes` | `as` | Palette name; `""` or missing = Auto |
| `catNames` | `cat-names` | `as` | Display name; `""` or missing = "Cat N" |
| `catSizes` | `cat-sizes` | `ai` | Logical pixels; `0` or missing = colony size; otherwise clamped to 16-128 |

The Windows JSON file uses the same keys. `normalizeSettings` treats every
entry as hostile: non-strings become `""`, non-numbers become `0`, and sizes
outside the range are clamped. `toStorage` writes them back verbatim.

Rejected alternative: one JSON string per cat. Opaque in dconf-editor, and it
breaks the rule that the Windows file reads like the schema.

### Resolution

A pure function in `src/core/colony.ts`:

```ts
resolveCatPalette(settings: Settings, index: number, available: readonly string[]): string
```

Returns `settings.catPalettes[index]` when that palette exists in `available`,
otherwise the palette the colony pool would assign (the existing cycle through
`resolvePalettes(settings.palettes, available)`, falling back to the first
available palette). `Colony.sync` uses it for every cat; both settings UIs use
it so a cat on Auto previews what it will actually get.

Per-cat size: `Colony.sync` passes `settings.catSizes[i] || colonySize` to each
cat's `setSize`. Props keep the colony size. `Colony.sizeFor` is unchanged.

### UI

Both settings windows gain a **Cats** section with one row per cat. Rows follow
the cat count, rebuilt when it changes, the way the bed and post position rows
already are. Each row contains:

- a **name** text field (placeholder "Cat N"),
- a **palette** dropdown: "Auto" plus every palette from the manifest,
- a **size** spinner (16-128) with an **Auto** switch, greyed out while Auto is
  on and keeping its last value, exactly like the position rows,
- a **preview** (section 2) of the resolved palette, updating live when the
  dropdown or the colony palette pool changes.

The row title is the name, or "Cat N" while the name is empty.

GNOME: `Adw.ExpanderRow` per cat inside an `Adw.PreferencesGroup`, with an
`Adw.EntryRow` for the name, an `Adw.ComboRow` for the palette, and an
`Adw.ActionRow` holding the spin button and Auto switch. Commits write the
three arrays with `set_strv` / `set_value("ai")`.

Windows: generated in `settings.ts` by a `catRows()` builder mirroring the
existing `positions()` builder; commits go through `cats.apply`.

## 2. Sprite previews

### Shared

A pure function in `src/core/sprites.ts`:

```ts
previewFrames(manifest: SpriteManifest, palette: string, animation = "walk"): string[]
```

returning the manifest-relative frame paths (`<palette>/walk_<n>.svg`), falling
back to `idle` when the animation is missing. Both platforms feed these to a
platform-local player that advances one frame every 125 ms (8 fps, fixed; not
tied to the animation-fps setting).

Previews stop their timers when the containing window is hidden or destroyed.

### GNOME

`src/platform/gnome/preview.ts`: a `SpritePreview` class wrapping a
`Gtk.Picture` sized 48x48 logical pixels, given the extension path and a
palette. It loads frames as `Gdk.Texture` from file, cycles them on a
`GLib.timeout_add`, and exposes `setPalette(name)` and `destroy()`. Prefs run in
a GTK process without the shell, so it must not touch St or Clutter. The frame
timer is removed on `unrealize`.

### Windows

`src/platform/win32/renderer/preview.ts`: a `SpritePreview` wrapping an `<img>`
whose `src` cycles through `../../../assets/cats/<path>`. Uses the manifest the
preload already exposes via `cats.manifest()`. Frames are preloaded with
`decode()` once per palette and shared between previews. The timer pauses on
`visibilitychange`.

### Placement

- One preview to the left of each fur palette toggle.
- One preview in each per-cat row, showing `resolveCatPalette(...)`.

## 3. Hide/show hotkey

### Storage

| Property | Key | Type | Default |
|---|---|---|---|
| `toggleHotkey` | `toggle-hotkey` | `as` | `['<Control><Alt>c']` |

GTK accelerator syntax is canonical because `Main.wm.addKeybinding` requires an
`as` key in that format. An empty list means unbound. On Windows the JSON file
holds the same list; `normalizeSettings` keeps only the first string entry and
drops anything that does not parse.

### Core: `src/core/hotkey.ts`

Pure functions, unit tested:

- `parseAccelerator(s): Accel | null` with `Accel = { ctrl, alt, shift, super, key }`
  where `key` is a lower-case GDK key name (`c`, `f9`, `space`, ...). Returns
  `null` for junk.
- `formatAccelerator(a): string` gives the GTK form, modifiers in the fixed
  order `<Control><Alt><Shift><Super>`.
- `toElectronAccelerator(a): string` gives e.g. `Ctrl+Alt+C`, `Ctrl+Shift+F9`,
  `Super+Space`. Covers letters, digits, function keys, and the punctuation and
  navigation keys Electron names.
- `acceleratorFromKeyEvent({ key, code, ctrlKey, altKey, shiftKey, metaKey }): Accel | null`
  for the Windows capture UI. Returns `null` for a bare modifier press.
- `describeAccelerator(a): string` gives a human label (`Ctrl + Alt + C`) for
  both UIs.

### Behaviour

A runtime `hidden` flag, never persisted. Toggling it:

- **GNOME** (`extension.ts`): registers the keybinding with
  `Main.wm.addKeybinding(key, settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, handler)`
  in `enable()` and removes it in `disable()`. GNOME re-reads the key when the
  setting changes, so no extra plumbing. While hidden, `_tick` hides the layer,
  releases every shaken icon, skips `colony.update`, and runs at
  `DROWSY_INTERVAL_MS`.
- **Windows** (`main.ts`): registers `globalShortcut` on start and re-registers
  when `toggleHotkey` changes; unregisters on quit. While hidden the overlay
  window is hidden regardless of taskbar state, pointer samples stop, and a new
  `cats:visible` IPC message tells the renderer to skip `colony.update` (its
  `requestAnimationFrame` loop keeps `last` fresh so no dt jump on return). The
  tray menu gains a **Hide cats** checkbox mirroring the flag.

  If registration fails (another app owns the combination) the failure is
  logged and exposed as `hotkeyError: string | null` on `SettingsDescription`;
  the settings window re-invokes `describe()` after applying a hotkey change and
  shows the message under the row.

### Capture UI

Both platforms: an action row titled "Hide or show the cats", showing the
current combination via `describeAccelerator` or "Not set". A **Change** button
puts the row into a "Press the new shortcut..." state; Escape cancels, Backspace
clears to unbound, any other key with at least one modifier commits. A bare key
without a modifier is refused (GNOME would otherwise steal it globally).

- GNOME: `Gtk.EventControllerKey` on a small `Adw.Dialog`; the combination is
  built with `Gtk.accelerator_name(keyval, mods)` then normalised through
  `parseAccelerator` so the stored form matches core.
- Windows: `keydown` listener on the settings document while capturing, run
  through `acceleratorFromKeyEvent`.

## 4. Files touched

| Area | Files |
|---|---|
| Core | `src/core/config.ts`, `src/core/colony.ts`, `src/core/sprites.ts`, new `src/core/hotkey.ts` |
| Schema | `src/schemas/org.gnome.shell.extensions.taskbar-cats.gschema.xml` |
| GNOME | `src/platform/gnome/prefs.ts`, `src/platform/gnome/extension.ts`, new `src/platform/gnome/preview.ts` |
| Windows | `src/platform/win32/main.ts`, `ipc.ts`, `preload.ts`, `renderer/overlay.ts`, `renderer/settings.ts`, `renderer/settings.html`, new `renderer/preview.ts` |
| Tests | `tests/core/config.test.ts`, `colony.test.ts`, `sprites.test.ts`, new `hotkey.test.ts`; `tests/platform/gnome/extension.test.ts`; `tests/platform/win32/config.test.ts`, `preload.test.ts` |
| Docs | `README.md` settings table, `docs/windows.md` |

## 5. Testing

- Unit: normalization of the three lists and the hotkey; `resolveCatPalette`
  for set, auto, unknown, and empty-pool cases; `previewFrames` including the
  idle fallback; accelerator parse/format/Electron round trips and key-event
  conversion; schema drift test extended to the four new keys; GNOME extension
  stub test covering hide (layer hidden, shaken icons released) and show (layer
  shown); Windows `changedKeys` for the new arrays.
- Manual on a Windows machine via `npm run win:dev`: per-cat rows update the
  overlay live; previews animate and pause when the window is hidden; the hotkey
  toggles and the tray item follows; changing the hotkey re-registers; a clash
  shows the error text.
- `npm run check` must pass.

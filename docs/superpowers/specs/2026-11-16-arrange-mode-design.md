# Arrange mode: drag the furniture into place on the real taskbar

Date: 2026-11-16
Status: draft. The feature request is Patrik's ("some drag and drop … to place
and position all different objects"). The details below are Claude's calls
and are waiting for review. Each one is marked *(call)*.

Implementation: [the arrange-mode plan](../plans/2026-11-16-arrange-mode.md).
It builds on food bowls and `bowl-positions` (PR #14).

## Goal

Placing beds, scratching posts and food bowls should be as easy as dragging
them. You turn on **arrange mode**, drag each piece of furniture along the
floor where it stands next to the real dock or taskbar icons, and turn it off
again. The positions you drop them at are saved in the settings that exist
today (`bed-positions`, `scratcher-positions`, `bowl-positions`), so nothing
about how positions are stored or applied changes.

## Non-goals

- Dragging cats, the mouse, or anything off the floor line. Furniture moves
  sideways only.
- New position storage. A drop writes a percentage of the floor, exactly what
  the settings rows write.
- Replacing the settings rows. They stay for precise numbers *(call)*.

## Anti-goals

- **Getting in the way.** Outside arrange mode nothing changes: the overlay
  stays click-through on both platforms. Inside arrange mode only the
  furniture and a small toolbar take the mouse. The rest of the dock and the
  desktop keep working *(call: a full-screen modal grab was the alternative;
  it is simpler but a stuck grab locks the whole desktop)*.
- **A mode you can get stuck in.** Arrange mode always ends on any of these:
  - the toolbar's **Done** button;
  - the settings switch (GNOME) or tray item (Windows);
  - 120 s without a press on the furniture *(call)*;
  - the hide hotkey, or the overview opening;
  - the dock or taskbar going away;
  - the extension being disabled or the app quitting.

  A GNOME Shell restart never starts in arrange mode.
- **Accidental pins.** A click without a drag changes nothing. A press only
  becomes a drag after the pointer has moved 4 px *(call)*.

## Behaviour

### Turning it on and off

- **GNOME:** a switch row **Arrange on screen** under *Furniture and toys* in
  the preferences, bound to a new boolean key `arrange-mode`. The extension
  watches it. The extension sets it back to false whenever arrange mode ends,
  and on enable.
- **Windows:** a checkbox item **Arrange furniture** in the tray menu, and an
  **Arrange on screen…** button in the settings window's furniture section.
  Main owns the state and tells the overlay.
- Arrange mode needs at least one prop. With none, turning it on shows the
  toolbar with the hint "Add a bed, post or bowl first" *(call)*.

### While arranging

- Every prop is outlined, and a pinned prop shows a small pin above it
  *(call: done with a style class on GNOME and a CSS class on Windows; no new
  sprite)*.
- A toolbar stands centred above the floor. It reads "Drag the furniture.
  Double-click one to place it automatically." and has two buttons:
  **Reset all** and **Done**.
- **Dragging** a prop moves it along the floor with the pointer, kept inside
  the roam range the way pinned props already are. On release its position is
  saved as a whole-number percentage of the floor. The other automatic props
  then lay themselves out around it, as they do today.
- **Double-clicking** a prop (two presses within 0.4 s, no drag) sets its
  position back to automatic.
- **Reset all** sets every bed, post and bowl back to automatic.
- Cats carry on as normal. A cat asleep in a bed that is dragged follows the
  bed. The furniture is drawn under the cats, but a press always reaches the
  furniture: cats never take the mouse.
- If the props are rebuilt mid-drag (a count changed in the settings), the
  drag is dropped and nothing is saved.

## Settings summary

| Key | Type | Default | Where | Shown as |
|---|---|---|---|---|
| `arrange-mode` | b | false | GNOME only, runtime flag | Arrange on screen |

`arrange-mode` is not a user preference. It is how the preferences process
asks the shell to arrange. It is declared in `src/core/config.ts` as
`ARRANGE_KEY`, next to `HOTKEY_KEY`, and is not part of `Settings`.

## Testing

- The drag logic (hit testing, the drag threshold, double-click, percentages,
  which list to write, the timeout) lives in `src/core/arrange.ts` and is
  unit-tested on plain Node.
- The GNOME extension tests drive arrange mode through the faked settings,
  `global.get_pointer()` and prop actor events.
- Windows: the preload test covers the new channels. The renderer and main
  are checked by `npm run typecheck` and CI, because the Electron binary isn't
  installed on the development machine.
- Manual on both platforms:
  - drag every kind of prop;
  - double-click one;
  - Reset all;
  - check that dock and taskbar clicks next to and under the furniture still
    work during arrange mode and after it ends.

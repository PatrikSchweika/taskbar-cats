# Playful cats: play, food bowls, name tags and petting

Date: 2026-11-16
Status: draft. The feature list is Patrik's. The behaviour details below are
Claude's calls, made while writing the plan, and are waiting for review. Each
one is marked *(call)*.

Implementation: one plan per feature, buildable in any order:
[cat play](../plans/2026-11-16-cat-play.md),
[food bowls](../plans/2026-11-16-food-bowls.md),
[name tags](../plans/2026-11-16-name-tags.md) and
[petting](../plans/2026-11-16-petting.md). Hover is shared by name tags and
petting, and the rub gesture by petting and food bowls. Each plan that needs
one of these carries the same task for it and skips it if it already exists.

## Goal

Four additions that make the colony feel more alive between mouse visits:

1. **Cats play with each other.** Two idle cats sometimes chase each other,
   play-fight or groom.
2. **Food bowls and simple hunger.** Bowls stand on the floor beside the beds
   and posts. Cats get hungry over time, walk to a bowl and eat. Empty bowls
   are refilled by the user.
3. **Name tags on hover.** Holding the pointer over a cat shows its name
   above it.
4. **Petting.** Rubbing the pointer back and forth over a cat makes it purr.

Both platforms get all four. Behaviour lives in `src/core/`, so the GNOME
extension and the Windows app share it. Each platform only adds a way to draw
a text label.

## Non-goals

- Clicking on cats. The overlay stays click-through on both platforms
  (`reactive: false` on GNOME, `setIgnoreMouseEvents` on Windows). Every new
  interaction works by hovering.
- Climbing, jumping, or anything else that moves a cat off the floor line.
- Saving hunger or bowl contents across restarts. A restart fills every bowl.
- Positions for bowls in the settings. Bowls are laid out automatically
  *(call: beds and posts have position rows; bowls can get them later)*.
- A sound for purring or eating.

## Anti-goals

- **Guilt.** Hunger never harms a cat and never stops any other behaviour.
  A cat with an empty bowl asks for a while, then gives up and carries on.
  Without bowls (the default) there is no hunger at all.
- **Getting in the way.** Name tags, hearts and hovering must never block a
  click on the dock or taskbar. Nothing becomes reactive.
- **Spam.** Play is a regular sight but not constant (about once every 20
  seconds of idle colony time, a sixth of the cats' time or so). A cat that
  just played rests for 8 seconds before playing again.

## Behaviour

### What a cat does, in priority order

Each tick a cat does the first of these that applies:

1. **Hunt** a mouse (unchanged). A mouse interrupts everything below,
   including eating, playing and purring. A meal cut short does not use up
   any food.
2. **Purr** while being petted.
3. **Hold still** while the pointer is over it (it sits up and looks at the
   pointer). This keeps the cat under the pointer long enough to read its
   tag or pet it. Without this, the existing fan-out around the pointer
   would walk the cat away *(call)*.
4. **Eat** when hungry and a bowl has food. **Ask** when hungry and every
   bowl is empty.
5. **Watch the pointer** (unchanged attraction behaviour).
6. **Sleep** (unchanged, beds included).
7. **Play** when the colony has paired it up with another cat.
8. **Wander and scratch** (unchanged).

Hunger outranks sleep on purpose. If the user walks away, a hungry cat still
eats first and naps after.

### Hover and the name tag

- A cat is *hovered* when the pointer is inside its sprite square: from
  `x − size/2` to `x + size/2`, and from `floorY − size` to `floorY`. If cats
  overlap, the one drawn on top (last in the colony) wins.
- The tag appears after 0.4 s of hover and disappears 0.8 s after the pointer
  leaves *(call)*. It shows one tag at a time.
- The text is the cat's name from the existing per-cat name setting. An empty
  name shows as "Cat N". Names stop being "for the settings only". The text
  is shown literally (never as markup). Names longer than 24 characters are
  cut to 24 plus "…" *(call)*.
- The tag sits 2 px above the top of the cat, centred on it.
- The setting **Show names on hover** (`name-tags`, default on) turns it off.

### Petting

- **The gesture:** at least 3 changes of horizontal direction within 1.2 s,
  with the pointer over the same cat the whole time. Each stroke must travel
  at least 15% of the cat's size, so jitter doesn't count *(call)*.
- **The response:** while the rubbing continues, and for 1.5 s after the last
  stroke, the cat sits still with its eyes closed and a small red heart
  floating above its head (the new `purr` animation). Then it goes back to
  what it was doing.
- A sleeping cat wakes when rubbed. Moving the pointer already wakes the
  colony, so this needs no special case.
- There is no setting. The gesture is too deliberate to happen by accident
  *(call)*.

### Play

The colony pairs up cats. A cat is **free** when its last tick ended in IDLE,
SIT, WALK or RUN (a wandering cat cruises fast enough to show RUN), with no
mouse, no pointer interest, no sleepiness, no hunger, no hover and no petting.

- **Starting:** each second, with probability 0.2, the colony picks two free
  cats within 8 cat sizes of each other that are not resting after a game.
  Only a cat with such a partner can be picked first.
  They start one of three games, chosen at random: chase 40%, tussle 35%,
  groom 25%.
- **Chase** (4 to 7 s): the lead runs at the other cat at full speed, and the
  other runs away from it. When the lead gets within 0.4 cat sizes it has
  tagged the other cat, and the two swap roles. After a swap there is a 1 s
  pause before the next tag can count. A fleeing cat cornered at a screen
  edge turns and dashes past the chaser. Both use the existing walk and run
  animations.
- **Tussle** (2.5 to 4 s): the two walk towards each other. Once they are
  within 0.7 sizes, both rear up facing each other and swat (new `play`
  animation).
- **Groom** (4 to 6 s): the lead walks to stand 0.6 sizes from the other cat,
  facing it, and grooms it (new `groom` animation). The other cat sits facing
  the lead (existing `sit` animation).
- **Ending:** a game ends when its time is up, or as soon as either cat stops
  being free. Then both cats rest from play for 8 s.
- The two cats in a game don't push each other apart, which the existing
  separation rule would otherwise do.
- The setting **Cats play together** (`cats-play`, default on) turns games
  off. Turning it off ends any game in progress.

### Hunger and bowls

- **Hunger** is a number per cat that rises from 0 to 1 over **Hungry after**
  seconds (`hunger-after`, default 1800, range 60 to 14400). At 1 or more the
  cat is hungry. Each cat starts with a random value below 0.5, so they
  don't all get hungry at once. Hunger only rises when the colony has at
  least one bowl.
- A **bowl** is a new prop kind. **Food bowls** (`bowl-count`, default 0,
  range 0 to 8) sets how many. Bowls are laid out with the beds and posts in
  the order bed, post, bowl, repeating.
- A bowl holds 3 portions and starts full. It has three frames: empty (0),
  low (1) and full (2 or 3).
- **Eating:** a hungry cat claims the nearest bowl that has food and that no
  other cat has claimed (like beds). It walks to stand 0.45 sizes beside the
  bowl, facing it, and eats (new `eat` animation) for 4 s. Then the bowl
  loses one portion, the cat's hunger resets to 0, and it gives the bowl up.
- **Asking:** a hungry cat with no food anywhere walks to the nearest bowl
  and sits beside it, looking up (existing `alert` animation), for 8 s. Then
  it ignores its hunger for 60 s before asking again.
- **Refilling:** the user rubs the pointer over a bowl, using the same
  gesture as petting. This fills that bowl to 3 *(call: the same gesture
  everywhere works on both platforms with no new UI; a tray item or hotkey
  was the alternative)*.

## Drawing

### New sprite frames (generated by `tools/gen-sprites.ts`)

| Name | Base pose | Frames | Notes |
|---|---|---|---|
| `purr` | sitting | 2 | eyes closed, ears relaxed, a red heart above the head that rises one pixel in frame 1 |
| `groom` | sitting | 2 | head dipped towards the chest, eyes half-closed then closed |
| `play` | scratching (reared) | 3 | paws swat forwards at reach 0.2, 0.9, 0.5 |
| `eat` | standing | 2 | crouched, head down to the floor, bobbing |
| `bowl` (prop) | — | 3 | a low dish, empty / low / full of kibble |

The heart needs a colour no palette has. Add a cell `H`, which always
renders as `#e5484d`.

### The name tag

A new view kind, `LabelView`, is added beside `CatView`. Each platform
implements it:

- **GNOME:** an `St.Label` with the style class `taskbar-cats-tag`
  (`reactive: false`) on the cat layer, raised above the cats whenever it
  is shown.
- **Windows:** a `<div class="tag">` in a container stacked above `#stage`.
  It has `pointer-events: none` and its text is set with `textContent`,
  never `innerHTML`, because names are user input.
- **Look on both:** white 12 px system font on `rgba(20, 20, 20, 0.8)`, a
  4 px corner radius, 1 px by 6 px padding, no wrapping.
- **Windows:** the overlay strip is only `taskbar + 128 + 24` px tall. That
  leaves no room for a tag above a 128 px cat, so the strip grows by 24 px.

## Settings summary

| Key | Type | Default | Range | Shown as |
|---|---|---|---|---|
| `cats-play` | b | true | | Cats play together |
| `name-tags` | b | true | | Show names on hover |
| `bowl-count` | i | 0 | 0–8 | Food bowls |
| `hunger-after` | i | 1800 | 60–14400 | Hungry after (seconds) |

All four go in the shared tables in `src/core/config.ts` and the GSettings
schema. The Windows settings window builds its rows from those tables. The
GNOME preferences put the two switches under **Behaviour** and the two
numbers under **Furniture and toys**.

## Testing

- Core behaviour is unit-tested on plain Node with the existing fakes
  (`FakeCatView`, `fakeHost`, `withRandom`). That covers the gesture
  detector, hover and tag timing, each game, eating, asking, refilling, and
  the priority order.
- The sprite checks in `tests/assets.test.ts` cover the new frames.
- On GNOME, `npm run test:shell` / `npm run dev` give a manual check. On
  Windows, CI covers it, because the Electron binary isn't installed on the
  development machine.

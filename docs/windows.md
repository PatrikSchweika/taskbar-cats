# Ubuntu Cats on Windows

The same cats, the same physics, a different way of getting them on screen.

On GNOME this is a shell extension, because that is the only way to reach the
dock's icons. Windows will not load code into `explorer.exe`, so the Windows
backend is an Electron app that owns a click-through, always-on-top strip along
the bottom of the taskbar's monitor and draws the cats there. The taskbar's own
buttons can be *found* — UI Automation reports their bounds — but nothing
outside `explorer.exe` can animate them.

## What is the same

Everything about a cat. `src/core/` is shared verbatim: the state machine,
steering, neighbour avoidance, wander bias, sleeping, palette cycling,
auto-sizing against the dock, and the settings and their ranges. The sprite
frames are the same SVG files. A cat behaves identically on both platforms, and
a change to how it behaves changes both at once.

## What is different

| | GNOME | Windows |
|---|---|---|
| How it runs | Shell extension, in-process | Electron overlay window + native helper |
| Finding icons | Duck-typed dash actor tree | UI Automation over `Shell_TrayWnd` |
| Icon geometry | The drawn icon, in stage px | The whole taskbar button, in DIP |
| Icon shake while clawing | Yes | **No** — see below |
| Settings | GSettings + Adw prefs dialog | `settings.json` + a settings window |
| Hidden when | Overview open, dock auto-hidden, monitor fullscreen | Taskbar auto-hidden, foreground window covers a monitor |
| Multi-monitor | The dock's monitor | The primary taskbar's monitor only |

### The icon shake is not implemented

On GNOME the extension runs inside the shell, so it can rock the dock's own icon
actor while a cat claws it, and put it back untouched afterwards. A taskbar
button belongs to `explorer.exe`; an outside process cannot animate it.

The cats still walk to an icon and play the full scratch animation — the icon
just does not move. The `wiggle-icons` setting appears in the settings window,
explained and disabled, rather than silently doing nothing.

Faking it by drawing a copy of the icon in the overlay and shaking that was
considered and rejected: it needs pixel-perfect alignment with a control that
animates on hover, reflows on launch, and restyles with the theme.

### Only a bottom taskbar gets scratched

A cat decides it is under an icon by comparing x positions only — it walks the
floor, so that is all it needs. With the taskbar up a side or along the top, the
icons are nowhere near the floor and the cats would claw at empty carpet
underneath them. With a left, right or top taskbar the cats therefore roam and
nap as usual and no icons are reported.

## Prerequisites

| Need | Why |
|---|---|
| Windows 10 21H2+ or Windows 11 | UI Automation exposes the taskbar buttons |
| Node 22.18+ (24 recommended) | Same as the rest of the repo |
| Visual Studio Build Tools with the *Desktop development with C++* workload | Compiles the taskbar helper |
| Python 3 | `node-gyp` needs it |

The C++ toolchain is only needed for the taskbar helper. Without it, everything
else still builds and runs — the cats roam the bottom of the screen and ignore
your icons. The app says so on startup and in the settings window.

## Build and run

```bash
npm install
npm run win:dev
```

`win:dev` builds the native helper, compiles the overlay, and launches Electron.
The cats appear along the bottom of the screen and a cat appears in the
notification area; right-click it for settings, autostart and quit.

The pieces separately:

```bash
npm run win:native
```

```bash
npm run win:build
```

```bash
npm run win:clean
```

## How it fits together

```
native/win32-shell/          C++ N-API addon. Reports facts, decides nothing:
                             SHAppBarMessage for the taskbar rect and auto-hide
                             state, UI Automation for every button on the bar,
                             GetCursorPos, and whether the foreground window
                             covers its monitor.

src/platform/win32/
  native.ts                  Types the addon and survives its absence.
  taskbarTracker.ts          All the policy: which buttons are app icons,
                             physical-to-DIP conversion, when to draw at all.
                             Pure functions over plain data, so it is unit
                             tested on any OS against fixtures.
  config.ts                  settings.json, keyed as the GSettings schema is.
  main.ts                    The Electron main process: the overlay window,
                             the tray, the settings window, and the polling.
  renderer/                  Runs the shared simulation and draws it.
```

Main polls the cheap things (cursor, fullscreen) every 33ms and the expensive
one (UI Automation, which is a cross-process call per property) every 500ms. It
sends the renderer a layout and pointer samples; the renderer runs `Colony` and
`Cat` — the same code the extension runs — at the display's refresh rate,
dropping to 4Hz once every cat is asleep.

### Why an overlay strip and not a fullscreen window

The cats only ever occupy the bottom of the screen, so the window is only that
tall: taskbar height plus the tallest a cat can be plus head-room. A
click-through window covering the whole screen would work, but it is the kind of
thing that gets blamed for unrelated input problems.

### Why the renderers are served from a `cats://` scheme

Chromium will not load an ES-module `<script>` over `file://` — the document's
origin is opaque, so the module request fails CORS — and both renderers are ES
modules importing the shared core. Main therefore registers `cats:` as a
standard, secure scheme and serves the compiled output through it. That also
makes `'self'` mean something in the pages' content-security policies, and the
handler refuses any path that resolves outside the bundle.

### Why the preload is CommonJS

Electron only allows an ES-module preload when the renderer's sandbox is turned
off. The sandbox is worth more than the module syntax, so the preload is built
separately by `tsconfig.win32.preload.json` into a directory with its own
`package.json` declaring `"type": "commonjs"`.

## Verification checklist

The tracker's decisions, the config store, the icon writers and all of the cat
physics are unit-tested and run on any OS (`npm test`). What follows is
everything a test cannot see, because it needs a real taskbar. Run it on both
Windows 10 and Windows 11 if you can — the taskbar was rewritten between them
and the icon-finding code takes a different path on each.

### The overlay itself

- [ ] Cats appear along the bottom of the screen within a second of launch.
- [ ] They are drawn **in front of** the taskbar, not behind it.
- [ ] Clicking straight through a cat activates whatever is underneath — a
      taskbar button, a desktop icon, a window.
- [ ] Hovering a taskbar button through a cat still shows its preview and
      tooltip.
- [ ] Right-clicking the desktop through a cat opens the desktop context menu.
- [ ] The overlay does not appear in Alt+Tab.
- [ ] The overlay does not appear as a taskbar button of its own.
- [ ] Win+D (show desktop) does not leave the cats behind on a blank screen in
      the wrong place.

### Following the taskbar

- [ ] Cats size themselves to roughly your taskbar's icon size when
      **Cat size** is 0.
- [ ] Pinning **Cat size** to 72 makes them visibly larger, immediately.
- [ ] Launching an app adds an icon the cats will walk to and claw within a few
      seconds (watch for the scratch animation).
- [ ] Closing an app while a cat is clawing its icon does not throw; the cat
      goes back to idling.
- [ ] Turning on **Automatically hide the taskbar** hides the cats while the bar
      is hidden, and brings them back when it slides up.
- [ ] Moving the taskbar to the left edge: cats still roam the bottom of the
      screen and stop clawing.
- [ ] Moving it back to the bottom restores clawing.

### Displays

- [ ] On a HiDPI display (150% or 200% scaling) the cats' feet sit exactly on
      the bottom edge of the screen — not half sunk, not floating.
- [ ] At 200% scaling they are the same *apparent* size as at 100%, and cross
      the screen in about the same time.
- [ ] Changing the scaling while it runs repositions them within a second.
- [ ] With two monitors, the cats are on the one with the primary taskbar.
- [ ] Unplugging that monitor does not crash the app; the cats reappear on the
      remaining one.

### Getting out of the way

- [ ] A maximised window does **not** hide the cats (the taskbar is still
      visible, so they should be too).
- [ ] A fullscreen video (YouTube fullscreen) hides them.
- [ ] A fullscreen game hides them, and they come back on Alt+Tab out.
- [ ] While hidden, the app's CPU use drops to roughly nothing.

### Settings and lifecycle

- [ ] Every slider takes effect immediately, without a restart.
- [ ] **Mouse attraction** at 0 makes them ignore the pointer entirely.
- [ ] Moving the pointer to the bottom of the screen draws them to it, and they
      sit and look up at it when it stops.
- [ ] Leaving the pointer still for longer than **Nap after** puts them all to
      sleep, and moving it wakes them.
- [ ] **Shake the icon being clawed** is visible but disabled, with the reason.
- [ ] Deselecting all fur palettes gives you all of them, not none.
- [ ] Settings survive a restart of the app.
- [ ] Hand-editing `settings.json` to nonsense and restarting gives defaults,
      not a crash.
- [ ] **Start with Windows** survives a reboot.
- [ ] **Quit** from the tray leaves no `electron.exe` behind.
- [ ] Launching a second copy does not produce a second colony.

### Without the native helper

Delete `native/win32-shell/build/` and run `npm run win:build && npx electron
build-win32/platform/win32/main.js`:

- [ ] The app starts.
- [ ] It logs why the taskbar helper is missing.
- [ ] The settings window shows the warning.
- [ ] Cats roam the bottom of the screen and never claw anything.

## Not done yet

- **Packaging.** There is no installer or `.exe` yet; it runs from source. The
  app icon (`src/assets/icons/app.ico`) is generated and ready for whatever
  packager is chosen.
- **Secondary taskbars.** `SHAppBarMessage` reports the primary taskbar only, so
  a second monitor's taskbar is not tracked. `Shell_SecondaryTrayWnd` is the
  window class to enumerate for that.
- **Keyboard idle.** Sleeping is driven by pointer stillness on both platforms,
  which is what makes the behaviour identical. `GetLastInputInfo` would let
  typing keep the cats awake on Windows, at the cost of that parity.

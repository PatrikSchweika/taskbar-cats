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
| Hidden when | Overview open, dock auto-hidden, monitor fullscreen | Taskbar auto-hidden, a window has covered its monitor for ¾ s |
| When the bar is above everything | n/a | Cats climb onto the taskbar — see below |
| Multi-monitor | The dock's monitor | The primary taskbar's monitor only |

### The taskbar can be above everything

Windows keeps top-level windows in *z-bands*. A window in a higher band is
above every window in a lower one, `HWND_TOPMOST` or not, and ordinary apps
can only create windows in the lowest. The Windows 11 taskbar lives in that
band most of the time — which is what lets the overlay sit on it — but Windows
lifts it into a higher band while a menu is open, and it has been observed to
stay up there indefinitely. Nothing an Electron app can do reaches it then.

So the overlay watches the bands (through `GetWindowBand`, undocumented but
exported since Windows 8) and, once the taskbar has been above it for a
second, moves the cats' floor to the taskbar's top edge: they stand on the
bar, still pawing at the icons below. The moment the bar drops back, so do
they. A menu opening still covers them for the length of its animation; that
is a Windows limitation, and hopping for it would look worse than it does.

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

## Install

Download the latest release and run it. Nothing else is needed — no Node, no
Visual Studio, no Python. The native taskbar helper is compiled by CI and ships
inside the package.

| File | What it is |
|---|---|
| `Ubuntu Cats Setup <version>.exe` | Installs for the current user only, so there is **no administrator prompt**. Adds a Start-menu entry and an uninstaller, and starts the cats when it finishes. |
| `Ubuntu Cats-<version>-win-x64.zip` | The same app, unzipped wherever you like. No Start-menu entry, no uninstaller. |

Right-click the cat in the notification area for settings, autostart and quit.

### Windows will warn you about it

The releases are **not code-signed**, so Windows shows *"Windows protected your
PC"* the first time you run the installer. To continue: **More info** → **Run
anyway**.

That warning is honest — it means Windows cannot confirm who built this, and you
should only click through it if you trust the source. Signing it would need a
certificate on a hardware token or a cloud signing service, which is a running
cost this project does not have. If that changes, the warning goes away with no
change to the app itself.

### Where your settings live

`%APPDATA%\Ubuntu Cats\settings.json`, keyed exactly as the GNOME version's
GSettings schema is. It survives upgrades, and the tray menu can open it.
Uninstalling leaves it behind; delete it by hand if you want it gone.

## Prerequisites

| Need | Why |
|---|---|
| Windows 10 21H2+ or Windows 11 | UI Automation exposes the taskbar buttons |
| Node 22.18+ (24 recommended) | Same as the rest of the repo |
| Visual Studio Build Tools with the *Desktop development with C++* workload | Compiles the taskbar helper — see below |
| Python 3 | `node-gyp` needs it |

The C++ toolchain is only needed for the taskbar helper, and only when building
from source: released packages ship it prebuilt. Without it, everything else
still builds and runs — the cats roam the bottom of the screen and ignore your
icons. The app says so on startup and in the settings window. So if all you want
is to run the app, [install a release](#install) instead and skip this section
entirely: the toolchain is a 2–7GB download.

### Installing the C++ toolchain

The quickest way, which needs no clicking through an installer:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools"
```

```powershell
winget install Python.Python.3.12
```

`--wait` looks optional and is not: without it winget returns as soon as the
*Visual Studio installer* is installed, long before Visual Studio itself has
finished, and the next command then fails for no visible reason. Expect a UAC
prompt either way — Visual Studio Installer operations always require elevation.

By hand instead: [visualstudio.microsoft.com/downloads](https://visualstudio.microsoft.com/downloads/)
→ **All Downloads** → **Tools for Visual Studio** → **Build Tools for Visual
Studio 2022**, then tick the **Desktop development with C++** workload
(`Microsoft.VisualStudio.Workload.VCTools`), which brings MSVC and the Windows
SDK with it. Python from [python.org/downloads](https://www.python.org/downloads/).

Build Tools, not the full Visual Studio IDE — the same compiler without the
editor.

For the arm64 cross-compile, add two more components:

```
Microsoft.VisualStudio.Component.VC.Tools.ARM64
Microsoft.VisualStudio.Component.VC.ATL.ARM64
```

Do **not** use `npm install --global windows-build-tools`. It is long deprecated
and broken on current Node, and it is still what much of the older advice on the
internet recommends. node-gyp's own scripted alternative is Chocolatey:
`choco install python visualstudio2022-workload-vctools -y`.

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
                             GetCursorPos, and the foreground window's class,
                             rect and monitor.

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

## Packaging

```bash
npm run win:native
```

```bash
npm run win:pack
```

`win:pack` refuses to run without the taskbar helper, on purpose: a package
built without it would install cats that silently ignore the taskbar, and the
loader is deliberately good at surviving that — so nobody would notice. Output
lands in `dist/win32/`.

Add `-- --arch=arm64` to either command for Windows on ARM. That cross-compiles,
so it needs the [ARM64 MSVC components](#installing-the-c-toolchain) installed;
the release workflow treats an arm64 failure as non-fatal so it cannot withhold
the x64 build.

Configuration is [`electron-builder.yml`](../electron-builder.yml). Four things
in it are worth knowing about:

- **`directories.buildResources` and `directories.output` are both overridden.**
  They default to `build/` and `dist/`, which this repository already uses for
  the GNOME extension and its packed zip. Left alone, electron-builder would
  read the extension's compiled output as installer resources and write
  installers over the zip.
- **The helper is `extraResources`, not `asarUnpack`.** A `.node` file has to be
  a real file on disk for `LoadLibrary` to open it, so it cannot live inside
  `app.asar`. Unpacking would also work; a plain file in `resources/` is one
  fewer layer.
- **`directories.app` is `build-win32`**, so the packaged app is exactly what
  `win:build` emitted, with the `package.json` that build generates. That
  manifest is what makes the app identical when run from source and when
  installed — `productName` included, which is what decides where settings live.
- **`NAPI_VERSION` is pinned to 8** in
  [`binding.gyp`](../native/win32-shell/binding.gyp). The helper is compiled
  once and then runs under whatever Electron a release bundles; N-API only
  guarantees that for a version the runtime actually supports, so leaving it to
  node-addon-api's default would make compatibility a matter of luck.

A release is cut by pushing a `v*` tag. `.github/workflows/release.yml` builds
each architecture, checks that `win32_shell.node` really is in the output, and
attaches the installers to a GitHub release. It also runs on
`workflow_dispatch`, which packages and uploads workflow artifacts without
creating a release — useful for exercising the packaging without cutting one.

### About the size

Roughly 85MB to download and 210MB installed, which is Electron. There is no
configuration that meaningfully changes that; it would take a native rewrite of
the renderer, and at that point the C#/WPF approach that was considered and
rejected for this port becomes the better trade.

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
- [ ] A fullscreen game hides them, and they come back on Alt+Tab out —
      on top of the taskbar, not behind it.
- [ ] Opening a taskbar menu — the clock, the tray overflow, quick settings,
      the Start menu — does **not** hide them. Those are monitor-sized shell
      windows, and the cats must tell them from a game. (They may be covered by
      the bar itself for the length of the menu's animation; see above.)
- [ ] If the taskbar stays above the overlay (`GetWindowBand` reports it in a
      higher band), the cats appear standing on top of it within a second, and
      drop back onto it when it returns.
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

### The packaged app

Everything above is worth re-checking from an installer rather than from source,
because the addon is loaded from a different path and the app is launched by a
different executable. Specifically:

- [ ] The installer runs without an administrator prompt.
- [ ] The app starts by itself when the installer finishes.
- [ ] Cats appear, and they can see the taskbar icons — this is what proves the
      prebuilt helper was found at `resources/win32_shell.node`.
- [ ] The settings window's warning about the helper is **absent**.
- [ ] The Start-menu entry launches it.
- [ ] **Start with Windows** survives a reboot when installed (the login item
      points at the installed executable, not at `electron.exe`).
- [ ] Settings written before an upgrade are still there after one.
- [ ] The uninstaller removes the app and leaves no process behind.
- [ ] The portable zip works unzipped to a path containing a space and a
      non-ASCII character.

### Without the native helper

Delete `native/win32-shell/build/` and run `npm run win:build && npx electron
build-win32/platform/win32/main.js`:

- [ ] The app starts.
- [ ] It logs why the taskbar helper is missing.
- [ ] The settings window shows the warning.
- [ ] Cats roam the bottom of the screen and never claw anything.

## Not done yet

- **Code signing.** Releases are unsigned, so users meet a SmartScreen warning
  once. Azure Trusted Signing is the cheapest route that works from CI now that
  OV certificates require a hardware token or cloud HSM; nothing about the app
  changes when it is added.
- **Auto-update.** Deliberately left out. `electron-updater` would add a runtime
  dependency and periodic network calls to a desktop toy; worth it once there
  are users who would benefit.
- **Secondary taskbars.** `SHAppBarMessage` reports the primary taskbar only, so
  a second monitor's taskbar is not tracked. `Shell_SecondaryTrayWnd` is the
  window class to enumerate for that.
- **Keyboard idle.** Sleeping is driven by pointer stillness on both platforms,
  which is what makes the behaviour identical. `GetLastInputInfo` would let
  typing keep the cats awake on Windows, at the cost of that parity.

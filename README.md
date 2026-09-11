# Taskbar Cats

Small pixel-art cats that live on your dock or taskbar. They chase your mouse
pointer, sit and look up at it, nap when you ignore them, and scratch your app
icons. You can give them beds and scratching posts. Now and then a mouse runs
across the screen and every cat goes after it.

It runs on two platforms:

- **Ubuntu / GNOME** (GNOME Shell 45 to 50) as a shell extension. On GNOME the
  scratched icon really shakes.
- **Windows** as a small app that draws the cats over the taskbar. The icons
  cannot shake there, because the taskbar belongs to Windows. See
  [docs/windows.md](docs/windows.md).

![six fur colours across seven animations](docs/sprites.png)

## Install

### Windows

Download `Taskbar-Cats-<version>-windows-x64-setup.exe` from the
[releases page](https://github.com/PatrikSchweika/taskbar-cats/releases) and
run it. No admin rights are needed. The app updates itself. Windows will warn
you that the file is not signed. Click **More info**, then **Run anyway**.

Right-click the cat icon in the notification area for settings and to quit.

### Ubuntu / GNOME

Download `Taskbar-Cats-<version>-gnome-shell-extension.zip` from the
[releases page](https://github.com/PatrikSchweika/taskbar-cats/releases), then:

```bash
gnome-extensions install --force Taskbar-Cats-*-gnome-shell-extension.zip
```

Now restart GNOME Shell. On X11 press <kbd>Alt</kbd>+<kbd>F2</kbd>, type `r`,
press <kbd>Enter</kbd>. On Wayland log out and back in. Then enable it:

```bash
gnome-extensions enable taskbar-cats@patrikschweika.github.io
```

To open the settings:

```bash
gnome-extensions prefs taskbar-cats@patrikschweika.github.io
```

The extension does not update itself. To update, install the new zip the same
way and restart the shell again.

If GNOME says the extension "does not exist", the shell has not seen it yet.
Restart the shell first, then enable it.

## Settings

All settings apply at once. No restart is needed.

| Setting | Default | What it does |
|---|---|---|
| Cats | 3 | How many cats (1 to 8) |
| Each cat: name | Cat N | A label for the settings only |
| Each cat: fur palette | Auto | This cat's fur colour. Auto takes its turn through every palette |
| Each cat: size | Auto | This cat's size in pixels (16 to 128). Auto matches the dock icons |
| Mouse attraction | 60 | How strongly cats chase the pointer. 0 turns it off |
| Attraction radius | 260 | How far from the bottom of the screen the pointer still matters |
| Top speed | 160 | Pixels per second when running |
| Nap after | 20 | Seconds without movement before a cat sleeps. 0 keeps them awake |
| Hide or show the cats | Ctrl+Alt+C | A keyboard shortcut that hides every cat and brings them back. Works in any program. Clear it to turn it off |
| Scratch app icons | on | Cats stop at an icon and claw it |
| Shake the scratched icon | on | GNOME only. Moves the real dock icon |
| Cat beds | 0 | Beds next to the dock (0 to 8). Sleepy cats walk to a free bed |
| Scratching posts | 0 | Posts next to the dock (0 to 8). Cats claw these instead of icons |
| Bed / post positions | Auto | Where each bed or post stands, as a percent of the screen width |
| Mouse visits | 120 | Seconds between mice. 0 means no mice |
| Animation frame rate | 12 | Sprite frames per second |

The settings show a small animated preview of what each cat will wear.

## Build from source

You need Node 22.22.2 or newer. Everything in the project is TypeScript,
including the build tools and the sprite generator.

```bash
git clone https://github.com/PatrikSchweika/taskbar-cats.git
cd taskbar-cats
npm install
```

| Command | What it does |
|---|---|
| `npm run check` | Lint, type-check, validate, and run all tests |
| `npm test` | Run the unit tests |
| `npm run ext:install` | Build and install the GNOME extension for the current user |
| `npm run ext:enable` / `ext:disable` / `ext:prefs` | Turn the extension on or off, or open its settings |
| `npm run ext:pack` | Build the extension zip into `dist/` |
| `npm run win:dev` | Windows only. Build and run the Windows app |
| `npm run win:pack` | Windows only. Build the installer and a portable zip into `dist/win32/` |
| `npm run sprites` | Regenerate the cat art |
| `npm run test:shell` | Run a hidden GNOME Shell for testing without touching your desktop |
| `npm run dev` | Run a nested GNOME Shell in a window |

GNOME caches extension code, so after every change you need a full shell
restart. `npm run test:shell` and `npm run dev` avoid that.

## How it is built

- `src/core/` holds everything shared by both platforms: cat behaviour, the
  colony, beds, posts, the mouse, and the settings.
- `src/platform/gnome/` finds the dock and draws the cats inside GNOME Shell.
- `src/platform/win32/` finds the taskbar buttons and draws the cats in an
  Electron overlay on Windows.
- `tools/gen-sprites.ts` generates all the art as SVG. The output is committed,
  so installing needs no tools.
- `tests/` mirrors `src/`. The tests run on plain Node with small stubs for the
  GNOME APIs, and they run on any OS.

## Releasing

Bump `version` in `package.json`, commit, then push a matching tag:

```bash
git tag v1.4.0
git push origin v1.4.0
```

GitHub Actions builds the Windows installer, the portable zip, and the GNOME
extension zip, and attaches them all to the release.

## Licence

MIT.

# Taskbar Cats on Windows

The same cats as on GNOME, drawn over the Windows taskbar.

On GNOME the cats run inside the shell as an extension. Windows does not allow
that, so on Windows the cats are a small Electron app. It opens a thin,
click-through window along the bottom of the screen and draws the cats there. A
native helper tells it where the taskbar and its buttons are.

## What is the same

All cat behaviour. The code in `src/core/` is shared, so a cat acts the same on
both platforms. The settings and the sprite art are the same too.

## What is different

| | GNOME | Windows |
|---|---|---|
| Runs as | Shell extension | Electron app plus a native helper |
| Finds icons with | The dock's actor tree | UI Automation on the taskbar |
| Icon shakes when clawed | Yes | No |
| Settings stored in | GSettings | `%APPDATA%\Taskbar Cats\settings.json` |
| Cats hide when | Overview open, dock hidden, fullscreen | Taskbar hidden, or a fullscreen window covers the screen |
| Monitors | The dock's monitor | The primary taskbar's monitor only |

**Icons do not shake on Windows.** The taskbar belongs to Windows and another
program cannot move its buttons. The cats still walk to an icon and claw it, but
the icon stays still. The setting is shown in the settings window but disabled.

**Only a bottom taskbar gets scratched.** The cats walk along the bottom of the
screen. If your taskbar is on the top, left, or right, the cats still roam and
sleep, but they do not claw any icons.

## Install

Download the latest release from the
[releases page](https://github.com/PatrikSchweika/taskbar-cats/releases). You
do not need Node or any build tools.

| File | What it is |
|---|---|
| `Taskbar-Cats-<version>-windows-x64-setup.exe` | The installer. Use this one. It installs for your user only, so there is no admin prompt. It adds a Start menu entry and an uninstaller, and it updates itself. |
| `Taskbar-Cats-<version>-windows-x64-portable.zip` | The same app in a zip. Unzip it anywhere. No Start menu entry, no uninstaller, no updates. |
| `...-windows-arm64-...` | For Windows on ARM. These do not update themselves. The x64 installer also works on ARM through emulation and is usually the better choice. |
| `latest.yml`, `*.blockmap` | Not for you. The installed app uses these to find and download updates. |
| `Taskbar-Cats-<version>-gnome-shell-extension.zip` | The GNOME version. Not for Windows. |

After installing, right-click the cat icon in the notification area for
settings, autostart, updates, and quit.

### Windows will warn you

The releases are not code-signed, so Windows shows "Windows protected your PC"
the first time you run the installer. Click **More info**, then **Run anyway**.
Only do this if you trust this repository. Signing costs money the project does
not have.

### Updating

The installed app checks GitHub for a new release when it starts and every six
hours after that. It downloads the update in the background and then asks if you
want to restart now. If you choose **Later**, the update installs the next time
you quit the app.

To check by hand, right-click the tray cat and choose **Check for updates…**.
The tray menu also shows the running version.

The portable zip and the ARM64 builds do not update themselves. The tray menu
tells you so. Download a new file instead.

### Your settings

Settings live in `%APPDATA%\Taskbar Cats\settings.json`. They survive updates,
and the tray menu can open the file. Uninstalling leaves the file behind.

Before 1.3.0 the app was called Ubuntu Cats. Installing 1.3.0 over 1.2.0 upgrades
it in place and copies your old settings across.

## Build from source

You need:

- Windows 10 21H2 or newer, or Windows 11
- Node 22.18 or newer
- Visual Studio Build Tools 2022 with the **Desktop development with C++**
  workload. Only the native helper needs this.
- Python 3, because `node-gyp` needs it

The quick way to get the C++ tools and Python:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools"
```

```powershell
winget install Python.Python.3.12
```

Keep the `--wait` flag. Without it winget returns before Visual Studio has
finished installing. For ARM64 builds, also add the `VC.Tools.ARM64` and
`VC.ATL.ARM64` components.

Do not use `npm install --global windows-build-tools`. It is old and broken.

Then:

```bash
npm install
npm run win:dev
```

This builds the native helper, compiles the app, and starts it.

| Command | What it does |
|---|---|
| `npm run win:native` | Build the native taskbar helper |
| `npm run win:build` | Compile the app into `build-win32/` |
| `npm run win:dev` | Both of the above, then run the app |
| `npm run win:pack` | Build the installer and portable zip into `dist/win32/` |
| `npm run win:clean` | Remove the build output |

Add `-- --arch=arm64` to `win:native` or `win:pack` for Windows on ARM.

If the native helper is missing, the app still runs. The cats roam the bottom of
the screen but cannot see any icons, and the settings window says why.
`win:pack` refuses to run without the helper, so a release can never ship this
way by accident.

## How it fits together

```
native/win32-shell/     C++ addon. Reports the taskbar position, whether it is
                        auto-hidden, every button on it, the cursor position,
                        and the foreground window. It makes no decisions.

src/platform/win32/
  native.ts             Loads the addon and copes when it is missing.
  taskbarTracker.ts     Decides which buttons are app icons, converts pixels
                        to DIP, and decides when to draw. Pure functions, so
                        it is unit-tested on any OS.
  config.ts             Reads and writes settings.json.
  updater.ts            Checks for and installs updates.
  main.ts               The Electron main process: overlay window, tray,
                        settings window, polling.
  renderer/             Runs the shared cat simulation and draws it.
```

The main process polls the cursor and the foreground window every 33 ms, and
the taskbar buttons every 500 ms. The renderer runs the cats at the display's
refresh rate and drops to 4 Hz when all cats are asleep.

Some choices worth knowing:

- **A thin strip, not a fullscreen window.** The cats only use the bottom of
  the screen, so the window is only that tall.
- **Pages are served from a `cats://` scheme.** Chromium will not load ES
  modules from `file://`, so the app registers its own scheme.
- **The preload is CommonJS.** Electron only allows an ES-module preload with
  the sandbox off, and the sandbox is worth more.
- **The native helper is an `extraResources` file, not inside `app.asar`.**
  Windows needs a real file on disk to load a `.node` addon.

## Packaging

Configuration is in [electron-builder.yml](../electron-builder.yml). Output and
resource folders are changed from the defaults so they do not collide with the
GNOME build, which already uses `build/` and `dist/`.

A release is made by pushing a `v*` tag. GitHub Actions builds x64 and ARM64,
checks that the native helper is in the output, and attaches everything to the
release. An ARM64 failure does not block the x64 release.

The installer is about 180 MB and the portable zip about 130 MB. That is the
size of Electron, and no setting changes it much.

## Not done yet

- **Code signing.** Releases are unsigned, so users see a SmartScreen warning.
- **Second-monitor taskbars.** Only the primary taskbar is tracked.
- **Keyboard idle.** Cats sleep when the pointer is still, even if you are
  typing. This matches GNOME.

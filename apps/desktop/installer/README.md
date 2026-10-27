# Windows installer

The Windows installer lets the user tick which apps to install. Everything else (macOS, Linux) is
still the one all-in-one app, built from the `build` block of `package.json`.

    npm -w apps/desktop run build:win         # apps, installer and portable build (publishes on a tag)

What happens:

1. `build/build-split.mjs` builds the shell and one folder per app (`dist/desktop/split`).
2. `installer/stage.mjs` stages the main process with only its own dependencies, so no app code is
   inside `app.asar`.
3. `installer/gen-apps-nsh.mjs` writes `apps.generated.nsh`, the list of apps from their manifests.
4. `electron-builder --config electron-builder.win.cjs` packs it. The NSIS installer holds every app;
   `installer.nsh` adds the checklist page and copies only the ticked ones to
   `resources/apps/<id>`. The portable build puts all of them in.

## Behaviour

- One app ticked: standalone. Start menu and desktop shortcuts, window title and tray carry that
  app's name (`productName`) and icon (`modules/<id>/assets/icon.ico`); no sidebar for an app with
  one screen; Settings from the gear in the title bar.
- Two or more: the combined "NexusMD" with a tab per app.
- Running the installer again starts from what is installed. Ticking another app turns a standalone
  install into the combined one; unticking removes the app. Data stays in `%APPDATA%\NexusMD`.
- Updates (`--updated`) skip the page and keep what is installed. All apps update together.
- Silent installs: `Setup.exe /S /APPS=git,editor` (or `/APPS=all`). Without `/APPS`, a first silent
  install takes every app.

## Trying the installer on a machine that has NexusMD

    NEXUSMD_INSTALLER_TEST=1 NEXUSMD_WIN_TARGET=nsis npx electron-builder --win --config electron-builder.win.cjs --publish never

That build has its own app id and name ("NexusMD Installer Test"), so it does not replace or share
registry entries with a real install. Start the installed exe with `--user-data-dir=<temp>` so it
leaves the real data alone, and remove it with its `Uninstall ... .exe /S _?=<folder>`.

Icons: `node scripts/create-app-icons.cjs` regenerates the placeholder per-app icons (the NexusMD
mark in a hue per app); replace a module's `assets/icon.*` with real artwork when there is some.

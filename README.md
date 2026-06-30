# NexusMD

Single application, multiple platforms — consolidated monorepo. Shared headless
logic and React UI are factored into packages; each platform is a thin app that
consumes them.

## Layout

```text
packages/
  core/          @nexusmd/core         headless domain logic + adapter contracts (no React/DOM)
  ui/            @nexusmd/ui           shared React components, CSS tokens, shared views
  web-adapters/  @nexusmd/web-adapters browser adapters shared by web/desktop/app
apps/
  app/           Capacitor / Android (mobile)
  desktop/       Electron (Windows / macOS / Linux)
  web/           browser frontend (Vite) + ASP.NET host (server/) + xUnit tests (server-tests/)
dist/            build output (web/, desktop/)
```

The three `packages/*` are consumed as source through npm workspaces — there is
nothing to build for them separately. A single root `npm install` symlinks every
workspace so apps always pick up local changes.

## Prerequisites

| Tool                     | Version | Needed for                                       |
|--------------------------|---------|--------------------------------------------------|
| Node.js                  | ≥ 20    | everything                                       |
| .NET SDK                 | 8.0     | web backend (`apps/web/server`)                  |
| Android Studio + JDK 17  | latest  | mobile release builds                            |
| Electron build toolchain | —       | desktop release (native: build on the target OS) |

```bash
npm install        # one install links all workspaces
npm test           # all unit + contract tests (vitest)
npm run build      # build every workspace that defines a build script
```

The `*.ps1` files under each app are legacy Windows convenience wrappers; some
still reference the pre-rename `NexusMD-Web` path. Prefer the `npm` / `dotnet`
commands documented below.

---

## Web (`apps/web`)

Vite-built React SPA served by an ASP.NET (net8.0) host. In dev the Vite server
(`:5173`) proxies `/api` to the API (`:5100`); the production build emits the SPA
into `server/wwwroot`, so the API serves everything from one process.

### Dev build

Run the two processes (two terminals, from the repo root):

```bash
dotnet run --project apps/web/server      # API on http://localhost:5100
npm -w apps/web run dev                    # Vite on http://localhost:5173
```

Open **http://localhost:5173**.

### Release build

```bash
npm -w apps/web run build                                   # SPA -> apps/web/server/wwwroot
dotnet publish apps/web/server -c Release -o dist/web        # self-contained host -> dist/web
```

Run the result with `dist/web/NexusMDWeb.Api` (`.exe` on Windows). Configuration lives in `apps/web/server/appsettings*.json`.

---

## Desktop (`apps/desktop`)

Electron shell (`electron/main.cjs`) with a Vite-built renderer. Packaged with
electron-builder; auto-update via electron-updater.

### Dev build

```bash
npm -w apps/desktop run dev      # Vite renderer on http://localhost:5173
npm -w apps/desktop start        # launch Electron against the dev server
```

(Or the Windows wrapper `apps/desktop/Start-Dev.ps1`, which starts both.)

### Cloud sign-in (Google Drive / OneDrive)

The desktop app signs in to Google Drive and OneDrive itself using the OAuth PKCE + loopback flow in the Electron main process — no backend and no client secret. You need public **client IDs** from each provider:

- **Google:**
  1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Application type **Desktop app**.
  2. Loopback redirects are allowed automatically (no redirect URI to register).
  3. Enable the Drive API and add the `drive.file`, `email`, and `openid` scopes on the OAuth consent screen.
  4. Add yourself as a test user if the app is in Testing.

- **Microsoft (OneDrive):**
  1. Azure Portal → App registrations → New registration.
  2. Under **Authentication** → Add a platform → **Mobile and desktop applications**, add redirect URI `http://localhost`, and set **Allow public client flows** to **Yes**.
  3. Supported account types must include **Personal Microsoft accounts**.
  4. Under **API permissions**, add delegated Microsoft Graph `Files.ReadWrite`, `offline_access`, `openid`, and `email`.

Put the resulting client IDs in `apps/desktop/electron/ipc/oauth-config.cjs` (they are public, not secrets), or set the `NEXUSMD_GOOGLE_DESKTOP_CLIENT_ID` and `NEXUSMD_MS_DESKTOP_CLIENT_ID` environment variables before launching.

### Release build

Native packaging — build on the OS you are targeting:

```bash
npm -w apps/desktop run build:win      # NSIS installer + portable (x64)
npm -w apps/desktop run build:mac      # dmg + zip (x64)
npm -w apps/desktop run build:linux    # AppImage (x64)
npm -w apps/desktop run build          # current OS, default target
```

Installers land in **`dist/desktop/`**. `build:*` runs the Vite renderer build
(`dist/renderer`) first, then electron-builder. Regenerate app icons with
`npm -w apps/desktop run icons`. Release publishing is configured for the
GitHub provider (`Knownexus/NexusMD-Desktop`).

`apps/desktop/Build-Release.ps1 -Platform win|mac|linux` wraps the above.

---

## Mobile (`apps/app`)

Capacitor wrapper around the same React app, targeting Android. Vite builds the
web layer into `www`; Capacitor syncs it into the native Android project.

### Dev build

Iterate on the web layer in the browser:

```bash
npm -w apps/app run dev          # Vite dev server
```

To run on a device/emulator, build and open the native project in Android Studio:

```bash
npm -w apps/app run android      # Vite build -> Cap sync -> Cap open Android
```

Then Run ▶ from Android Studio (or `cd apps/app/android && ./gradlew installDebug`).

### Release build

1. `npm -w apps/app run build` then `npx -w apps/app cap sync android` to refresh
   the native project with the latest web build.
2. Produce a signed artifact (requires a configured keystore):

   ```bash
   cd apps/app/android
   ./gradlew assembleRelease     # signed APK  -> app/build/outputs/apk/release
   ./gradlew bundleRelease       # AAB (Play)  -> app/build/outputs/bundle/release
   ```

   Or use Android Studio → **Build → Generate Signed Bundle / APK**. App id is
   `com.knownexus.nexus`.

---

## Tests

```bash
npm test                          # all Vitest unit + adapter-contract tests
npm run test:e2e:web              # Playwright (web)
npm run test:e2e:desktop          # Playwright (desktop renderer)
dotnet test apps/web/server-tests # ASP.NET backend (xUnit)
```

## Build output reference

| Platform | Command                                                       | Output                                  |
|----------|---------------------------------------------------------------|-----------------------------------------|
| Web      | `npm -w apps/web run build` + `dotnet publish … -o dist/web`  | `dist/web/`                             |
| Desktop  | `npm -w apps/desktop run build:<os>`                          | `dist/desktop/`                         |
| Mobile   | `./gradlew assembleRelease` / `bundleRelease`                 | `apps/app/android/app/build/outputs/`   |

# Building and Publishing NexusMD

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 20 | Use `.nvmrc` — `nvm use` |
| .NET SDK | 8.0 | Web app host |
| Android SDK | API 33+ | App only — via Android Studio |
| Java | 17 | App only — required by Gradle |

## Setup

```bash
npm install          # installs and links all workspaces
npm test             # unit tests (packages/core, packages/ui, packages/web-adapters)
dotnet test apps/web/NexusMDWeb.sln    # backend xUnit tests
```

---

## Web

### Development

```bash
# Option A — PowerShell helper (starts Vite + dotnet in parallel)
pwsh apps/web/Start-Dev.ps1

# Option B — manually
npm -w apps/web run dev                           # Vite dev server → http://localhost:5173
cd apps/web/server && dotnet run                  # ASP.NET backend → http://localhost:5100
```

The Vite dev server proxies `/api/*` to the .NET backend at `:5100`.

**Configuration** — copy `appsettings.json` to `appsettings.user.json` and fill in:

| Key | Description |
|-----|-------------|
| `Ado:Pat` | Azure DevOps Personal Access Token |
| `Ado:Organisation` | ADO org name |
| `Google:ClientId` / `Google:ClientSecret` | Google OAuth app (Drive scope) |
| `GitHub:ClientId` / `GitHub:ClientSecret` | GitHub OAuth app |
| `Profiles:DbPath` | SQLite path for profile registry (default `profiles.db`) |
| `Audit:DbPath` | SQLite path for audit log (default `audit.db`) |

### Build

```bash
npm -w apps/web run build        # Vite → apps/web/server/wwwroot
```

The .NET Release build runs this automatically via the `BuildFrontend` MSBuild target.

### Publish

```bash
dotnet publish apps/web/server/NexusMDWeb.Api.csproj -c Release -o dist/web
```

Output: `dist/web/` — self-contained ASP.NET host with embedded SPA.

**CI:** push a tag matching `web-v*` (e.g. `web-v1.2.3`) — GitHub Actions builds and attaches artifacts to the release.

### E2E tests

```bash
npm -w apps/web run e2e          # Playwright against vite preview server
```

---

## Desktop (Electron)

### Development

```bash
npm -w apps/desktop run dev      # Vite renderer dev server → http://localhost:5173
npm -w apps/desktop run start    # launch Electron against dist/renderer (after a build)
```

### Build

```bash
# Renderer only
npm -w apps/desktop run build:renderer

# Full platform packages (renderer + electron-builder)
npm -w apps/desktop run build:win     # NSIS installer + portable .exe → dist/desktop/
npm -w apps/desktop run build:mac     # DMG + ZIP → dist/desktop/
npm -w apps/desktop run build:linux   # AppImage → dist/desktop/
```

### Publish

Electron-builder publishes to GitHub Releases using `GH_TOKEN`.

**CI:** push a tag matching `v*` (e.g. `v1.2.3`) — GitHub Actions builds Windows, macOS, and Linux in parallel and publishes all artifacts to the release.

**Manual publish:**

```bash
GH_TOKEN=<token> npm -w apps/desktop run build:win    # or :mac / :linux
```

Releases go to `github.com/Knownexus/NexusMD-Desktop`. Auto-update checks that repo on startup.

### E2E tests

```bash
npm -w apps/desktop run e2e      # Playwright with Electron driver
```

---

## App (Android / Capacitor)

### Development

```bash
npm -w apps/app run dev          # Vite dev server → http://localhost:5173
                                 # (proxies /api to :5100 — run web backend alongside)
```

To run on a device or emulator:

```bash
npm -w apps/app run android      # vite build → cap sync → opens Android Studio
```

Then run the app from Android Studio.

### Build

```bash
# 1. Build the web bundle
npm -w apps/app run build                         # Vite → apps/app/www/

# 2. Sync to Android project
cd apps/app && npx cap sync android

# 3. Build APK
cd apps/app/android && ./gradlew assembleDebug
```

Debug APK output: `apps/app/android/app/build/outputs/apk/debug/app-debug.apk`

For a release build, configure signing in `apps/app/android/app/build.gradle` then:

```bash
cd apps/app/android && ./gradlew assembleRelease
```

**Production API URL** — set before building:

```
# apps/app/.env.production
VITE_API_BASE=https://your-api.example.com
```

### E2E tests (nightly)

Requires a running Android emulator and Appium server — see `apps/app/e2e/README.md` for setup.

```bash
npm -w apps/app run e2e:android
```

---

## CI summary

| Trigger | Workflow | What runs |
|---------|----------|-----------|
| Push / PR to `master` | `ci.yml` | Unit tests, backend tests, all builds, web + desktop e2e |
| Tag `v*` | `release-desktop.yml` | Desktop builds (Win/Mac/Linux) → GitHub Release |
| Tag `web-v*` | `release-web.yml` | `dotnet publish` → GitHub Release artifact |
| Nightly 03:00 UTC | `e2e-android.yml` | Android APK build + Appium smoke tests |

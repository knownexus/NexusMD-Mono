# Profile Cloud Sync (Google Drive + OneDrive) — Phases 4–5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the cloud profile-sync built in Phases 1–3 (web) to the **desktop (Electron)** and **app (Capacitor/Android)** platforms, so both can connect Google Drive / OneDrive and save/restore encrypted `.nmdprofile` bundles.

**Architecture:** Reuse the shared `@nexusmd/ui` provider factories (`makeGoogleDriveProvider`/`makeOneDriveProvider`) and the `BackupRestoreCard` `cloudProviders` prop unchanged. Add a backend **one-time-code (OTC)** OAuth flow so native apps — which can't receive secrets and shouldn't carry tokens in raw redirect URLs — open the system browser to the web backend, which brokers the token exchange and hands the native app a short-lived code to redeem. Desktop captures the redirect via its existing `nexusmd://` custom-protocol handler; the app captures it via a Capacitor deep link (new native config).

**Tech Stack:** ASP.NET (net8.0) controllers + `IMemoryCache` (already registered); xUnit + `WebApplicationFactory`. JS ESM; `@capacitor/app` (new dep) for app deep links; Electron custom-protocol IPC (existing). Reuses Phases 1–3: provider factories, `BackupRestoreCard`, `ITokenExchanger`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-29-profile-cloud-sync-design.md`. Phases 1–3 plan (done): `docs/superpowers/plans/2026-06-29-profile-cloud-sync-phase-1-3.md`.
- Bundle format/crypto unchanged; cloud is transport only. Files in a user-visible `/NexusMD` folder; scopes `drive.file` / `Files.ReadWrite` (already set in the Phase-2 controllers).
- Manual push/pull only. Client secrets never leave the backend; tokens never appear in a raw redirect URL — native apps receive a one-time code and POST it to the backend to redeem tokens.
- The OTC is single-use, short-TTL (120s), stored server-side in `IMemoryCache`, and bound to its provider.
- `returnUri` values (the native redirect target) are validated against a server allow-list (`OAuth:NativeReturnPrefixes`, default `nexusmd://`, `http://127.0.0.1`).
- `authBinding` contract (consumed by the shared factories, identical to Phase 3): `{ isConnected(): boolean, connect(): Promise<void>, disconnect(): Promise<void>, getToken({ force } = {}): Promise<string|null> }`.
- Token storage per-profile localStorage, keyed via each platform's `getProfileKey`: `nexusmd.p.<id>.gdrive.auth` / `.onedrive.auth` (desktop), `helm.p.<id>.gdrive.auth` / `.onedrive.auth` (app) = `{ accessToken, refreshToken, email? }`.
- Reuse Phase-3's `cloud-auth.js` shape (PROVIDERS map, read/write/clear, makeBinding) as the template for `desktop`/`app` `cloud-auth.js` — do not duplicate web's file; each platform gets its own with platform-specific `connect`/callback capture.
- Backend tests: `dotnet test apps/web/NexusMDWeb.sln` (file-lock MSB3027 → `tasklist | grep -i NexusMD`, `taskkill //PID <pid> //F`, retry). JS/builds from repo root `C:/repos/NexusMD-Mono`.

---

## File Structure

**Phase 4 (backend OTC + desktop):**
- `apps/web/server/Services/OAuth/IOneTimeCodeStore.cs` + `MemoryOneTimeCodeStore.cs` — **new.** Store/redeem OTC → tokens in `IMemoryCache`.
- `apps/web/server/Controllers/GoogleAuthController.cs` + `MicrosoftAuthController.cs` — **modify.** Add `GET /native-url`, `GET /native-callback`, `POST /exchange`.
- `apps/web/server/Program.cs` — **modify.** Register `IOneTimeCodeStore`.
- `apps/web/server-tests/OAuthNativeFlowTests.cs` — **new.** OTC store + native endpoints.
- `apps/desktop/src/cloud-auth.js` — **new.** Desktop authBindings (system-browser connect + `nexusmd://` capture) + `desktopCloudProviders`.
- `apps/desktop/src/main.jsx` — **modify.** Pass `cloudProviders={desktopCloudProviders}` into `BackupRestoreCard`; wire the deep-link listener.
- `apps/desktop/electron/main.cjs` — **modify.** Add an `openExternal` IPC + ensure deep-link delivery (the protocol handler already exists).
- `apps/desktop/electron/preload.cjs` — **modify.** Expose `openExternal` + the existing `deepLink:url` channel.

**Phase 5 (app):**
- `apps/app/package.json` — **modify.** Add `@capacitor/app`.
- `apps/app/capacitor.config.json` — **modify.** Register the `nexusmd` custom scheme.
- `apps/app/android/app/src/main/AndroidManifest.xml` — **modify.** Add the `nexusmd://oauth` intent-filter.
- `apps/app/src/adapters/deepLink.js` — **modify.** Use `@capacitor/app` `appUrlOpen` when available.
- `apps/app/src/cloud-auth.js` — **new.** App authBindings (system-browser connect + deep-link capture, namespace `helm`) + `appCloudProviders`.
- `apps/app/src/views/view-settings.jsx` — **modify.** Pass `cloudProviders={appCloudProviders}` into `BackupRestoreCard`.

---

## Phase 4 — Backend one-time-code flow + desktop

### Task 1: One-time-code store + native OAuth endpoints

**Files:**
- Create: `apps/web/server/Services/OAuth/IOneTimeCodeStore.cs`, `apps/web/server/Services/OAuth/MemoryOneTimeCodeStore.cs`
- Modify: `apps/web/server/Controllers/GoogleAuthController.cs`, `apps/web/server/Controllers/MicrosoftAuthController.cs`, `apps/web/server/Program.cs`, `apps/web/server-tests/Infrastructure/TestFactory.cs`
- Test: `apps/web/server-tests/OAuthNativeFlowTests.cs`

**Interfaces:**
- Consumes: `ITokenExchanger` (Phase 2); `IMemoryCache` (already registered via `AddMemoryCache()`).
- Produces:
  - `IOneTimeCodeStore.Put(string provider, TokenPair tokens) → string code` and `Redeem(string provider, string code) → TokenPair?` where `TokenPair(string? AccessToken, string? RefreshToken)`.
  - `GET /api/{google|ms}/auth/native-url?returnUri=…` → `{ url }` (authorize URL whose OAuth `redirect_uri` is the backend's own `native-callback`, with `returnUri` carried in `state`).
  - `GET /api/{google|ms}/auth/native-callback?code=…&state=…` → 302 redirect to `returnUri?provider=<p>&otc=<code>`.
  - `POST /api/{google|ms}/auth/exchange` body `{ code }` → `{ accessToken, refreshToken }`.

- [ ] **Step 1: Write the failing test**

```csharp
// apps/web/server-tests/OAuthNativeFlowTests.cs
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using NexusMDWeb.Api.Services.OAuth;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests;

public class OAuthNativeFlowTests
{
    private sealed class FakeExchanger : ITokenExchanger
    {
        public Task<TokenResponse> ExchangeAsync(string endpoint, IDictionary<string, string> form)
            => Task.FromResult(new TokenResponse("at-native", "rt-native", 3600));
    }

    private static WebApplicationFactory<Program> WithFake(TestFactory f) =>
        f.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddSingleton<ITokenExchanger>(new FakeExchanger())));

    [Fact]
    public async Task NativeUrl_targets_backend_callback_and_carries_returnUri_in_state()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.GetAsync("/api/google/auth/native-url?returnUri=" + Uri.EscapeDataString("nexusmd://oauth/gdrive"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var url = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.GetProperty("url").GetString()!;
        Assert.Contains("accounts.google.com", url);
        Assert.Contains("native-callback", url);                 // redirect_uri is the backend
        Assert.Contains("state=", url);                          // returnUri carried in state
        Assert.DoesNotContain("test-google-secret", url);
    }

    [Fact]
    public async Task NativeUrl_rejects_a_returnUri_not_on_the_allow_list()
    {
        using var f = new TestFactory();
        var client = WithFake(f).CreateClient();
        var res = await client.GetAsync("/api/google/auth/native-url?returnUri=" + Uri.EscapeDataString("https://evil.example/steal"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Callback_redirects_to_returnUri_with_a_one_time_code_then_exchange_returns_tokens()
    {
        using var f = new TestFactory();
        var factory = WithFake(f);
        // Do not auto-follow the 302 so we can read the Location header.
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        // Build a state that encodes the returnUri (base64url of the raw returnUri).
        var returnUri = "nexusmd://oauth/gdrive";
        var state = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(returnUri))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

        var cb = await client.GetAsync($"/api/google/auth/native-callback?code=abc&state={state}");
        Assert.Equal(HttpStatusCode.Redirect, cb.StatusCode);
        var location = cb.Headers.Location!.ToString();
        Assert.StartsWith("nexusmd://oauth/gdrive", location);
        Assert.Contains("otc=", location);

        var otc = System.Web.HttpUtility.ParseQueryString(new Uri(location).Query)["otc"]!;
        var ex = await client.PostAsJsonAsync("/api/google/auth/exchange", new { code = otc });
        Assert.Equal(HttpStatusCode.OK, ex.StatusCode);
        var j = JsonDocument.Parse(await ex.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("at-native", j.GetProperty("accessToken").GetString());
        Assert.Equal("rt-native", j.GetProperty("refreshToken").GetString());

        // OTC is single-use: a second exchange fails.
        var ex2 = await client.PostAsJsonAsync("/api/google/auth/exchange", new { code = otc });
        Assert.Equal(HttpStatusCode.BadRequest, ex2.StatusCode);
    }
}
```

- [ ] **Step 2: Add the native-return allow-list to TestFactory**

In `apps/web/server-tests/Infrastructure/TestFactory.cs`, inside the `AddInMemoryCollection` dictionary, add:

```csharp
                ["OAuth:NativeReturnPrefixes:0"] = "nexusmd://",
                ["OAuth:NativeReturnPrefixes:1"] = "http://127.0.0.1",
```

- [ ] **Step 3: Run test to verify it fails**

Run: `dotnet test apps/web/NexusMDWeb.sln --filter OAuthNativeFlowTests`
Expected: FAIL — store/endpoints don't exist.

- [ ] **Step 4: Create the one-time-code store**

```csharp
// apps/web/server/Services/OAuth/IOneTimeCodeStore.cs
namespace NexusMDWeb.Api.Services.OAuth;

public record TokenPair(string? AccessToken, string? RefreshToken);

public interface IOneTimeCodeStore
{
    /// <summary>Store tokens, return a single-use code bound to the provider (TTL 120s).</summary>
    string Put(string provider, TokenPair tokens);
    /// <summary>Redeem and remove a code; null if missing/expired/wrong provider.</summary>
    TokenPair? Redeem(string provider, string code);
}
```

```csharp
// apps/web/server/Services/OAuth/MemoryOneTimeCodeStore.cs
using Microsoft.Extensions.Caching.Memory;
using System.Security.Cryptography;

namespace NexusMDWeb.Api.Services.OAuth;

public sealed class MemoryOneTimeCodeStore(IMemoryCache cache) : IOneTimeCodeStore
{
    private static string Key(string provider, string code) => $"otc:{provider}:{code}";

    public string Put(string provider, TokenPair tokens)
    {
        var code = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
        cache.Set(Key(provider, code), tokens, TimeSpan.FromSeconds(120));
        return code;
    }

    public TokenPair? Redeem(string provider, string code)
    {
        var k = Key(provider, code);
        if (cache.TryGetValue(k, out TokenPair? tokens)) { cache.Remove(k); return tokens; }
        return null;
    }
}
```

- [ ] **Step 5: Register the store in Program.cs**

In `apps/web/server/Program.cs`, right after the `ITokenExchanger` registration, add:

```csharp
builder.Services.AddSingleton<NexusMDWeb.Api.Services.OAuth.IOneTimeCodeStore,
                              NexusMDWeb.Api.Services.OAuth.MemoryOneTimeCodeStore>();
```

- [ ] **Step 6: Add the native endpoints to GoogleAuthController**

In `apps/web/server/Controllers/GoogleAuthController.cs`, change the primary constructor to also inject the store and the config-bound allow-list, and add three actions. Replace the class declaration line:

```csharp
public class GoogleAuthController(IConfiguration config, ITokenExchanger exchanger) : ControllerBase
```

with:

```csharp
public class GoogleAuthController(IConfiguration config, ITokenExchanger exchanger, IOneTimeCodeStore otc) : ControllerBase
```

Add these members inside the class (after the existing `Refresh` action). The shared helpers are written here once; the Microsoft controller (Step 7) gets its own copies bound to its endpoints/scope:

```csharp
    private const string NativeProvider = "google";

    private static string EncodeState(string returnUri)
        => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(returnUri))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static string DecodeState(string state)
    {
        var s = state.Replace('-', '+').Replace('_', '/');
        s = s.PadRight(s.Length + (4 - s.Length % 4) % 4, '=');
        return System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(s));
    }

    private bool ReturnUriAllowed(string returnUri)
    {
        var prefixes = config.GetSection("OAuth:NativeReturnPrefixes").Get<string[]>() ?? [];
        return prefixes.Any(p => returnUri.StartsWith(p, StringComparison.OrdinalIgnoreCase));
    }

    private string NativeRedirectUri()
        => $"{Request.Scheme}://{Request.Host}/api/google/auth/native-callback";

    [HttpGet("native-url")]
    public IActionResult NativeUrl([FromQuery] string returnUri)
    {
        var clientId = config["Google:ClientId"];
        if (string.IsNullOrWhiteSpace(clientId)) return BadRequest(new { error = "google oauth not configured" });
        if (string.IsNullOrWhiteSpace(returnUri) || !ReturnUriAllowed(returnUri))
            return BadRequest(new { error = "returnUri not allowed" });
        var q = new Dictionary<string, string>
        {
            ["client_id"]     = clientId,
            ["redirect_uri"]  = NativeRedirectUri(),
            ["response_type"] = "code",
            ["scope"]         = Scope,
            ["access_type"]   = "offline",
            ["prompt"]        = "consent",
            ["state"]         = EncodeState(returnUri),
        };
        var url = AuthEndpoint + "?" + string.Join("&",
            q.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
        return Ok(new { url });
    }

    [HttpGet("native-callback")]
    public async Task<IActionResult> NativeCallback([FromQuery] string code, [FromQuery] string state)
    {
        string returnUri;
        try { returnUri = DecodeState(state); } catch { return BadRequest(new { error = "bad state" }); }
        if (!ReturnUriAllowed(returnUri)) return BadRequest(new { error = "returnUri not allowed" });

        var t = await exchanger.ExchangeAsync(TokenEndpoint, new Dictionary<string, string>
        {
            ["code"]          = code,
            ["client_id"]     = config["Google:ClientId"] ?? "",
            ["client_secret"] = config["Google:ClientSecret"] ?? "",
            ["redirect_uri"]  = NativeRedirectUri(),
            ["grant_type"]    = "authorization_code",
        });
        if (string.IsNullOrEmpty(t.AccessToken))
            return StatusCode(502, new { error = "google did not return an access token" });

        var otcCode = otc.Put(NativeProvider, new TokenPair(t.AccessToken, t.RefreshToken));
        var sep = returnUri.Contains('?') ? "&" : "?";
        return Redirect($"{returnUri}{sep}provider=gdrive&otc={Uri.EscapeDataString(otcCode)}");
    }

    [HttpPost("exchange")]
    public IActionResult Exchange([FromBody] ExchangeRequest req)
    {
        var tokens = otc.Redeem(NativeProvider, req.Code);
        if (tokens is null) return BadRequest(new { error = "invalid or expired code" });
        return Ok(new { accessToken = tokens.AccessToken, refreshToken = tokens.RefreshToken });
    }
```

At the bottom of the file, after the existing `CallbackRequest`/`RefreshRequest` records, add:

```csharp
public record ExchangeRequest(string Code);
```

- [ ] **Step 7: Add the matching native endpoints to MicrosoftAuthController**

In `apps/web/server/Controllers/MicrosoftAuthController.cs`, change the constructor to inject the store:

```csharp
public class MicrosoftAuthController(IConfiguration config, ITokenExchanger exchanger, IOneTimeCodeStore otc) : ControllerBase
```

Add these members (after the existing `Refresh`). Note `provider=onedrive` in the redirect and `NativeProvider = "microsoft"`:

```csharp
    private const string NativeProvider = "microsoft";

    private static string EncodeState(string returnUri)
        => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(returnUri))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static string DecodeState(string state)
    {
        var s = state.Replace('-', '+').Replace('_', '/');
        s = s.PadRight(s.Length + (4 - s.Length % 4) % 4, '=');
        return System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(s));
    }

    private bool ReturnUriAllowed(string returnUri)
    {
        var prefixes = config.GetSection("OAuth:NativeReturnPrefixes").Get<string[]>() ?? [];
        return prefixes.Any(p => returnUri.StartsWith(p, StringComparison.OrdinalIgnoreCase));
    }

    private string NativeRedirectUri()
        => $"{Request.Scheme}://{Request.Host}/api/ms/auth/native-callback";

    [HttpGet("native-url")]
    public IActionResult NativeUrl([FromQuery] string returnUri)
    {
        var clientId = config["Microsoft:ClientId"];
        if (string.IsNullOrWhiteSpace(clientId)) return BadRequest(new { error = "microsoft oauth not configured" });
        if (string.IsNullOrWhiteSpace(returnUri) || !ReturnUriAllowed(returnUri))
            return BadRequest(new { error = "returnUri not allowed" });
        var q = new Dictionary<string, string>
        {
            ["client_id"]     = clientId,
            ["redirect_uri"]  = NativeRedirectUri(),
            ["response_type"] = "code",
            ["scope"]         = Scope,
            ["response_mode"] = "query",
            ["state"]         = EncodeState(returnUri),
        };
        var url = AuthEndpoint + "?" + string.Join("&",
            q.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
        return Ok(new { url });
    }

    [HttpGet("native-callback")]
    public async Task<IActionResult> NativeCallback([FromQuery] string code, [FromQuery] string state)
    {
        string returnUri;
        try { returnUri = DecodeState(state); } catch { return BadRequest(new { error = "bad state" }); }
        if (!ReturnUriAllowed(returnUri)) return BadRequest(new { error = "returnUri not allowed" });

        var t = await exchanger.ExchangeAsync(TokenEndpoint, new Dictionary<string, string>
        {
            ["code"]          = code,
            ["client_id"]     = config["Microsoft:ClientId"] ?? "",
            ["client_secret"] = config["Microsoft:ClientSecret"] ?? "",
            ["redirect_uri"]  = NativeRedirectUri(),
            ["grant_type"]    = "authorization_code",
            ["scope"]         = Scope,
        });
        if (string.IsNullOrEmpty(t.AccessToken))
            return StatusCode(502, new { error = "microsoft did not return an access token" });

        var otcCode = otc.Put(NativeProvider, new TokenPair(t.AccessToken, t.RefreshToken));
        var sep = returnUri.Contains('?') ? "&" : "?";
        return Redirect($"{returnUri}{sep}provider=onedrive&otc={Uri.EscapeDataString(otcCode)}");
    }

    [HttpPost("exchange")]
    public IActionResult Exchange([FromBody] ExchangeRequest req)
    {
        var tokens = otc.Redeem(NativeProvider, req.Code);
        if (tokens is null) return BadRequest(new { error = "invalid or expired code" });
        return Ok(new { accessToken = tokens.AccessToken, refreshToken = tokens.RefreshToken });
    }
```

(`ExchangeRequest` is declared in `GoogleAuthController.cs` — same namespace, do not redeclare. `AuthEndpoint`/`TokenEndpoint`/`Scope` are the Microsoft controller's existing members.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `dotnet test apps/web/NexusMDWeb.sln --filter OAuthNativeFlowTests`
Expected: 3 tests PASS.

Run: `dotnet test apps/web/NexusMDWeb.sln`
Expected: all PASS (30 prior + 3 new = 33).

- [ ] **Step 9: Commit**

```bash
git add apps/web/server/Services/OAuth apps/web/server/Controllers/GoogleAuthController.cs apps/web/server/Controllers/MicrosoftAuthController.cs apps/web/server/Program.cs apps/web/server-tests/OAuthNativeFlowTests.cs apps/web/server-tests/Infrastructure/TestFactory.cs
git commit -m "feat(web): one-time-code OAuth flow for native (app/desktop) cloud sign-in"
```

---

### Task 2: Desktop Electron OAuth bridge (open browser + deliver deep link)

**Files:**
- Modify: `apps/desktop/electron/preload.cjs`, `apps/desktop/electron/main.cjs`

**Interfaces:**
- Consumes: the existing `nexusmd://` protocol handler (`electron/ipc/deepLink.cjs`) which already sends `deepLink:url` to the renderer.
- Produces (on `window.electronAPI`): `openExternal(url): Promise<void>` and `onDeepLink(cb: (url:string)=>void): () => void`.

- [ ] **Step 1: Inspect the current preload surface**

Run: `grep -n "contextBridge\|deepLink\|openExternal\|shell" apps/desktop/electron/preload.cjs`
Expected: a `contextBridge.exposeInMainWorld('electronAPI', { ... })` block; likely no `openExternal` yet.

- [ ] **Step 2: Add `openExternal` IPC handler in main.cjs**

In `apps/desktop/electron/main.cjs`, add near the other `ipcMain.handle` calls (e.g. after the `save-file` handler):

```js
const { shell } = require('electron');
ipcMain.handle('open-external', async (_e, url) => { await shell.openExternal(url); });
```

(If `shell` is already destructured from `require('electron')` at the top, add `shell` there instead of re-requiring.)

- [ ] **Step 3: Expose `openExternal` + `onDeepLink` in preload.cjs**

In `apps/desktop/electron/preload.cjs`, inside the `electronAPI` object passed to `contextBridge.exposeInMainWorld`, add:

```js
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onDeepLink: (cb) => {
    const handler = (_e, url) => cb(url);
    ipcRenderer.on('deepLink:url', handler);
    return () => ipcRenderer.removeListener('deepLink:url', handler);
  },
```

- [ ] **Step 4: Verify the renderer build still succeeds**

Run: `npm -w apps/desktop run build:renderer`
Expected: SUCCESS (renderer doesn't import preload, but this confirms no syntax break in the build pipeline).

- [ ] **Step 5: Manual sanity (documented)**

The preload/main are Electron-only (not unit-tested here). Note in the report that `window.electronAPI.openExternal` and `onDeepLink` are now available; they're exercised by the e2e/manual smoke in Task 3.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/preload.cjs apps/desktop/electron/main.cjs
git commit -m "feat(desktop): expose openExternal + onDeepLink IPC for cloud OAuth"
```

---

### Task 3: Desktop cloud auth bindings + Settings mount

**Files:**
- Create: `apps/desktop/src/cloud-auth.js`
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Consumes: `getProfileKey` (`apps/desktop/src/profile-keys.js`); `makeGoogleDriveProvider`/`makeOneDriveProvider` (`@nexusmd/ui`); `window.electronAPI.openExternal`/`onDeepLink` (Task 2); backend native endpoints (Task 1).
- Produces: `desktopCloudProviders` array; a `registerCloudDeepLink()` that wires `onDeepLink` to the OTC exchange.

- [ ] **Step 1: Create `apps/desktop/src/cloud-auth.js`**

```js
// cloud-auth.js — desktop OAuth bindings for profile cloud sync (Drive + OneDrive).
// Desktop opens the system browser to the web backend's native-url; the backend
// redirects back via the nexusmd:// custom protocol with a one-time code, which
// the renderer redeems for tokens. Requires VITE_API_BASE to point at the host.
import { getProfileKey } from './profile-keys.js'
import { makeGoogleDriveProvider, makeOneDriveProvider } from '@nexusmd/ui'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://nexusmd.app'

const PROVIDERS = {
  gdrive:   { keySuffix: 'gdrive.auth',   api: '/api/google/auth', from: 'gdrive' },
  onedrive: { keySuffix: 'onedrive.auth', api: '/api/ms/auth',     from: 'onedrive' },
}

function read(suffix) {
  try { const k = getProfileKey('nexusmd.' + suffix); return k ? JSON.parse(localStorage.getItem(k) || 'null') : null }
  catch { return null }
}
function write(suffix, auth) {
  try { const k = getProfileKey('nexusmd.' + suffix); if (k) localStorage.setItem(k, JSON.stringify(auth)) } catch {}
}
function clear(suffix) {
  try { const k = getProfileKey('nexusmd.' + suffix); if (k) localStorage.removeItem(k) } catch {}
}

function makeBinding(key) {
  const cfg = PROVIDERS[key]
  return {
    isConnected: () => Boolean(read(cfg.keySuffix)?.accessToken),
    async connect() {
      try {
        const returnUri = `nexusmd://oauth/${cfg.from}`
        const res = await fetch(`${API_BASE}${cfg.api}/native-url?returnUri=${encodeURIComponent(returnUri)}`)
        if (!res.ok) return
        const { url } = await res.json()
        await window.electronAPI.openExternal(url)
      } catch {}
    },
    async disconnect() { clear(cfg.keySuffix) },
    async getToken({ force } = {}) {
      const auth = read(cfg.keySuffix)
      if (!auth?.accessToken) return null
      if (!force) return auth.accessToken
      try {
        const res = await fetch(`${API_BASE}${cfg.api}/refresh`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: auth.refreshToken }),
        })
        if (!res.ok) return null
        const { accessToken } = await res.json()
        write(cfg.keySuffix, { ...auth, accessToken })
        return accessToken
      } catch { return null }
    },
  }
}

// Map provider marker (?provider=gdrive|onedrive) to its config + storage suffix.
const BY_FROM = { gdrive: PROVIDERS.gdrive, onedrive: PROVIDERS.onedrive }

// Redeem the one-time code delivered via the nexusmd:// deep link.
async function redeem(url) {
  let u
  try { u = new URL(url) } catch { return }
  const params = u.searchParams
  const from = params.get('provider')
  const otc = params.get('otc')
  const cfg = from && BY_FROM[from]
  if (!cfg || !otc) return
  try {
    const res = await fetch(`${API_BASE}${cfg.api}/exchange`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: otc }),
    })
    if (!res.ok) return
    const { accessToken, refreshToken } = await res.json()
    write(cfg.keySuffix, { accessToken, refreshToken })
    window.location.reload()
  } catch {}
}

export function registerCloudDeepLink() {
  if (window.electronAPI?.onDeepLink) window.electronAPI.onDeepLink(redeem)
}

export const desktopCloudProviders = [
  makeGoogleDriveProvider(makeBinding('gdrive')),
  makeOneDriveProvider(makeBinding('onedrive')),
]
```

- [ ] **Step 2: Wire it into `main.jsx`**

In `apps/desktop/src/main.jsx`, add to the imports near `import { desktopFileIO } from './file-io.js'`:

```js
import { desktopCloudProviders, registerCloudDeepLink } from './cloud-auth.js'
```

After the existing `ensureDefaultProfileAndMigrate()` call (before `initCore`), add:

```js
registerCloudDeepLink()
```

In the `DesktopSettings` component, change:

```jsx
      <BackupRestoreCard fileIO={desktopFileIO} />
```

to:

```jsx
      <BackupRestoreCard fileIO={desktopFileIO} cloudProviders={desktopCloudProviders} />
```

- [ ] **Step 3: Build the renderer**

Run: `npm -w apps/desktop run build:renderer`
Expected: SUCCESS.

- [ ] **Step 4: Desktop e2e regression**

Run: `npm -w apps/desktop run e2e`
Expected: the existing 3 smoke tests still PASS (the Settings card now also shows Connect Google Drive / Connect OneDrive — the existing assertions are unaffected; cloud actions require real OAuth and aren't asserted).

- [ ] **Step 5: Manual smoke (documented)**

With a deployed backend (`VITE_API_BASE`) configured and Google/MS client config set: Settings → Profiles shows **Connect Google Drive** / **Connect OneDrive**; clicking opens the system browser; after consent the browser hands off to `nexusmd://oauth/<p>?provider=&otc=`, the app redeems it and reloads connected; Save/Restore then work against `/NexusMD`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/cloud-auth.js apps/desktop/src/main.jsx
git commit -m "feat(desktop): cloud sign-in via system browser + nexusmd:// one-time code"
```

---

## Phase 5 — App (Capacitor/Android)

### Task 4: App deep-link infrastructure (@capacitor/app + custom scheme)

**Files:**
- Modify: `apps/app/package.json`, `apps/app/capacitor.config.json`, `apps/app/android/app/src/main/AndroidManifest.xml`, `apps/app/src/adapters/deepLink.js`

**Interfaces:**
- Produces: a working `deepLinkAdapter.onLink(cb)` that fires on `nexusmd://oauth/...` opens (via `@capacitor/app`'s `appUrlOpen`), with a graceful fallback when the plugin is absent.

- [ ] **Step 1: Add the dependency**

Run: `npm -w apps/app i @capacitor/app@^6.0.0`
Expected: installs; `apps/app/package.json` lists `@capacitor/app` under dependencies. (If offline/registry-blocked, the plugin is genuinely required — report BLOCKED rather than stubbing.)

- [ ] **Step 2: Register the custom scheme in capacitor.config.json**

In `apps/app/capacitor.config.json`, add a top-level `"plugins"` key (merge if one exists) — Android custom-scheme handling is via the manifest (Step 3); this records intent for clarity:

```json
{
  "appId": "com.knownexus.nexus",
  "appName": "Nexus",
  "webDir": "www",
  "server": {
    "androidScheme": "https",
    "hostname": "nexus.app"
  }
}
```

(No change needed in capacitor.config.json itself for a custom URL scheme on Android — the intent-filter in Step 3 is what registers `nexusmd://`. Leave this file unchanged; this step is a no-op verification that `appId` is `com.knownexus.nexus`.)

- [ ] **Step 3: Add the intent-filter to AndroidManifest.xml**

In `apps/app/android/app/src/main/AndroidManifest.xml`, inside the main `<activity android:name=".MainActivity" ...>` element (alongside the existing launcher intent-filter), add:

```xml
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="nexusmd" android:host="oauth" />
            </intent-filter>
```

- [ ] **Step 4: Make the deep-link adapter use @capacitor/app**

Replace the contents of `apps/app/src/adapters/deepLink.js` with:

```js
// Deep-link adapter — uses @capacitor/app appUrlOpen when available; falls back
// to a one-shot read of the current URL (browser/dev) otherwise.
let CapApp = null
try { ({ App: CapApp } = await import('@capacitor/app')) } catch {}

export const deepLinkAdapter = {
  onLink(cb) {
    if (CapApp?.addListener) {
      const sub = CapApp.addListener('appUrlOpen', (e) => { if (e?.url) cb(e.url) })
      return () => { try { sub.then(s => s.remove()) } catch {} }
    }
    const url = window.location.href
    if (url.includes('nexusmd://') || url.includes('?link=')) setTimeout(() => cb(url), 0)
    return () => {}
  },
  isAvailable() { return Boolean(CapApp?.addListener) },
}
```

- [ ] **Step 5: Build the app web bundle**

Run: `npm -w apps/app run build`
Expected: SUCCESS (the top-level `await import` resolves; `@capacitor/app` is installed).

- [ ] **Step 6: Commit**

```bash
git add apps/app/package.json apps/app/package-lock.json apps/app/android/app/src/main/AndroidManifest.xml apps/app/src/adapters/deepLink.js
git commit -m "feat(app): nexusmd:// deep-link infra via @capacitor/app + intent-filter"
```

---

### Task 5: App cloud auth bindings + Settings mount

**Files:**
- Create: `apps/app/src/cloud-auth.js`
- Modify: `apps/app/src/views/view-settings.jsx`, `apps/app/src/app.jsx`

**Interfaces:**
- Consumes: `getProfileKey` (`apps/app/src/profile-keys.js`, namespace `helm`); `makeGoogleDriveProvider`/`makeOneDriveProvider` (`@nexusmd/ui`); `deepLinkAdapter` (Task 4); `@capacitor/browser` if present, else `window.open`; backend native endpoints (Task 1).
- Produces: `appCloudProviders` array; `registerCloudDeepLink()`.

- [ ] **Step 1: Confirm the app's profile-keys namespace + browser plugin availability**

Run: `grep -n "namespace\|helm" apps/app/src/profile-keys.js` and `grep -n "@capacitor/browser" apps/app/package.json`
Expected: namespace `helm`. If `@capacitor/browser` is absent the code below falls back to `window.open`; do not add the dependency in this task.

- [ ] **Step 2: Create `apps/app/src/cloud-auth.js`**

```js
// cloud-auth.js — app (Capacitor) OAuth bindings for profile cloud sync.
// Opens the system browser to the backend native-url; the backend redirects to
// nexusmd://oauth/<provider>?provider=&otc=, captured via the deepLinkAdapter,
// then redeemed for tokens. Tokens stored per-profile under the `helm` namespace.
import { getProfileKey } from './profile-keys.js'
import { makeGoogleDriveProvider, makeOneDriveProvider } from '@nexusmd/ui'
import { deepLinkAdapter } from './adapters/deepLink.js'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://nexusmd.app'

const PROVIDERS = {
  gdrive:   { keySuffix: 'gdrive.auth',   api: '/api/google/auth', from: 'gdrive' },
  onedrive: { keySuffix: 'onedrive.auth', api: '/api/ms/auth',     from: 'onedrive' },
}
const BY_FROM = { gdrive: PROVIDERS.gdrive, onedrive: PROVIDERS.onedrive }

function read(suffix) {
  try { const k = getProfileKey('helm.' + suffix); return k ? JSON.parse(localStorage.getItem(k) || 'null') : null }
  catch { return null }
}
function write(suffix, auth) {
  try { const k = getProfileKey('helm.' + suffix); if (k) localStorage.setItem(k, JSON.stringify(auth)) } catch {}
}
function clear(suffix) {
  try { const k = getProfileKey('helm.' + suffix); if (k) localStorage.removeItem(k) } catch {}
}

async function openBrowser(url) {
  try {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url })
  } catch {
    window.open(url, '_system') || (window.location.href = url)
  }
}

function makeBinding(key) {
  const cfg = PROVIDERS[key]
  return {
    isConnected: () => Boolean(read(cfg.keySuffix)?.accessToken),
    async connect() {
      try {
        const returnUri = `nexusmd://oauth/${cfg.from}`
        const res = await fetch(`${API_BASE}${cfg.api}/native-url?returnUri=${encodeURIComponent(returnUri)}`)
        if (!res.ok) return
        const { url } = await res.json()
        await openBrowser(url)
      } catch {}
    },
    async disconnect() { clear(cfg.keySuffix) },
    async getToken({ force } = {}) {
      const auth = read(cfg.keySuffix)
      if (!auth?.accessToken) return null
      if (!force) return auth.accessToken
      try {
        const res = await fetch(`${API_BASE}${cfg.api}/refresh`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: auth.refreshToken }),
        })
        if (!res.ok) return null
        const { accessToken } = await res.json()
        write(cfg.keySuffix, { ...auth, accessToken })
        return accessToken
      } catch { return null }
    },
  }
}

async function redeem(url) {
  let u
  try { u = new URL(url) } catch { return }
  const from = u.searchParams.get('provider')
  const otc = u.searchParams.get('otc')
  const cfg = from && BY_FROM[from]
  if (!cfg || !otc) return
  try {
    const res = await fetch(`${API_BASE}${cfg.api}/exchange`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: otc }),
    })
    if (!res.ok) return
    const { accessToken, refreshToken } = await res.json()
    write(cfg.keySuffix, { accessToken, refreshToken })
    try { const { Browser } = await import('@capacitor/browser'); await Browser.close() } catch {}
    window.location.reload()
  } catch {}
}

export function registerCloudDeepLink() {
  deepLinkAdapter.onLink(redeem)
}

export const appCloudProviders = [
  makeGoogleDriveProvider(makeBinding('gdrive')),
  makeOneDriveProvider(makeBinding('onedrive')),
]
```

- [ ] **Step 3: Register the deep-link handler on app startup**

In `apps/app/src/app.jsx`, add to the imports:

```js
import { registerCloudDeepLink } from './cloud-auth.js'
```

Find the top-level startup area (where the app initialises — near the other one-time setup). Add a module-level call after imports:

```js
registerCloudDeepLink()
```

- [ ] **Step 4: Mount the providers in app Settings**

In `apps/app/src/views/view-settings.jsx`, add the import next to `import { appFileIO } from '../file-io.js'`:

```js
import { appCloudProviders } from '../cloud-auth.js'
```

Change the existing card mount:

```jsx
              <BackupRestoreCard fileIO={appFileIO} showExportSingle={true} />
```

to:

```jsx
              <BackupRestoreCard fileIO={appFileIO} showExportSingle={true} cloudProviders={appCloudProviders} />
```

- [ ] **Step 5: Build the app**

Run: `npm -w apps/app run build`
Expected: SUCCESS.

- [ ] **Step 6: Full JS suite regression**

Run: `npx vitest run`
Expected: all PASS (the shared card change is backward-compatible; app has no unit tests for these new files).

- [ ] **Step 7: Manual smoke (documented)**

On an Android device/emulator with the debug APK and a deployed backend: Settings → Profiles shows Connect buttons; connecting opens the system browser; after consent Android routes `nexusmd://oauth/<p>` back into the app; tokens are redeemed; Save/Restore work against `/NexusMD`.

- [ ] **Step 8: Commit**

```bash
git add apps/app/src/cloud-auth.js apps/app/src/views/view-settings.jsx apps/app/src/app.jsx
git commit -m "feat(app): cloud sign-in via system browser + nexusmd:// one-time code"
```

---

## Self-Review Notes

- **Spec coverage (Phases 4–5):** backend-mediated native auth with one-time-code exchange (Task 1) ✓; tokens never in raw redirect URLs (OTC) ✓; returnUri allow-list ✓; desktop wiring over existing `nexusmd://` protocol (Tasks 2–3) ✓; app deep-link infra + wiring (Tasks 4–5) ✓; visible `/NexusMD` + scopes reused from Phases 1–3 ✓; manual push/pull only ✓; per-profile token storage in each platform's namespace ✓.
- **Reality notes baked in:** desktop already has a `nexusmd://` protocol handler (`electron/ipc/deepLink.cjs`) — Tasks 2–3 build on it. The app had only a stub deep-link adapter and no scheme — Task 4 adds `@capacitor/app` + an Android intent-filter (mirrors how Feature A's app file I/O had to account for a missing Capacitor plugin).
- **Dependency:** native sign-in requires a reachable deployed backend (`VITE_API_BASE`); documented in the desktop/app `cloud-auth.js` headers and manual-smoke steps.
- **Type consistency:** `authBinding` shape, provider methods, `TokenPair`/`TokenResponse`, `ExchangeRequest`, routes `/api/{google,ms}/auth/native-url|native-callback|exchange`, and the `?provider=&otc=` redirect contract are used identically across tasks. `ExchangeRequest` declared once (Task 1, Google controller).
- **No placeholders:** every code step contains complete code. Capacitor `@capacitor/app` install is the one external action; if the registry is unreachable the task reports BLOCKED rather than stubbing (consistent with Feature A's handling).
- **iOS note:** the app is Android-only today (`apps/app/android`); no iOS `Info.plist` scheme task is included. If iOS is added later, the `CFBundleURLSchemes` entry mirrors the Android intent-filter.

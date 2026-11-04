# Deploying the NexusMD API to Railway

This covers the ASP.NET Core server in `apps/web/server` (accounts, encrypted item sync, OAuth helpers). It is
packaged by `apps/web/Dockerfile` and stores everything in SQLite on a Railway volume. The image serves the API
only; the Vite frontend is not built into it.

Nothing here has been run for you. Do each step yourself (or explicitly ask for it to be done).

## 1. Image

- Build context is the repository root: `docker build -f apps/web/Dockerfile -t nexusmd-api .`
- On Railway, create a service from this repo and set the Dockerfile path to `apps/web/Dockerfile` (root directory
  left at the repo root).
- The container listens on `$PORT` (Railway injects it; 8080 when unset). The entrypoint also exports `Urls`
  because `appsettings.json` contains a `Urls` key (`http://localhost:5200`) that otherwise overrides
  `ASPNETCORE_URLS`.
- Defaults baked into the image: `Accounts__DbPath=/data/accounts.db`, `Profiles__DbPath=/data/profiles.db`,
  `ASPNETCORE_ENVIRONMENT=Production`.
- `apps/web/server/appsettings.user.json` is excluded from the image by `.dockerignore`. Do not rely on it in
  production; use environment variables.

## 2. Project, volume, domain

1. Create a Railway project and add the service from this repo.
2. Add a volume to the service and mount it at `/data`. Without it the databases are lost on every deploy.
3. Keep the service at **one replica**. The stores are SQLite files; never scale replicas above 1.
4. Do not enable a public TCP proxy for the service. Expose it only through the HTTP domain.
5. The service uses Railway's generated domain, `https://nexusmd-api-production.up.railway.app` (`railway domain`). The desktop and Android apps
   default to it (`API_BASE` in `apps/*/src/account.js` and `cloud-auth.js`, and `apps/app/.env.production`). To move
   to a custom domain later, attach it in Railway, add its DNS records, and change those defaults.

## 3. Environment variables

Required:

| Variable | Value / notes |
| --- | --- |
| `Accounts__SetupToken` | Long random string. Used once, via `POST /api/account/setup`, to create the first admin. Setup is disabled while it is empty or whitespace. Remove it after setup. |
| `Jwt__SigningKey` | At least 32 random bytes (e.g. `openssl rand -base64 48`). The server refuses to start without it outside Development. Changing it signs every user out. |
| `Accounts__DbPath` | `/data/accounts.db` (image default) |
| `Profiles__DbPath` | `/data/profiles.db` (image default) |
| `Proxy__TrustForwardedHeaders` | `true`. **Required behind Railway.** Without it `Request.Scheme` is `http`, so the redirect URIs the Google and Microsoft controllers build (`{scheme}://{host}/api/google/auth/native-callback` and `/api/ms/auth/native-callback`) will not match the registered `https` URIs, and the per-IP rate limiter collapses every client onto the proxy's address. |
| `Proxy__ClientIpHeader` | `X-Real-IP`. **Required behind Railway.** Railway sends `X-Forwarded-For: <client>, <edge ip>` with an edge address that changes between requests, so without this every request lands in a fresh rate-limit partition and the per-IP limit never engages. `X-Real-IP` carries the client address alone. Read only while `Proxy__TrustForwardedHeaders` is true; an unparseable value falls back to the `X-Forwarded-For` address. |
| `Google__ClientId`, `Google__ClientSecret` | Google web OAuth client. Register `https://nexusmd-api-production.up.railway.app/api/google/auth/native-callback` as an authorized redirect URI. |
| `Microsoft__ClientId`, `Microsoft__ClientSecret`, `Microsoft__Tenant` | Entra app registration. Register `https://nexusmd-api-production.up.railway.app/api/ms/auth/native-callback` as a redirect URI. `Microsoft__Tenant` defaults to `common` when empty. |
| `OAuth__NativeReturnPrefixes__0` | `nexusmd://` (add `__1`, ... for further allowed return prefixes). Be aware this is merged index-by-index with the `appsettings.json` list (`nexusmd://`, `http://127.0.0.1`), so index 0 is replaced but the loopback entry at index 1 stays allowed unless you also set `OAuth__NativeReturnPrefixes__1` to something else. |

Optional tuning:

| Variable | Default | Meaning |
| --- | --- | --- |
| `RateLimit__PermitPerMinute` | 20 | Requests per minute per client IP on the anonymous account endpoints |
| `Items__MaxBytes` | 25 MiB | Largest single item |
| `Items__MaxPageBytes` | 16 MiB | Ciphertext budget per changes page |
| `Items__MaxUserBytes` | 1 GiB | Storage quota per user |
| `Items__MaxBatchBytes` | 64 MiB | Largest batch request body |
| `Sync__MinFormat` | 1 | Oldest sync format accepted for writes; clients below it get 426 `client_outdated` (current clients send 2) |
| `Web__LegacyEndpoints` | false | Leave unset/false in production. The old unauthenticated Profiles/Config/Files/Ado endpoints stay disabled; this includes the legacy `PUT /api/config`, which writes `appsettings.user.json`. |
| `Logging__LogLevel__Default` | Debug (from `appsettings.json`) | Set to `Information` in production. |

## 4. First run

1. Set the variables above and deploy. Check the deploy logs for a clean start (a missing or short
   `Jwt__SigningKey` aborts startup with an explicit message).
2. `GET https://nexusmd-api-production.up.railway.app/api/account/status` should return `{"needsSetup":true}`.
3. Create the first admin with `POST /api/account/setup`. This cannot be done with plain curl: the client must
   derive and send the `authKey`, `salt`, `iterations`, `publicKey`, `wrappedPrivateKey` and
   `wrappedContainerKey` from the password (end-to-end encryption), alongside `username` and `setupToken` (the value
   of `Accounts__SetupToken`). Do it from the NexusMD app: while the server reports `needsSetup`, the sign-in
   screen shows a setup form that asks for the setup token, a username and a password, and derives the keys on the
   device. Responses: 201 with a session (`accessToken`, `refreshToken`, `expiresIn`, `user`, `salt`,
   `iterations`, `publicKey`, `wrappedPrivateKey`, `wrappedContainerKey`); 403 if the setup token is wrong or missing
   or setup is disabled (empty `Accounts__SetupToken`); 409 once an account already exists. Remove
   `Accounts__SetupToken` from the Railway variables after setup.
4. Signed in as the admin, create invites with `POST /api/admin/invites` (body `{ "ttlHours": n }`), and list or
   revoke them with `GET` / `DELETE /api/admin/invites[/{id}]`. Users register with an invite via
   `POST /api/account/redeem`. Manage accounts with `GET /api/admin/users` and
   `POST /api/admin/users/{id}/disable` or `/enable`.
5. Behaviour to know about: an account locks after 5 failed logins for 15 minutes (HTTP 423). Data is end-to-end
   encrypted, so a forgotten password cannot be recovered by the server or an admin.

## Releasing a new sync format

Desktop releases that change the sync format (the client sends `X-Sync-Format`; "profiles that sync everything"
is format 2) ship with the server setting raised in the same window:

1. Set `Sync__MinFormat=2` in the Railway variables and redeploy.
2. Release the desktop build and update every Windows install. Until a computer is updated, its syncs are refused
   (HTTP 426 `client_outdated`) and it shows "This version of NexusMD can no longer sync. Update NexusMD to keep
   syncing."; nothing local is lost, and it syncs again once updated.
3. Reads are not gated, so an old client can still sign in and see the account; only its writes are refused.

## 5. Security checks after the first deploy

1. **Forwarded headers and exposure.** `Proxy__TrustForwardedHeaders=true` clears the known-proxy list and uses the
   right-most `X-Forwarded-For` entry (`ForwardLimit` is 1); `Proxy__ClientIpHeader=X-Real-IP` then replaces that
   (Railway edge) address with the client one. Measured on 2026-11-03: Railway's edge drops client-supplied
   `X-Forwarded-For` and `X-Real-IP` values and sets both itself. That is only safe if the service is reachable
   solely through Railway's edge. Verify empirically: from one machine, send
   more than `RateLimit__PermitPerMinute` requests to `/api/account/status` within a minute, each with a different
   fake header (`curl -H "X-Forwarded-For: 203.0.113.<n>" https://nexusmd-api-production.up.railway.app/api/account/status`). You should
   still receive HTTP 429 after the limit; if every request succeeds, either a client-supplied header is being
   trusted or the client address is not being read (check `Proxy__ClientIpHeader`). Repeat with fake
   `X-Real-IP` headers. Also confirm requests from a second network are not throttled by the first
   (the limiter is keyed on the real client, not the proxy). Confirm there is no public TCP proxy and no sibling
   service or network path that can reach the container directly. If you cannot confirm this, set
   `Proxy__TrustForwardedHeaders` back to false and accept the redirect URI and rate-limit limitations.
2. **SQLite backups.** The databases run in WAL mode. Copy the `-wal` and `-shm` files together with each `.db`,
   or better use `sqlite3 /data/accounts.db ".backup 'accounts-backup.db'"`. A plain copy of only the `.db` can be
   missing recent writes. The volume must be mounted at `/data`.
3. **Single replica.** SQLite is not safe across replicas. Keep replicas at 1.
4. **Rotate the leaked Google web client secret.** A Google web client secret was committed in
   `apps/web/server/appsettings.user.json`. That file is now untracked and listed in `.gitignore`, but it remains
   in git history. In Google Cloud Console, create a new secret for that client, delete the old one, and put the
   new one only in `Google__ClientSecret`. If the repository is or will become public, also purge it from history.
5. **Desktop client secret.** `apps/desktop/electron/oauth/config.cjs` also commits a Google desktop client secret
   (and a Microsoft desktop client id). A native-app client secret is not confidential under RFC 8252, so this is
   lower risk, but if the repository is public consider rotating it and supplying it through
   `GOOGLE_DESKTOP_CLIENT_SECRET` at build time instead of committing it. That file was left unchanged here.
6. Treat `Accounts__SetupToken` and `Jwt__SigningKey` as secrets: set them only in Railway variables, never in the
   repo.

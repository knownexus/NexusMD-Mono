# NexusMD accounts

An account lets you log in on a new Windows or Android install and get your setup back: connections, API keys,
sign-ins, theme, profiles and per-device preferences. This is milestone 1 of accounts. Syncing planners, notes
and documents (milestone 2) and sharing (milestone 3) are not part of it yet.

Accounts live on a NexusMD server you or your team run. To deploy one, see [railway-deploy.md](railway-deploy.md).

## Locked with your password

Everything is encrypted on your device with a key derived from your password before it is sent. The server stores
only ciphertext and cannot read your settings or secrets. An administrator cannot read them either.

If you forget your password, your synced data cannot be recovered. There is no reset link and no recovery key in
this milestone. An administrator can invite you again as a new user, but that account starts empty. Keep your
password in a password manager.

Changing your password (Account card) re-wraps your keys under the new password. Your data is not re-encrypted,
and every other device is signed out and has to log in again.

## What the first run looks like

This describes the flow of the shared sign-in screens (the account gate and Account card in the shared UI package),
which the desktop and Android apps use.

1. Sign-in gate. On start-up, if you are not signed in and have not opted out, NexusMD shows the gate before
   anything else.
   - On a brand-new server the gate asks for the one-time setup token plus a username and password. That creates
     the first account, which is the administrator.
   - Otherwise it asks for username and password, with a tab to redeem an invite code.
   - "Use without an account" skips all of this. The app works exactly as before, nothing is uploaded, and you can
     sign in later.
   - A different account on the same install. If this install last held another account's settings and a
     different user signs in, the app warns: "This device has settings from another account. Continue as <name>
     and remove them from this device?" Continue removes this install's synced settings and secrets (the items
     listed as synced below) before the new account's settings are restored. Cancel signs out and changes nothing.
     Data that milestone 1 does not sync (planner weeks and notes, calendar events, lists, time log) is not
     removed, so it stays on the device and is visible to the next account. The install is tied to an account as
     soon as a device is chosen, even if the first download then fails.
   - The same account again. Signing in as the same user never removes local data. If your session simply expired,
     signing back in goes straight into the app and skips the device picker. After you log out yourself, signing
     in again shows the device picker (step 2) and restores as usual.
2. Device picker. After signing in you choose which device this is: one of the devices already on your account, or
   "This is a new device" with a name (for example "Work laptop"). Choosing an existing device restores that
   device's own preferences.
3. Restore or upload. If the account already holds your settings, they are downloaded and the app reloads. On a
   new device the first profile becomes the active one, so its restored connections are used straight away. If the
   account is empty and this device has local settings, the app tells you that this device's settings (including
   saved connections and sign-in tokens) will be uploaded to your account and become the starting point for your
   other devices. Continue uploads them; Cancel signs you out and nothing is uploaded. There is no way to sign in
   without uploading: once sync runs it uploads this device's settings.
4. Account card. In Settings (the "Data & sync" tab on desktop, the settings screen on Android) the Account card
   shows your sign-in, the time of the last sync, "Sync now", your devices (rename, remove), change password and
   log out. Administrators can also create invites and disable or enable users. The device you are using cannot be
   removed, and removing another device asks first. If a removed device is still in use, its next sync still
   uploads its account settings, then it stops syncing and shows the device picker so you can choose which device
   it is again.

Sync then runs in the background and when the app is shown again. If you are offline the app keeps working with
what it has and syncs later. If your session has expired you see the gate again, and nothing local is wiped.
Local data is only removed when a different account signs in, as described above.

## What is synced, and at which level

Account level means every device on the account shares it. Device level means it is kept per device: a device you
log in on restores its own value, and other devices do not see it.

| Level | What |
| --- | --- |
| Account | Connection settings for Azure DevOps, GitHub and Jira (organisation, projects, repositories, queries and similar), including the PATs and tokens stored in secure storage |
| Account | Profiles list (merged by id: a profile that exists locally and remotely is kept on both) |
| Account | Theme settings and other appearance tweaks: theme, light, dim and dark themes, density, type labels, quick links, markdown display |
| Account | Google and Microsoft sign-in tokens, kept separately per platform (see below) |
| Account | Other synced settings that are not listed under device level |
| Device | Sidebar width, work item field layout, builds table layout, notification settings, refresh interval, markdown text size |
| Device | The rest of the tweaks object: widgets, navigation and any new tweak the app adds later |
| Device | The active profile on that device |
| Device | App preferences that belong to one install: on Windows, close to tray, zoom, open at login and disabled apps |

Not synced:

- Planner weeks, notes, calendar events, lists, time log and documents. Milestone 2 covers them.
- Anything that is a cache or in-flight state: caches, pending sign-in state, offline queues, git snapshots,
  migration markers, folder URIs that only mean something on one phone.
- The account session itself (it stays on the device, in secure storage).

Conflicts are settled per setting by the time the edit was first noticed on a device (last writer wins). A device
that has never synced a value does not overwrite the account's value when it joins.

## Invites

Only an administrator can add people. There is no public sign-up.

1. The first account is created with the one-time setup token, set on the server as the `Accounts__SetupToken`
   environment variable. Setup works once; remove the variable after the first account exists (see
   [railway-deploy.md](railway-deploy.md)).
2. An administrator opens the Account card in Settings and chooses "Create invite". The code is shown once, so
   copy it then. Invites are single use and expire after 7 days. The server API also supports choosing the expiry
   (1 hour to 30 days), listing invites and revoking an unused one, but the app does not offer these yet.
3. The invitee opens the app, chooses "Redeem an invite" on the gate, enters the code and picks a username and
   password. Their account keys are created on their device.
4. Administrators can disable and re-enable users from the Account card. A disabled user is signed out everywhere
   and cannot log in.

After five failed password attempts an account is locked for 15 minutes. Wrong current-password attempts when
changing a password count towards the same limit.

## Windows and Android sign-in tokens

Google and Microsoft sign-in tokens are tied to the app registration that issued them, and the Windows app and the
Android app use different registrations. For that reason the tokens are stored per platform:

- Windows tokens are synced between your Windows installs. Android tokens are synced between your Android devices.
- The first time you use Google or Microsoft features on the other platform, there is no token for it yet. You see
  a one-click "Sign in" prompt rather than a broken state; the provider remembers your consent, so it is one tap.
  After that, that platform keeps its own token.
- Connection settings (such as the Azure DevOps organisation and PAT) are shared between the platforms. The two
  apps store them under different names, and NexusMD maps those names so both see the same values.

## Checking a server end to end

`scripts/account-e2e.mjs` drives the real client library against a running server. It sets up the administrator,
invites a second user, seeds one "device" with settings and secrets, restores them on a fresh second device, and
scans the server's SQLite file to confirm none of the values or setting names are present in clear text. It
exits with a non-zero status if anything fails.

Start a server with a temporary database (the server needs the .NET 8 runtime):

```
Accounts__SetupToken=<token> Jwt__SigningKey=<at least 32 characters> Accounts__DbPath=<dir>/accounts.db \
Web__LegacyEndpoints=false Urls=http://127.0.0.1:5391 dotnet run --project apps/web/server
```

Then, from the repository root, with a database that has not been set up yet:

```
API_BASE=http://127.0.0.1:5391 SETUP_TOKEN=<token> node scripts/account-e2e.mjs <dir>/accounts.db
```

It prints `PASS` on success. Use a fresh database each time, because setup only works once.

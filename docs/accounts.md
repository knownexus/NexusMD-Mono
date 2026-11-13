# NexusMD accounts

An account lets you log in on a new Windows or Android install and get your setup back. On Windows that is
everything in every profile: settings, connections, tokens and sign-ins, and content (planner weeks, notes,
lists, time log, calendar events, documents, saved queries). Android still syncs its milestone 1 set (settings,
connections, sign-ins, theme, profiles). Sharing (milestone 3) is not part of it yet.

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
   - A different account on the same install. If this install last held another account's data and a different
     user signs in, the app first checks for content that was never synced to the previous account.
     - Nothing unsynced: it warns "This device has settings from another account. Continue as <name> and remove
       them from this device?" Continue removes everything the account syncs (on Windows that includes profile
       content) before the new account's data is restored. Cancel signs out and changes nothing.
     - Something unsynced: the switch is blocked. The screen lists each profile and how many items have not been
       synced, and offers **Export a backup** (a password-protected `.nmdprofile` of every profile, including
       its tokens; after saving it, **Continue and remove** appears), **Cancel and sync first** (signs out of the
       new account: sign in with the previous account, let it sync, then switch) and **Cancel**. Tokens and
       sign-ins are not counted, because they cannot be compared without the previous account's key and can be
       typed again.
     - On Android, content is not synced and is never removed on a switch.
     The install is tied to an account as soon as a device is chosen, even if the first download then fails.
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
   shows your sign-in, the server it goes to, the time of the last sync, your devices (rename, remove), change
   password and log out. Saving and loading a profile are in the Profile sync card (see below). Administrators can also create invites and disable or enable users. The device you are using cannot be
   removed, and removing another device asks first. If a removed device is still in use, its next sync still
   uploads its account settings, then it stops syncing and shows the device picker so you can choose which device
   it is again.

Sync then runs in the background and when the app is shown again. If you are offline the app keeps working with
what it has and syncs later. If your session has expired you see the gate again, and nothing local is wiped.
Local data is only removed when a different account signs in, as described above.

## Profiles on Windows

Everything you keep in NexusMD belongs to a profile, and each profile syncs on its own: profiles never see each
other's data. Settings that used to be shared by the whole app were copied into every profile at the upgrade, and
content and credentials went to the profile that was active then (see "Upgrading" below).

- **Deleting** a profile (Settings, Profiles, Edit, Delete) moves it to **Deleted profiles**. Its data stays and
  keeps syncing, so you can **Restore** it from any computer. The last live profile cannot be deleted.
- **Purge** (in Deleted profiles, after a confirmation) removes the profile, its content and its saved tokens from
  every computer. It cannot be undone. Signed out, the purge happens on this computer and reaches the account the
  next time you sign in.
- If a profile is purged on one computer while another has changes to it that were never synced, the other
  computer does not discard them straight away: it shows which items would be lost, offers **Export first** (a
  `.nmdprofile` of that profile) and then **Discard**, or **Later**.

### Backups (.nmdprofile)

Settings, Profiles, Backup & Restore exports a password-protected `.nmdprofile` file. On Windows the file also
carries each profile's saved tokens and sign-ins (decrypted inside the encrypted file), and restoring it puts them
back into secure storage, so choose a strong password. If some tokens cannot be saved on the computer you restore
on, NexusMD says so and you sign in again for those.

### Upgrading

The first start of this version moves the data that was still shared by the whole app into profiles, and moves
plaintext tokens (Azure DevOps, GitHub and Jira tokens, OAuth sign-ins) into secure storage. Nothing is removed
until every copy has been written and read back; if anything fails, nothing changes and the next start tries
again. Where a profile already had a different copy of some content, the shared copy is kept on this computer
(never synced) instead of being thrown away. Both Windows computers need this version before syncing again: the
server refuses writes from older versions (see [railway-deploy.md](railway-deploy.md), `Sync__MinFormat`), and
an older version shows "This version of NexusMD can no longer sync. Update NexusMD to keep syncing."

## Sync status and conflicts

Settings shows **Profile sync** (the "Data & sync" tab on desktop; the Profiles page on Android). It says which
account and server your profiles go to, and has one row per profile: its name (with **Active** on the one you are
using), when it was last saved to and loaded from the server (or why the last sync failed), items the server refused
(larger than 25 MiB, or over the account's 1 GiB), and its open conflicts. Each row has two buttons that act on that
profile alone:

- **Save to server** sends what changed on this device. Nothing on the server is overwritten: if the server's copy
  changed too, that item becomes a conflict.
- **Load from server** brings down what the server has newer. Your newer edits here are kept (a clash becomes a
  conflict), and if it changes anything the app reloads and the row says what was loaded.

Neither replaces one side with the other. Syncing also happens by itself in the background, for every profile, so
these buttons are for doing it now, for one profile, with a clear direction.

When the same thing changed on two computers between syncs, NexusMD never overwrites either side. The item is
parked as a conflict, everything else keeps syncing, and a notice says "N sync conflicts need your decision —
Settings › Data & sync". **Sync conflicts** lists them; **Resolve** opens:

- for text (a note, a document, a plain value): the two versions line by line, "Use mine" or "Use theirs" for
  each changed part, and the result, which you can edit before saving;
- for structured items (a time-log entry, a list, a calendar event, a connection): the fields that differ, with a
  choice for each;
- for content records: **Keep both**, which keeps yours and adds the other version as
  "<name> (conflicted copy, <device>, <date>)";
- when one side deleted the item, or for a token (its values are never shown): keep this computer's version or
  use the other one.

Two computers that never synced content before the upgrade are handled the same way: different notes, lists or
entries simply merge; the same record with different content becomes a conflict instead of one side winning.
Identical values are never conflicts. Values the app writes on its own (token refreshes, "seen" flags, collapsed
panels, last-used markers, open connections) do not ask: the newest wins.

## Missing folders on this computer

Git repositories and API client collection folders are part of the profile, so they appear on every computer. A
folder that does not exist on this computer shows greyed out and cannot be opened (also from the keyboard) until
the folder exists.

## Google Drive / OneDrive backup

The older Google Drive / OneDrive backup is behind a switch in Settings, Data & sync. It is off on new installs
and on for installs where it was already set up. With it off, its buttons and its automatic backup do not run.

## What is synced, and at which level (Android)

Account level means every device on the account shares it. Device level means it is kept per device: a device you
log in on restores its own value, and other devices do not see it. On Windows almost everything is account level
and per profile (above); only the sidebar width, the active profile and the app preferences below stay per device.

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

- On Android: planner weeks, notes, calendar events, lists, time log and documents.
- Anything that is a cache or in-flight state: caches, pending sign-in state, offline queues, git snapshots,
  migration markers, folder URIs that only mean something on one phone.
- The account session itself (it stays on the device, in secure storage).

On Android, conflicts are settled per setting by the time the edit was first noticed on a device (last writer
wins). A device that has never synced a value does not overwrite the account's value when it joins.

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
invites a second user, seeds a Windows "device" with two profiles (settings, a token, a sign-in, a note, tweaks),
restores them on a fresh second device, checks that a third device's different notes are never lost (distinct
notes merge, the same note conflicts), that a note edited on two devices becomes one conflict and Keep both leaves
two notes everywhere, that a deleted profile shows as deleted elsewhere, restores and purges (the server keeps only
tombstones), that a write without the current sync format gets 426, and scans the server's SQLite file to confirm
none of the values or names are present in clear text. It exits with a non-zero status if anything fails.

Start a server with a temporary database and `Sync__MinFormat=2` (the server needs the .NET 8 runtime):

```
Accounts__SetupToken=<token> Jwt__SigningKey=<at least 32 characters> Accounts__DbPath=<dir>/accounts.db \
Sync__MinFormat=2 RateLimit__PermitPerMinute=1000 Web__LegacyEndpoints=false Urls=http://127.0.0.1:5391 \
dotnet run --project apps/web/server
```

Without a local .NET 8, the script's header has the equivalent `docker run` with the `mcr.microsoft.com/dotnet/sdk:8.0`
image (behind a TLS-inspecting proxy, add the proxy's root certificate to the container with
`update-ca-certificates` so NuGet can restore).

Then, from the repository root, with a database that has not been set up yet:

```
API_BASE=http://127.0.0.1:5391 SETUP_TOKEN=<token> node scripts/account-e2e.mjs <dir>/accounts.db
```

It prints `PASS` on success. Use a fresh database each time, because setup only works once.

# Releasing the Android app privately on Google Play

The app is `com.knownexus.nexus` (Capacitor, `apps/app`). This is the path to get it onto your own
phone, and a few testers, through Google Play's **Internal testing** track: no public listing, no
store review for most updates, available to named testers within minutes.

## One-time setup

### Done in this repo
- Release signing reads `apps/app/android/keystore.properties` (git-ignored) when it exists.
- `-PversionCode` / `-PversionName` set the version; CI passes the run number as the code, so every
  upload is higher than the last. The local default is `3` / `1.2.0`.
- Android's cloud backup is off (`allowBackup=false`): the app keeps access tokens on the device and
  they should not be copied into Google backups.
- CI builds an unsigned release bundle on every change, so a broken bundle shows up in the PR
  (`.github/workflows/android-apk.yml`).
- **Android release bundle** workflow (`.github/workflows/android-release.yml`) builds the signed `.aab`.

### Waiting on you
1. **Play Console account** (verification pending). $25 once.
2. **Make the upload keystore.** In PowerShell, from the repo root: `pwsh scripts/android-keystore.ps1`.
   It asks for the passwords itself, writes `keystore.properties`, and copies the base64 keystore to
   your clipboard. Back the `.jks` and both passwords up.
3. **A GitHub environment named `release`** (Settings > Environments > New environment): add yourself
   as a required reviewer and limit deployment branches to `master`. Add the secrets to *that
   environment* (not as repository secrets): `ANDROID_KEYSTORE_BASE64` (paste),
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`upload`), `ANDROID_KEY_PASSWORD`. The workflow
   only runs from `master`, and the environment rules are what stop another branch reading them.
4. **Host the privacy policy** (`docs/privacy-policy.md`, after you fill the marked gaps) at a public
   URL. GitHub Pages or a public gist is fine. Play needs the URL.

## In Play Console (once the account is verified)
1. Create app: name **Nexus**, default language, **App**, **Free**. Package name `com.knownexus.nexus`
   is fixed on first upload.
2. **Set up your app** tasks (Dashboard): privacy policy URL, app access (say "all or some
   functionality is restricted" and give a test login only if a reviewer needs one; for internal
   testing nobody reviews), ads (none), content rating questionnaire, target audience (18+),
   data safety (answers below), government/financial/health declarations (none).
3. **Testing > Internal testing > Testers**: create an email list (your Google account and any
   testers), save, and copy the **opt-in link**.
4. Accept **Play App Signing** when asked at the first upload (the default). Your keystore is then
   only the *upload* key.
5. **Internal testing > Create new release** and upload the `.aab` from the workflow run.
6. Open the opt-in link on the phone, accept, install from Play.

## Each release
1. Actions > **Android release bundle** > Run workflow, set the version name.
2. Download the `.aab` artifact, upload it to Internal testing, roll out.
3. Testers update through Play like any app.

(Later, the upload can be automated with a Play service account; that needs the Console set up first.)

## Data safety answers (check each against what you ship)
- **Data collected / shared with Google or the developer:** none by default. The app has no
  analytics or ads. Everything you enter stays on the device, except what you send to your own
  providers.
- **Data transmitted off the device**, only to services you connect, over HTTPS: your Azure DevOps,
  Jira, GitHub and Outlook (Microsoft Graph) accounts using the tokens you enter, and optionally your
  Google Drive or OneDrive for profile sync. Declare these as data **shared with third parties at
  the user's direction**, or as not collected, according to how Play's current wording applies;
  state "data is encrypted in transit".
- **Credentials:** tokens are stored on the device. Say so in the policy.
- **Data deletion:** removing the app removes local data. Cloud sync data is in the user's own
  Drive/OneDrive.

## Store listing (optional for Internal testing, required before wider tracks)
- App icon 512x512 PNG, feature graphic 1024x500, 2 to 8 phone screenshots, short (80) and full
  (4000) descriptions.

## Notes
- A new *personal* developer account must run a **closed test with enough testers for about 14 days**
  before it can publish to Production. Internal testing is not affected.
- `targetSdkVersion` is 36 (Android 16), current at time of writing. Check Play's requirement before
  each year's deadline.

## Updating outside Google Play (GitHub releases)

For installs that did not come from Play, the app can update itself from a GitHub Release:

- Run **Android APK release** (Actions tab, `master` only, same `release` environment secrets). It
  builds a signed APK with `-Psideload` and publishes release `android-v<version>`. Use a version
  higher than the last one.
- In the app, **Settings > Data & sync > App updates** compares the installed version with the newest
  `android-v*` release, downloads the APK and opens Android's installer. Android asks you to confirm
  every install, and the first time to allow "install unknown apps" for this app.
- `-Psideload` is what adds the `REQUEST_INSTALL_PACKAGES` permission. The Play bundle is built
  without it, because Play restricts that permission.
- **Play and GitHub installs do not mix.** Play re-signs the app, so a release APK cannot replace a
  Play install (Android rejects it as a signature mismatch). The updater hides itself on Play installs.
  To move a phone from one to the other, uninstall first (this clears the app's data; export a backup).

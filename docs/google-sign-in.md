# Google sign-in for the Android app (no server)

The app signs in to Google itself and talks to Google directly, for **Google Calendar** (read-only) and
**Google Drive** backups (`drive.file`: only the files and folder the app creates). Nothing of ours sits in
between, and no client secret is shipped: an Android-type OAuth client has none.

How it works (`apps/app/src/google-oauth.js`): the app opens Google's consent page with a one-time PKCE
challenge; Google returns the browser to `com.knownexus.nexus:/oauth2redirect?code=…&state=…`, a link only
this app opens; the app trades the code for tokens with Google, keeps them in the device's secure storage,
and refreshes them the same way.

## One-time setup (about 10 minutes, free)

1. **Create a Google Cloud project** at <https://console.cloud.google.com> (any name).
2. **Enable two APIs** (APIs & Services > Library): **Google Calendar API** and **Google Drive API**.
3. **Set up the consent screen** (APIs & Services > OAuth consent screen / Google Auth Platform):
   - User type **External**, app name "NexusMD", your email as support and developer contact.
   - Add the scopes `.../auth/calendar.events` and `.../auth/drive.file`.
   - Leave the app in **Testing** and add **your own Google account** under *Test users* (up to 100).
     Testing mode needs no Google review. Note: in Testing mode, Google expires the refresh token after
     7 days, so you will be asked to sign in again about weekly. Publishing the app ("In production") removes
     that; scopes this sensitive then need Google's verification for anyone outside your test users.
4. **Create the OAuth client** (Credentials > Create credentials > OAuth client ID):
   - Application type **Android**.
   - Package name **`com.knownexus.nexus`**.
   - SHA-1 certificate fingerprint of the key that signs the app you install (see below).
   - Open **Advanced settings** on the client and turn on **Enable custom URI scheme**. Without it
     Google refuses the redirect.
5. **Paste the client ID** (it ends in `.apps.googleusercontent.com`) into the app:
   Settings > Integrations > Google > *Client ID (Android)*, then **Connect**.

   Or bake it in at build time with `VITE_GOOGLE_CLIENT_ID` (`apps/app/.env.production`).

## Which SHA-1?

Google matches the client to the key that signed the installed app, so use the one for **how you install it**:

| Installed from | SHA-1 to give Google |
|---|---|
| The GitHub release APK (`Android APK release`) | Your upload key: `8D:FB:C8:11:39:C6:12:1A:C2:C6:17:0A:C9:F2:A4:7F:3F:1F:44:CA` (SHA-256 `31:31:B7:5B:…`; print it with `keytool -list -v -keystore ~/nexus-keys/nexus-upload.jks -alias upload`) |
| Google Play | Play re-signs the app: use the **App signing key** SHA-1 from Play Console > Setup > App signing |
| A debug build (Android Studio, the debug APK) | Your debug keystore: `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android` |

You can create one Android client per key (same package name) and the app will work whichever way it is installed;
only the client ID you paste has to match the build you are running.

## If it does not work

- **"Add your Google client ID first"**: step 5.
- **Google shows "Error 400: invalid_request" or "redirect_uri_mismatch"**: the *Enable custom URI scheme* switch
  (step 4) is off, or the package name differs from `com.knownexus.nexus`.
- **Google shows "Access blocked" / "app not verified"**: your account is not under *Test users* (step 3).
- **It asks you to sign in again every week**: the app is in Testing mode (see step 3).
- **Sign-in finishes but nothing returns to the app**: the SHA-1 does not match the key that signed the installed app.

'use strict';

// Public OAuth *client IDs* for the desktop app. These are NOT secrets — the
// desktop app is a PKCE public client and holds no client secret. Fill these in
// with the IDs from your Google "Desktop app" OAuth client and your Azure app
// registration, or override them at runtime with the
// NEXUSMD_GOOGLE_DESKTOP_CLIENT_ID / NEXUSMD_MS_DESKTOP_CLIENT_ID env vars.
module.exports = {
  googleClientId: '',
  msClientId: '',
};

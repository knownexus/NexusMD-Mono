'use strict';

// Native-app OAuth clients: the client secret is NOT confidential (RFC 8252 §8.5),
// so it is committed here per project decision. Paste your Google Cloud "Desktop app"
// client credentials below (or provide them via env at build time).
module.exports = {
  google: {
    clientId:     process.env.GOOGLE_DESKTOP_CLIENT_ID     || '918435351944-snmogfnth3overdlg4irkml41c8qm1d5.apps.googleusercontent.com',
    clientSecret: process.env.GOOGLE_DESKTOP_CLIENT_SECRET || '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',
    authUrl:  'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar',
    ],
    // access_type=offline + prompt=consent guarantee a refresh_token is returned.
    authParams: { access_type: 'offline', prompt: 'consent' },
  },
};

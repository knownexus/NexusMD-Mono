'use strict';

// The public half of the key app updates are signed with (app-package.cjs). The private half is the
// NEXUSMD_APPS_SIGNING_KEY secret of the release workflows and is never in the repository. Replacing
// the key takes a NexusMD release carrying the new public half, since installed copies trust only this.
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAqFf2onj8Xo6VvgKiMp1HwTTxorWGA69EUeRFouak4g8=
-----END PUBLIC KEY-----
`;

module.exports = { PUBLIC_KEY };

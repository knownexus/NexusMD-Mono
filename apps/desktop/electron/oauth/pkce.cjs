'use strict';
const crypto = require('crypto');

function base64url(buf) { return Buffer.from(buf).toString('base64url'); }

function makePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = base64url(crypto.randomBytes(16));
  return { verifier, challenge, state };
}

module.exports = { makePkce, base64url };

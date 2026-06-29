// errors.js — shared sync error factory. A wrong passphrase surfaces as an Error
// with code 'bad-passphrase' so callers (syncOnce, import) can branch on it.
export const badPassphrase = () =>
  Object.assign(new Error('bad passphrase'), { code: 'bad-passphrase' });

// profile-secrets.js — the one secret cache the shell and the installable apps share.
//
// Desktop keeps tokens (ado.pat, github.pat, jira.apiToken, <provider>.auth) in secure storage
// under their profile-scoped names (`nexusmd.p.<pid>.<field>`). Secure storage is async; the
// clients read tokens synchronously, so the shell binds its secure-storage adapter here and
// loads the active profiles' tokens at start, before any screen mounts. Apps read with peek()
// and write with set()/remove(), which update the cache at once and reach secure storage.
// Unbound (tests, other hosts) it is an in-memory store.
import { createSecretCache } from '@nexusmd/core'

export const profileSecrets = createSecretCache()

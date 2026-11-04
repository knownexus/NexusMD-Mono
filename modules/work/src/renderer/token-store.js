// token-store.js — where the Work clients keep their tokens (ado.pat, github.pat, jira.apiToken):
// secure storage, under the same profile-scoped name the plain key had (`nexusmd.p.<pid>.ado.pat`).
// Reads are synchronous from the shell's secret cache, which the shell fills at start before any
// Work screen mounts; writes update the cache at once and are saved to secure storage behind it.
import { profileSecrets } from '@nexusmd/shell-sdk'

export const tokenStore = {
  // A plain key only exists when the start-up move into secure storage could not complete (it is
  // retried every start): read it rather than look disconnected.
  get: (k) => profileSecrets.peek(k) ?? (() => { try { return localStorage.getItem(k) } catch { return null } })(),
  set: (k, v) => {
    profileSecrets.set(k, v).catch(err => console.warn('[work] could not save a token:', err?.message || err))
  },
}

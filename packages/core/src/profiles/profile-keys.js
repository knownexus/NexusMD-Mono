// profile-keys.js — profile-namespaced storage key helpers.
//
// Headless: core never touches localStorage directly. The platform injects a
// `getActiveId` reader (e.g. () => localStorage.getItem('nexusmd.activeProfileId'))
// and core produces correctly-namespaced keys.
//
// Unifies the three previously-divergent platform copies (App used a `helm.`
// prefix, Web/Desktop used `nexusmd.`) and fixes a latent bug in the old App/Web
// versions that stripped a fixed 5 chars regardless of prefix length.

/**
 * Build profile-key helpers for a given namespace.
 *
 * @param {object}   opts
 * @param {string}   [opts.namespace='nexusmd']  Key prefix (without trailing dot).
 * @param {() => (string|null|undefined)} [opts.getActiveId]  Reads the active profile id.
 * @returns {{ getProfileKey: (key: string) => string, getActiveProfileId: () => string, namespace: string }}
 */
export function makeProfileKeys({ namespace = 'nexusmd', getActiveId } = {}) {
  const prefix = `${namespace}.`

  function getActiveProfileId() {
    try {
      return (getActiveId ? getActiveId() : '') || ''
    } catch {
      return ''
    }
  }

  /**
   * Namespace a key under the active profile.
   *   no active profile → `${namespace}.${key}`
   *   active profile     → `${namespace}.p.${id}.${key}`
   * A leading `${namespace}.` on the input is stripped so callers may pass either form.
   */
  function getProfileKey(key) {
    const bare = key.startsWith(prefix) ? key.slice(prefix.length) : key
    const id = getActiveProfileId()
    return id ? `${prefix}p.${id}.${bare}` : `${prefix}${bare}`
  }

  return { getProfileKey, getActiveProfileId, namespace }
}

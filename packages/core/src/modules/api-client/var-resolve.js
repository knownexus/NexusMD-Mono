// Substitutes {{key}} placeholders (in strings, or recursively across
// objects/arrays) with values resolved from an environment.

const VAR_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g

export function resolveVars(template, vars = {}) {
  if (typeof template !== 'string') return template
  return template.replace(VAR_PATTERN, (match, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  ))
}

export function resolveObjectVars(value, vars = {}) {
  if (Array.isArray(value)) return value.map(v => resolveObjectVars(v, vars))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = resolveObjectVars(v, vars)
    return out
  }
  return resolveVars(value, vars)
}

// `profileKey` is the host's getProfileKey: the secret belongs to the active profile
// (`nexusmd.p.<pid>.apiClient.secret...`), so it follows the profile between machines.
export function secretStorageKey(collectionId, envName, varName, profileKey = k => k) {
  return profileKey(`nexusmd.apiClient.secret.${collectionId}.${envName}.${varName}`)
}

/**
 * Environment file shape: { variables: { key: { value } | { secret: true } } }.
 * Plain values come straight from the file; secret-marked variables are looked
 * up in secureStorage instead (so their values never sit in the git-tracked file).
 */
export async function resolveEnvironment(secureStorage, collectionId, envName, envDef, profileKey) {
  const variables = envDef?.variables || {}
  const resolved = {}
  for (const [key, def] of Object.entries(variables)) {
    if (def && def.secret) {
      resolved[key] = (await secureStorage?.get?.(secretStorageKey(collectionId, envName, key, profileKey))) ?? ''
    } else {
      resolved[key] = def?.value ?? ''
    }
  }
  return resolved
}

export async function setSecretVar(secureStorage, collectionId, envName, varName, value, profileKey) {
  await secureStorage?.set?.(secretStorageKey(collectionId, envName, varName, profileKey), value)
}

export async function removeSecretVar(secureStorage, collectionId, envName, varName, profileKey) {
  await secureStorage?.remove?.(secretStorageKey(collectionId, envName, varName, profileKey))
}

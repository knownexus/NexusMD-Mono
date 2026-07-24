// db-manager-config.js — persists a list of named Database Manager connections.
//
// Non-secret metadata (name, type, host, port, ...) for the whole list is
// stored as one JSON blob under a profile-namespaced localStorage key.
// Anything that can carry a credential (the password, or a connection string —
// which may embed one, e.g. mssql://user:pass@host/db) is stored separately,
// per connection id, through the secureStorage adapter instead — same split
// used by the api-client module's secretStorageKey/setSecretVar (see
// packages/core/src/modules/api-client/var-resolve.js), just keyed by
// connection id instead of collection/env/var name.
import { upsertConnection, removeConnection, generateConnectionId } from '@nexusmd/core'
import { getProfileKey } from './profile-keys.js'

const LIST_KEY = () => getProfileKey('dbManager.connections')
const secretKey = (id) => getProfileKey('dbManager.secret.' + id)

/**
 * All saved connections' metadata (no secrets), in save order.
 * @returns {{id: string, name: string, type: 'sqlserver'|'sqlite', inputMode: 'fields'|'connstr',
 *            host: string, port: string, database: string, filePath: string, user: string,
 *            encrypt: boolean, trustServerCertificate: boolean}[]}
 */
export function listSavedConnections() {
  try {
    const raw = localStorage.getItem(LIST_KEY())
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeList(list) {
  localStorage.setItem(LIST_KEY(), JSON.stringify(list))
}

/**
 * Insert or update a connection's metadata (by `meta.id`, if given) and, if
 * `secret` is non-empty, its password/connection string.
 * @returns {Promise<string>} the connection's id (generated if `meta.id` was absent).
 */
export async function saveConnection(secureStorage, meta, secret) {
  const id = meta.id || generateConnectionId()
  const next = upsertConnection(listSavedConnections(), { ...meta, id })
  writeList(next)
  if (secret) await secureStorage?.set?.(secretKey(id), secret)
  return id
}

/** Read a connection's saved secret (password or connection string), or '' if none. */
export async function getConnectionSecret(secureStorage, id) {
  return (await secureStorage?.get?.(secretKey(id))) ?? ''
}

/** Remove a connection's metadata and its secret. */
export async function deleteConnection(secureStorage, id) {
  writeList(removeConnection(listSavedConnections(), id))
  await secureStorage?.remove?.(secretKey(id))
}

import { registerModule } from '../../features/module-registry.js'

// Module-level state set during init so callers don't need to pass adapters every time.
let _file       = null
let _profileDir = null
let _profileId  = null

function logPath() {
  return _profileDir && _profileId
    ? `${_profileDir}/${_profileId}-audit.jsonl`
    : null
}

/**
 * Append one entry to the active profile's JSONL audit log.
 * Silently no-ops if the audit module was not initialised (e.g. no file adapter).
 *
 * Callers may pass an explicit `fileAdapter` to bypass the module-level state —
 * useful during profile migration or before initCore has run.
 *
 * @param {{ action: string, [key: string]: any }} entry
 * @param {object} [fileAdapter]  Optional explicit IFileAdapter override.
 */
export async function appendAuditEntry(entry, fileAdapter) {
  const file = fileAdapter ?? _file
  const path = logPath()
  if (!file || !path) return

  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n'
  try {
    let existing = ''
    try { existing = (await file.read(path)) ?? '' } catch { existing = '' }
    await file.write(path, existing + line)
  } catch { /* audit failures are always silent */ }
}

/**
 * Read and parse the active profile's JSONL audit log.
 * Returns [] if the module was not initialised, the log doesn't exist, or any
 * line is malformed (malformed lines are silently skipped).
 *
 * @param {object} [fileAdapter]  Optional explicit IFileAdapter override.
 * @returns {Promise<object[]>}
 */
export async function readAuditLog(fileAdapter) {
  const file = fileAdapter ?? _file
  const path = logPath()
  if (!file || !path) return []

  try {
    const text = (await file.read(path)) ?? ''
    return text.split('\n')
      .map(line => { try { return line.trim() ? JSON.parse(line) : null } catch { return null } })
      .filter(Boolean)
  } catch { return [] }
}

registerModule({
  id:               'audit',
  name:             'Audit log',
  requiredAdapters: ['file'],
  defaultEnabled:   true,

  async init(adapters, _config) {
    _file = adapters?.file ?? null
    if (!_file || !adapters?.storage) return

    const storage = adapters.storage
    const storedDir = storage.get('nexusmd.profileDir')
    _profileDir = storedDir
      ?? (typeof _file.defaultProfileDir === 'function' ? await _file.defaultProfileDir() : null)
    _profileId  = storage.get('nexusmd.activeProfileId') ?? null

    if (_profileDir) {
      try { await _file.mkdir(_profileDir) } catch { /* dir may already exist */ }
    }
  },

  async load(_adapters) { return {} },

  dispose() {
    _file       = null
    _profileDir = null
    _profileId  = null
  },
})

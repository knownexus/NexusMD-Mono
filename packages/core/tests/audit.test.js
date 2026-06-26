import { describe, it, expect } from 'vitest'
import { appendAuditEntry, readAuditLog } from '../src/index.js'

// In-memory IFileAdapter for explicit-override audit calls.
function memFile(initial = {}) {
  const files = new Map(Object.entries(initial))
  return {
    async read(path) { if (!files.has(path)) throw new Error('ENOENT'); return files.get(path) },
    async write(path, text) { files.set(path, text) },
    async exists(path) { return files.has(path) },
    async list() { return [...files.keys()] },
    async delete(path) { files.delete(path) },
    async mkdir() {},
    async defaultProfileDir() { return '/profiles' },
    _dump: () => Object.fromEntries(files),
  }
}

describe('audit log (explicit fileAdapter override)', () => {
  it('no-ops without a configured profile path', async () => {
    // Module-level state isn't initialised in unit context, and logPath() needs a
    // profileDir/profileId. With no init + an override file, append is a safe no-op.
    const file = memFile()
    await appendAuditEntry({ action: 'test' }, file)
    expect(file._dump()).toEqual({})
    expect(await readAuditLog(file)).toEqual([])
  })

  it('readAuditLog returns [] when the file adapter throws', async () => {
    const broken = { async read() { throw new Error('boom') } }
    expect(await readAuditLog(broken)).toEqual([])
  })

  it('readAuditLog returns [] when no log file exists', async () => {
    // memFile.read throws ENOENT for unknown paths; readAuditLog swallows it.
    expect(await readAuditLog(memFile())).toEqual([])
  })

  // The full append→read JSONL round-trip (including malformed-line skipping) requires
  // the module's init to set the profile dir/id, and is covered in integration.test.js.
})

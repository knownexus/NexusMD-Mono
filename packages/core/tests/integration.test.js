import { describe, it, expect, beforeEach } from 'vitest'
import {
  core, initCore, createNoOpAdapters,
  appendAuditEntry, readAuditLog,
} from '../src/index.js'
import { memStorage, memFile } from './helpers/memory-adapters.js'
import { runStorageAdapterContract } from './contracts/storage-contract.js'

// The in-memory storage adapter must itself satisfy the IStorageAdapter contract,
// otherwise the integration assertions below would be testing a broken fake.
runStorageAdapterContract('memStorage (test double)', () => memStorage())

describe('initCore integration', () => {
  let storage, file

  beforeEach(() => {
    storage = memStorage({
      'nexusmd.profileDir': '/profiles',
      'nexusmd.activeProfileId': 'p1',
    })
    file = memFile()
  })

  it('wires adapters, enables default modules, and runs load() without throwing', async () => {
    await initCore({ ...createNoOpAdapters(), storage, file })

    // Default-enabled modules should be on; digest is defaultEnabled:false.
    expect(core.isEnabled('triage')).toBe(true)
    expect(core.isEnabled('calendar')).toBe(true)
    expect(core.isEnabled('audit')).toBe(true)

    const results = await core.load()
    expect(Array.isArray(results)).toBe(true)
    // Every successful result is shaped { moduleId, data }.
    for (const r of results) expect(r).toHaveProperty('moduleId')
  })

  it('audit module round-trips an entry through the file adapter after init', async () => {
    await initCore({ ...createNoOpAdapters(), storage, file })

    await appendAuditEntry({ action: 'profile.activate', profileId: 'p1' })
    await appendAuditEntry({ action: 'ado.refresh' })

    const log = await readAuditLog()
    expect(log).toHaveLength(2)
    expect(log[0]).toMatchObject({ action: 'profile.activate', profileId: 'p1' })
    expect(log[1]).toMatchObject({ action: 'ado.refresh' })
    expect(typeof log[0].ts).toBe('string') // timestamp stamped on write

    // The log is persisted as JSONL at {profileDir}/{profileId}-audit.jsonl
    expect(file._dump()['/profiles/p1-audit.jsonl']).toContain('profile.activate')
  })

  it('emits profiles:none and falls back to defaults when no profile resolves', async () => {
    let none = false
    core.on('profiles:none', () => { none = true })
    // Empty storage + empty file → no active profile.
    await initCore({ ...createNoOpAdapters(), storage: memStorage(), file: memFile() })
    expect(none).toBe(true)
    expect(core.isEnabled('triage')).toBe(true) // default still applies
  })
})

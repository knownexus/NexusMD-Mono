import { describe, it, expect } from 'vitest'
import { clearAccountLocalData } from '../src/modules/account/account-clear.js'
import { createKeyRegistry } from '../src/modules/account/key-registry.js'
import * as core from '../src/index.js'

const META = 'nexusmd.account.meta'

function setup() {
  const m = new Map(Object.entries({
    'nexusmd.profiles': '[{"id":"a"}]',
    'nexusmd.activeProfileId': 'a',
    'nexusmd.p.a.tweaks': '{"theme":"x"}',
    'nexusmd.planner.week.2026-01': '{"x":1}',
    'nexusmd.planner.globalNotes': 'notes',
    'nexusmd.calendar.events': '[]',
    'nexusmd.lists': '[]',
    'nexusmd.timelog': '[]',
    'nexusmd.sec.ado.pat': 'opaque',
    'nexusmd.sec.account.session': 'opaque-session',
    [META]: '{}',
  }))
  const storage = {
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
  }
  const removed = []
  const secure = { remove: async (n) => { removed.push(n) } }
  return { m, storage, secure, removed, registry: createKeyRegistry({ namespace: 'nexusmd' }) }
}

describe('clearAccountLocalData', () => {
  it('is exported from core', () => {
    expect(core.clearAccountLocalData).toBe(clearAccountLocalData)
  })

  it('removes synced keys, secrets and meta but keeps skipped data and the account session', async () => {
    const { m, storage, secure, removed, registry } = setup()
    await clearAccountLocalData({ registry, storage, secure, metaKey: META })
    for (const k of ['nexusmd.profiles', 'nexusmd.activeProfileId', 'nexusmd.p.a.tweaks', META, 'nexusmd.sec.ado.pat']) {
      expect(m.has(k), k).toBe(false)
    }
    // global content keys are not synced (registry v2 syncs user data only under a profile)
    for (const k of ['nexusmd.planner.week.2026-01', 'nexusmd.planner.globalNotes', 'nexusmd.calendar.events', 'nexusmd.lists', 'nexusmd.timelog', 'nexusmd.sec.account.session']) {
      expect(m.has(k), k).toBe(true)
    }
    expect(removed).toEqual(['ado.pat'])
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createAccountSync } from '../src/modules/account/account-sync.js'
import { createKeyRegistry } from '../src/modules/account/key-registry.js'
import { AccountError } from '../src/modules/account/account-client.js'
import { generateContainerKey, encryptJson, decryptJson, opaqueId } from '../src/modules/account/crypto.js'
import { contentHash } from '../src/modules/sync/hash.js'
import { resolveTarget, validValue } from '../src/modules/account/account-sync-state.js'
import * as core from '../src/index.js'

const META = 'nexusmd.account.meta'

import { fakeStorage, fakeSecure, fakeServer, decryptAll, device } from './helpers/account-fakes.js'

const metaOf = (d) => JSON.parse(d.storage.getItem(META) || 'null')

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

// ---- tests -------------------------------------------------------------------------------

describe('createAccountSync', () => {
  it('is exported from the core root', () => {
    expect(typeof core.createAccountSync).toBe('function')
  })

  it('snapshot lists syncable keys via the registry, splits tweaks and reads secrets', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({
      srv, ck,
      init: {
        'nexusmd.p.1.ado.org': 'contoso',
        'nexusmd.p.1.sidebar.width': '240',
        'nexusmd.planner.week.2026-W40': '{}', // a global key: registry v2 syncs user data only under a profile
        'nexusmd.account.deviceId': 'dev-a',
      },
      secrets: { 'google.auth': 'tok', 'account.session': 'sess' },
    })
    const snap = await a.sync.snapshot()
    expect(snap.get('p.1.ado.org')).toMatchObject({ level: 'account', value: 'contoso', storageKey: 'nexusmd.p.1.ado.org', secret: false })
    expect(snap.get('nexusmd:p.1.sidebar.width')).toMatchObject({ level: 'device', value: '240' })
    expect(snap.get('sec:nexusmd:google.auth')).toMatchObject({ level: 'account', value: 'tok', secret: true })
    const ids = [...snap.keys()]
    expect(ids.some((id) => id.includes('planner'))).toBe(false)
    expect(ids.filter((id) => id.includes('account'))).toEqual([])
    // the tweaks split is Android's (helm keeps the M1 registry rules)
    const phone = device({ srv, ck, ns: 'helm', init: { 'helm.tweaks': JSON.stringify({ theme: 'dark', widgets: ['a'] }) } })
    const psnap = await phone.sync.snapshot()
    expect(psnap.get('tweaks.account')).toMatchObject({ level: 'account', value: { theme: 'dark' } })
    expect(psnap.get('tweaks.device')).toMatchObject({ level: 'device', value: { widgets: ['a'] } })
  })

  it('first push uploads every account key encrypted; the server never sees plaintext', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({
      srv, ck,
      init: {
        'nexusmd.p.1.ado.org': 'contoso-org-value',
        'nexusmd.p.1.team.custom': JSON.stringify({ theme: 'midnight-theme', widgets: ['widget-one-value'] }),
        'nexusmd.profiles': JSON.stringify([{ id: '1', name: 'WorkProfileName' }]),
      },
      secrets: { 'google.auth': 'secret-token-value', 'account.session': 'account-session-value' },
    })
    const r = await a.sync.push()
    expect(r.error).toBeUndefined()
    expect(r.pushed).toBe(4)
    const stored = await decryptAll(srv, ck)
    expect(Object.keys(stored).sort()).toEqual(['nexusmd:p.1.team.custom', 'p.1.ado.org', 'profiles', 'sec:nexusmd:google.auth'])
    expect(stored['p.1.ado.org'].value).toBe('contoso-org-value')
    const wire = srv.requests.join('\n')
    for (const s of ['contoso-org-value', 'midnight-theme', 'WorkProfileName', 'secret-token-value', 'account-session-value',
      'ado.org', 'team.custom', 'profiles', 'google.auth', 'widget-one-value']) {
      expect(wire).not.toContain(s)
    }
  })

  it('an unchanged second push uploads nothing and a changed key uploads once', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'one', 'nexusmd.p.1.github.login': 'me' } })
    await a.sync.push()
    const calls = srv.putCalls
    expect((await a.sync.push()).pushed).toBe(0)
    expect(srv.putCalls).toBe(calls)
    a.storage.setItem('nexusmd.p.1.ado.org', 'two')
    expect((await a.sync.push()).pushed).toBe(1)
    expect((await a.sync.push()).pushed).toBe(0)
    expect((await decryptAll(srv, ck))['p.1.ado.org'].value).toBe('two')
  })

  it('a removed key is pushed as a tombstone and the other device removes it', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x', 'nexusmd.p.1.ado.projects': 'p' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBe('x')
    a.storage.removeItem('nexusmd.p.1.ado.org')
    expect((await a.sync.push()).pushed).toBe(1)
    expect((await decryptAll(srv, ck))['p.1.ado.org'].deleted).toBe(true)
    const r = await b.sync.pull()
    expect(r.applied).toBe(1)
    expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBeNull()
    expect(b.storage.getItem('nexusmd.p.1.ado.projects')).toBe('p')
  })

  it('a locally removed key that was never synced is not tombstoned', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x' } })
    await a.sync.push()
    a.storage.setItem('nexusmd.p.1.ado.projects', 'never-pushed')
    a.storage.removeItem('nexusmd.p.1.ado.projects')
    expect((await a.sync.push()).pushed).toBe(0)
  })

  it('a remote tombstone is not applied when the local value changed since the last sync', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    a.storage.removeItem('nexusmd.p.1.ado.org')
    await a.sync.push()
    b.storage.setItem('nexusmd.p.1.ado.org', 'edited-on-b')
    await b.sync.pull()
    expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBe('edited-on-b')
    // a conflict for the owner (Task 4): nothing is pushed until it is resolved
    expect(b.sync.conflicts()).toMatchObject([{ id: 'p.1.ado.org', remote: { deleted: true } }])
    expect((await b.sync.push()).pushed).toBe(0)
    // keeping B's edit resurrects the key on the server
    expect(await b.sync.resolve('p.1.ado.org', { take: 'local' })).toEqual({})
    await a.sync.pull()
    expect(a.storage.getItem('nexusmd.p.1.ado.org')).toBe('edited-on-b')
  })

  // registry v2: desktop tweaks are a per-profile field map; the split tweaks merge is Android's
  it('two engines converge (A changes, B pulls, B changes later, A pulls)', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, ns: 'helm', init: { 'helm.tweaks': JSON.stringify({ theme: 'light', widgets: ['a1'] }) } })
    await a.sync.syncNow()
    const b = device({ srv, ck, ns: 'helm', deviceId: 'dev-b', init: { 'helm.tweaks': JSON.stringify({ widgets: ['b1'] }) } })
    await b.sync.syncNow()
    expect(JSON.parse(b.storage.getItem('helm.tweaks'))).toEqual({ theme: 'light', widgets: ['b1'] })

    a.storage.setItem('helm.tweaks', JSON.stringify({ theme: 'dark', widgets: ['a1'] }))
    await a.sync.syncNow()
    await b.sync.syncNow()
    expect(JSON.parse(b.storage.getItem('helm.tweaks')).theme).toBe('dark')

    b.storage.setItem('helm.tweaks', JSON.stringify({ theme: 'dim', widgets: ['b1'] }))
    await b.sync.syncNow()
    await a.sync.syncNow()
    expect(JSON.parse(a.storage.getItem('helm.tweaks'))).toEqual({ theme: 'dim', widgets: ['a1'] })
  })

  it('first sync on B keeps a differing shared value as a conflict and pushes B-only keys', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'from-a' } })
    await a.sync.seed()
    const b = device({ srv, ck, deviceId: 'dev-b', init: { 'nexusmd.p.1.ado.org': 'from-b', 'nexusmd.p.1.github.login': 'b-only' } })
    const r = await b.sync.syncNow()
    expect(r.error).toBeUndefined()
    expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBe('from-b')
    expect(b.sync.conflicts().map(c => c.id)).toEqual(['p.1.ado.org'])
    const stored = await decryptAll(srv, ck)
    expect(stored['p.1.ado.org'].value).toBe('from-a')
    expect(stored['p.1.github.login'].value).toBe('b-only')
    await a.sync.pull()
    expect(a.storage.getItem('nexusmd.p.1.github.login')).toBe('b-only')
  })

  // On the desktop, last-writer-wins is the rule for machine-written values (owner-edited ones
  // queue a conflict: account-sync-conflicts.test.js).
  describe('last writer wins by the time an edit was first observed', () => {
    const ORG = 'nexusmd.p.1.seenPr'
    const OID = 'nexusmd:p.1.seenPr'
    async function pair() {
      const srv = fakeServer()
      const ck = await generateContainerKey()
      const clockRef = { t: 100 }
      const now = () => clockRef.t
      const a = device({ srv, ck, init: { [ORG]: 'base' }, now })
      await a.sync.syncNow()
      const b = device({ srv, ck, deviceId: 'dev-b', now })
      await b.sync.syncNow()
      return { srv, ck, a, b, clockRef }
    }

    it('an older offline edit loses to a newer remote edit, everywhere', async () => {
      const { srv, ck, a, b, clockRef } = await pair()
      clockRef.t = 1000
      a.storage.setItem(ORG, 'a-offline-edit')
      srv.fail = 'offline'
      expect((await a.sync.syncNow()).error.code).toBe('offline') // offline, but the edit is observed now
      srv.fail = null
      clockRef.t = 2000
      b.storage.setItem(ORG, 'b-edit')
      await b.sync.syncNow()
      clockRef.t = 3000
      await a.sync.syncNow()
      expect(a.storage.getItem(ORG)).toBe('b-edit')
      expect((await decryptAll(srv, ck))[OID].value).toBe('b-edit')
      await b.sync.syncNow()
      expect(b.storage.getItem(ORG)).toBe('b-edit')
    })

    it('a newer edit wins even when the older edit reaches the server later', async () => {
      const { srv, ck, a, b, clockRef } = await pair()
      clockRef.t = 1000
      b.storage.setItem(ORG, 'b-older-edit')
      await b.sync.observe()
      clockRef.t = 2000
      a.storage.setItem(ORG, 'a-newer-edit')
      await a.sync.observe()
      clockRef.t = 2500
      await b.sync.syncNow() // pushes B's edit, stamped 1000
      expect((await decryptAll(srv, ck))[OID].updatedAt).toBe(1000)
      clockRef.t = 3000
      await a.sync.syncNow()
      expect(a.storage.getItem(ORG)).toBe('a-newer-edit')
      const stored = (await decryptAll(srv, ck))[OID]
      expect(stored.value).toBe('a-newer-edit')
      expect(stored.updatedAt).toBe(2000)
      clockRef.t = 3500
      await b.sync.syncNow()
      expect(b.storage.getItem(ORG)).toBe('a-newer-edit')
    })

    it('a tie goes to the remote value', async () => {
      const { srv, ck, a, b, clockRef } = await pair()
      clockRef.t = 1000
      a.storage.setItem(ORG, 'a-edit')
      await a.sync.observe()
      b.storage.setItem(ORG, 'b-edit')
      await b.sync.syncNow()
      await a.sync.syncNow()
      expect(a.storage.getItem(ORG)).toBe('b-edit')
      expect((await decryptAll(srv, ck))[OID].value).toBe('b-edit')
    })

    it('a local deletion loses to a newer remote edit and beats an older one', async () => {
      const { srv, ck, a, b, clockRef } = await pair()
      clockRef.t = 1000
      a.storage.removeItem(ORG)
      await a.sync.observe()
      clockRef.t = 2000
      b.storage.setItem(ORG, 'b-edit')
      await b.sync.syncNow()
      clockRef.t = 3000
      await a.sync.syncNow()
      expect(a.storage.getItem(ORG)).toBe('b-edit') // restored: the remote edit is newer

      clockRef.t = 4000
      b.storage.setItem(ORG, 'b-older-edit')
      await b.sync.observe()
      clockRef.t = 5000
      a.storage.removeItem(ORG)
      await a.sync.observe()
      clockRef.t = 5500
      await b.sync.syncNow()
      clockRef.t = 6000
      await a.sync.syncNow()
      expect(a.storage.getItem(ORG)).toBeNull()
      expect((await decryptAll(srv, ck))[OID].deleted).toBe(true)
      clockRef.t = 6500
      await b.sync.syncNow()
      expect(b.storage.getItem(ORG)).toBeNull()
    })

    it('a remote updatedAt far in the future is clamped to now + 5 minutes', async () => {
      const { srv, ck, a, b, clockRef } = await pair()
      const skewed = device({ srv, ck, deviceId: 'dev-skew', now: () => clockRef.t + 365 * 24 * 3600 * 1000 })
      await skewed.sync.syncNow()
      skewed.storage.setItem(ORG, 'from-the-future')
      await skewed.sync.syncNow()
      clockRef.t = 1000
      await a.sync.pull()
      expect(a.storage.getItem(ORG)).toBe('from-the-future')
      const m = JSON.parse(a.storage.getItem(META)).entries[OID]
      expect(m.updatedAt).toBe(1000 + 5 * 60 * 1000)
      // a forced re-push does not carry the far-future time on
      await a.sync.seed()
      expect((await decryptAll(srv, ck))[OID].updatedAt).toBeLessThanOrEqual(1000 + 5 * 60 * 1000)
      expect(b.storage.getItem(ORG)).toBe('base')
    })
  })

  describe('a joining device never overwrites account values', () => {
    for (const op of ['push', 'seed']) {
      it(`${op}() before any pull keeps the remote value and uploads only local-only keys`, async () => {
        const srv = fakeServer()
        const ck = await generateContainerKey()
        const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'from-a' } })
        await a.sync.seed()
        const b = device({ srv, ck, deviceId: 'dev-b', init: { 'nexusmd.p.1.ado.org': 'from-b', 'nexusmd.p.1.github.login': 'b-only' } })
        const r = await b.sync[op]()
        expect(r.error).toBeUndefined()
        const stored = await decryptAll(srv, ck)
        expect(stored['p.1.ado.org'].value).toBe('from-a')
        expect(stored['p.1.github.login'].value).toBe('b-only')
        // neither side is overwritten: B's differing value waits for the owner
        expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBe('from-b')
        expect(b.sync.conflicts().map(c => c.id)).toEqual(['p.1.ado.org'])
      })
    }
  })

  it('a stale push conflicts, re-pulls, re-merges and retries once', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    // a machine-written value (last writer wins); an owner-edited one would queue a conflict
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'base', 'nexusmd.p.1.seenPr': 'pat' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    a.storage.setItem('nexusmd.p.1.seenPr', 'pat-from-a')
    await a.sync.push()
    b.storage.setItem('nexusmd.p.1.seenPr', 'pat-from-b')
    const r = await b.sync.push() // B has not pulled A's write: ifMatch is stale
    expect(r.error).toBeUndefined()
    expect(r.conflicts).toBe(0)
    expect(r.pushed).toBe(1)
    expect((await decryptAll(srv, ck))['nexusmd:p.1.seenPr'].value).toBe('pat-from-b')
    await a.sync.pull()
    expect(a.storage.getItem('nexusmd.p.1.seenPr')).toBe('pat-from-b')
  })

  it('quota rejections are reported and not re-sent until the value changes', async () => {
    const srv = fakeServer({ quotaBytes: 400 })
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'small', 'nexusmd.p.1.big.blob': 'x'.repeat(300) } })
    const r = await a.sync.push()
    expect(r.pushed).toBe(1)
    expect(r.quota).toEqual(['nexusmd:p.1.big.blob'])
    expect(r.tooLarge).toEqual([])
    const calls = srv.putCalls
    const again = await a.sync.syncNow()
    expect(again.pushed).toBe(0)
    expect(again.quota).toEqual(['nexusmd:p.1.big.blob'])
    expect(srv.putCalls).toBe(calls)
    a.storage.setItem('nexusmd.p.1.big.blob', 'fits')
    const third = await a.sync.push()
    expect(third.pushed).toBe(1)
    expect(third.quota).toEqual([])
  })

  it('too_large items are skipped and reported', async () => {
    const srv = fakeServer({ maxBytes: 300 })
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'small', 'nexusmd.p.1.big.blob': 'x'.repeat(1000) } })
    const r = await a.sync.push()
    expect(r.pushed).toBe(1)
    expect(r.tooLarge).toEqual(['nexusmd:p.1.big.blob'])
    const calls = srv.putCalls
    const again = await a.sync.syncNow()
    expect(again.pushed).toBe(0)
    expect(again.tooLarge).toEqual(['nexusmd:p.1.big.blob']) // still reported, not re-sent
    expect(srv.putCalls).toBe(calls)
    // a new local value is tried again
    a.storage.setItem('nexusmd.p.1.big.blob', 'y'.repeat(1000))
    await a.sync.push()
    expect(srv.putCalls).toBe(calls + 1)
    a.storage.setItem('nexusmd.p.1.big.blob', 'small now')
    expect((await a.sync.push()).pushed).toBe(1)
    expect((await a.sync.push()).tooLarge).toEqual([])
  })

  it('secrets round trip through the secure adapter; account secrets never leave', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, secrets: { 'google.auth': 'g-token', 'account.session': 's', 'account.keys': 'k' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    expect(b.secure.set).toHaveBeenCalledWith('google.auth', 'g-token')
    expect(await b.secure.get('google.auth')).toBe('g-token')
    expect([...b.storage.map.values()].join('|')).not.toContain('g-token') // only the adapter holds it
    expect([...a.storage.map.values()].join('|')).not.toContain('g-token')
    expect(await b.secure.get('account.session')).toBeNull()
    const ids = Object.keys(await decryptAll(srv, ck))
    expect(ids).toEqual(['sec:nexusmd:google.auth'])
    // removal propagates through secure.remove
    await a.secure.remove('google.auth')
    await a.sync.push()
    await b.sync.pull()
    expect(b.secure.remove).toHaveBeenCalledWith('google.auth')
    expect(await b.secure.get('google.auth')).toBeNull()
  })

  it('a secret whose secure entry cannot be read is neither pushed nor tombstoned', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, secrets: { 'google.auth': 'g-token' } })
    await a.sync.push()
    a.secure.vals.delete('google.auth') // the blob key is still in storage but get() now fails
    expect((await a.sync.push()).pushed).toBe(0)
    expect((await decryptAll(srv, ck))['sec:nexusmd:google.auth'].deleted).toBeFalsy()
  })

  describe('an unreadable local entry', () => {
    const NAME = 'google.auth'
    async function synced() {
      const srv = fakeServer()
      const ck = await generateContainerKey()
      const clockRef = { t: 100 }
      const now = () => clockRef.t
      const a = device({ srv, ck, secrets: { [NAME]: 't-old' }, now })
      await a.sync.syncNow()
      const b = device({ srv, ck, deviceId: 'dev-b', now })
      await b.sync.syncNow()
      const real = a.secure.get.getMockImplementation()
      const lock = (impl) => a.secure.get.mockImplementation(async (n) => (n === NAME ? impl() : real(n)))
      const unlock = () => a.secure.get.mockImplementation(real)
      return { srv, ck, a, b, clockRef, lock, unlock }
    }

    it('keeps an unpushed local secret edit while the keystore is locked, and reconciles it once readable', async () => {
      const { srv, ck, a, b, clockRef, lock, unlock } = await synced()
      clockRef.t = 1000
      await b.secure.set(NAME, 't-remote-older')
      await b.sync.observe()
      clockRef.t = 2000
      await a.secure.set(NAME, 't-local')
      await a.sync.observe()
      lock(() => null) // the stored blob is still there, it just does not open right now
      clockRef.t = 2500
      await b.sync.syncNow()
      clockRef.t = 3000
      const r = await a.sync.pull()
      expect(r.error).toBeUndefined()
      expect(r.applied).toBe(0)
      expect(a.secure.vals.get(NAME)).toBe('t-local')
      expect(a.secure.set).not.toHaveBeenCalledWith(NAME, 't-remote-older')
      unlock()
      clockRef.t = 3500
      await a.sync.syncNow() // the held item is fetched again; A's edit (2000) beats B's (1000)
      expect(a.secure.vals.get(NAME)).toBe('t-local')
      expect((await decryptAll(srv, ck))[`sec:nexusmd:${NAME}`].value).toBe('t-local')
    })

    it('repairs a locked or broken secret from the remote when there is no pending local edit', async () => {
      const { a, b, lock } = await synced()
      lock(() => null)
      await b.secure.set(NAME, 't-remote')
      await b.sync.syncNow()
      const r = await a.sync.pull()
      expect(r.applied).toBe(1)
      expect(a.secure.vals.get(NAME)).toBe('t-remote')
    })

    it('stays safe when secure.get throws', async () => {
      const { a, b, clockRef, lock } = await synced()
      clockRef.t = 1000
      await a.secure.set(NAME, 't-local')
      await a.sync.observe()
      lock(() => { throw new Error('keystore unavailable') })
      clockRef.t = 2000
      await b.secure.set(NAME, 't-remote')
      await b.sync.syncNow()
      const r = await a.sync.pull()
      expect(r.error).toBeUndefined()
      expect(a.secure.vals.get(NAME)).toBe('t-local')
      expect(a.secure.set).not.toHaveBeenCalledWith(NAME, 't-remote')
    })

    it('keeps unreadable tweaks with a pending edit, and repairs them from the remote without one', async () => {
      const srv = fakeServer()
      const ck = await generateContainerKey()
      const clockRef = { t: 100 }
      const now = () => clockRef.t
      const T = 'helm.tweaks' // the split tweaks are Android's (registry v2)
      const a = device({ srv, ck, ns: 'helm', init: { [T]: JSON.stringify({ theme: 'dark' }) }, now })
      await a.sync.syncNow()
      const b = device({ srv, ck, ns: 'helm', deviceId: 'dev-b', now })
      await b.sync.syncNow()
      clockRef.t = 1000
      a.storage.setItem(T, JSON.stringify({ theme: 'light' }))
      await a.sync.observe()
      a.storage.setItem(T, '{not json') // the local value exists but cannot be read
      clockRef.t = 2000
      b.storage.setItem(T, JSON.stringify({ theme: 'dim' }))
      await b.sync.syncNow()
      await a.sync.pull()
      expect(a.storage.getItem(T)).toBe('{not json')

      const c = device({ srv, ck, ns: 'helm', deviceId: 'dev-c', init: { [T]: JSON.stringify({ theme: 'dim' }) }, now })
      await c.sync.syncNow()
      c.storage.setItem(T, '{broken')
      clockRef.t = 3000
      b.storage.setItem(T, JSON.stringify({ theme: 'sepia' }))
      await b.sync.syncNow()
      await c.sync.pull()
      expect(JSON.parse(c.storage.getItem(T))).toEqual({ theme: 'sepia' })
    })
  })

  it('profiles are unioned by id instead of last-writer-wins', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.profiles': JSON.stringify([{ id: '1', name: 'Work' }]) } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b', init: { 'nexusmd.profiles': JSON.stringify([{ id: '2', name: 'Home' }]) } })
    await b.sync.syncNow()
    const ids = (d) => JSON.parse(d.storage.getItem('nexusmd.profiles')).map((p) => p.id).sort()
    expect(ids(b)).toEqual(['1', '2'])
    await a.sync.syncNow()
    expect(ids(a)).toEqual(['1', '2'])
  })

  describe('a new device gets an active profile', () => {
    const PROFILES = JSON.stringify([{ id: 'p1', name: 'Work' }, { id: 'p2', name: 'Home' }])

    it('desktop: the first restored profile becomes active, so the app reads the restored connection', async () => {
      const srv = fakeServer()
      const ck = await generateContainerKey()
      const a = device({ srv, ck, init: { 'nexusmd.profiles': PROFILES, 'nexusmd.activeProfileId': 'p2', 'nexusmd.p.p1.ado.org': 'contoso' } })
      await a.sync.seed()
      const b = device({ srv, ck, deviceId: 'dev-b' })
      const r = await b.sync.pull()
      expect(r.error).toBeUndefined()
      expect(b.storage.getItem('nexusmd.activeProfileId')).toBe('p1')
      // the app's normal read path (shell-sdk / profile-keys bind makeProfileKeys the same way)
      const { getProfileKey } = core.makeProfileKeys({ namespace: 'nexusmd', getActiveId: () => b.storage.getItem('nexusmd.activeProfileId') })
      expect(b.storage.getItem(getProfileKey('ado.org'))).toBe('contoso')
    })

    it('Android: the active profile is set before the account tweaks land, so the theme is in the key the app reads', async () => {
      const srv = fakeServer()
      const ck = await generateContainerKey()
      // registry v2: desktop no longer syncs the shared tweaks halves, so another Android device seeds them
      const a = device({ srv, ck, ns: 'helm', deviceId: 'phone-a', init: { 'helm.profiles': PROFILES, 'helm.tweaks': JSON.stringify({ theme: 'dark' }), 'helm.p.p1.android.org': 'contoso' } })
      await a.sync.seed()
      let st = null
      const phone = device({ srv, ck, ns: 'helm', deviceId: 'phone', getActiveProfileId: () => st.getItem('helm.activeProfileId') })
      st = phone.storage
      const r = await phone.sync.pull()
      expect(r.error).toBeUndefined()
      expect(st.getItem('helm.activeProfileId')).toBe('p1')
      const { getProfileKey } = core.makeProfileKeys({ namespace: 'helm', bareWhenInactive: true, getActiveId: () => st.getItem('helm.activeProfileId') })
      expect(st.getItem(getProfileKey('helm.android.org'))).toBe('contoso')
      expect(JSON.parse(st.getItem(getProfileKey('helm.tweaks')))).toEqual({ theme: 'dark' })
      expect(st.getItem('helm.tweaks')).toBeNull()
    })

    it('keeps an active profile that exists, and a reinstall restores its own active profile', async () => {
      const srv = fakeServer()
      const ck = await generateContainerKey()
      const a = device({ srv, ck, init: { 'nexusmd.profiles': PROFILES, 'nexusmd.activeProfileId': 'p2' } })
      await a.sync.seed()
      const again = device({ srv, ck, deviceId: 'dev-a' })
      await again.sync.pull()
      expect(again.storage.getItem('nexusmd.activeProfileId')).toBe('p2')
      const c = device({ srv, ck, deviceId: 'dev-c', init: { 'nexusmd.activeProfileId': 'p2' } })
      await c.sync.pull()
      expect(c.storage.getItem('nexusmd.activeProfileId')).toBe('p2')
    })

    it('an unknown active id is replaced; no profiles leaves it alone', async () => {
      const srv = fakeServer()
      const ck = await generateContainerKey()
      const a = device({ srv, ck, init: { 'nexusmd.profiles': PROFILES } })
      await a.sync.seed()
      const b = device({ srv, ck, deviceId: 'dev-b', init: { 'nexusmd.activeProfileId': 'gone' } })
      await b.sync.pull()
      expect(b.storage.getItem('nexusmd.activeProfileId')).toBe('p1')
      const empty = device({ srv: fakeServer(), ck, deviceId: 'dev-e' })
      await empty.sync.pull()
      expect(empty.storage.getItem('nexusmd.activeProfileId')).toBeNull()
    })
  })

  it('device prefs, device-level keys and the tweaks device half go to the device blob, not the item feed', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const shell = { closeToTray: true, zoomFactor: 1.2 }
    const devicePrefs = { collect: vi.fn(async () => shell), apply: vi.fn(async () => {}) }
    const a = device({
      srv, ck, devicePrefs,
      // registry v2: desktop keys live under a profile; only sidebar.width stays device level
      init: { 'nexusmd.p.1.sidebar.width': '300', 'nexusmd.p.1.team.custom': 'tc', 'nexusmd.activeProfileId': '1' },
    })
    await a.sync.push()
    const items = await decryptAll(srv, ck)
    expect(Object.keys(items)).toEqual(['nexusmd:p.1.team.custom'])
    expect(items['nexusmd:p.1.team.custom'].value).toBe('tc')
    const blob = await decryptJson(srv.prefs.get('dev-a').ciphertext, ck, 'nexusmd-device-prefs|dev-a')
    expect(blob.prefs).toEqual(shell)
    expect(blob.entries['nexusmd:p.1.sidebar.width'].value).toBe('300')
    expect(blob.entries.activeProfileId.value).toBe('1')
    expect(srv.requests.join('\n')).not.toContain('closeToTray')

    // unchanged: no second blob write
    const rev = srv.prefs.get('dev-a').revision
    await a.sync.push()
    expect(srv.prefs.get('dev-a').revision).toBe(rev)

    // a reinstall of the same device restores account items and the device blob
    const apply = vi.fn(async () => {})
    const again = device({ srv, ck, deviceId: 'dev-a', devicePrefs: { collect: async () => ({}), apply } })
    const r = await again.sync.pull()
    expect(r.applied).toBeGreaterThan(0)
    expect(again.storage.getItem('nexusmd.p.1.sidebar.width')).toBe('300')
    expect(again.storage.getItem('nexusmd.activeProfileId')).toBe('1')
    expect(again.storage.getItem('nexusmd.p.1.team.custom')).toBe('tc')
    expect(apply).toHaveBeenCalledWith(shell)

    // another device does not get dev-a's device prefs
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.pull()
    expect(b.storage.getItem('nexusmd.p.1.sidebar.width')).toBeNull()
    expect(b.storage.getItem('nexusmd.p.1.team.custom')).toBe('tc')

    // the tweaks device half (Android's split tweaks) goes to the device blob too
    const psrv = fakeServer()
    const phone = device({ srv: psrv, ck, ns: 'helm', deviceId: 'phone', devicePrefs, init: { 'helm.tweaks': JSON.stringify({ theme: 'dark', widgets: ['w'] }) } })
    await phone.sync.push()
    const pitems = await decryptAll(psrv, ck)
    expect(Object.keys(pitems)).toEqual(['tweaks.account'])
    expect(pitems['tweaks.account'].value).toEqual({ theme: 'dark' })
    const pblob = await decryptJson(psrv.prefs.get('phone').ciphertext, ck, 'nexusmd-device-prefs|phone')
    expect(pblob.entries['tweaks.device'].value).toEqual({ widgets: ['w'] })
    const phoneAgain = device({ srv: psrv, ck, ns: 'helm', deviceId: 'phone', devicePrefs: { collect: async () => ({}), apply: async () => {} } })
    await phoneAgain.sync.pull()
    expect(JSON.parse(phoneAgain.storage.getItem('helm.tweaks'))).toEqual({ theme: 'dark', widgets: ['w'] })
    const otherPhone = device({ srv: psrv, ck, ns: 'helm', deviceId: 'phone-b' })
    await otherPhone.sync.pull()
    expect(JSON.parse(otherPhone.storage.getItem('helm.tweaks'))).toEqual({ theme: 'dark' })
  })

  describe('a device removed from the account (device prefs answer 404)', () => {
    const removedServer = () => {
      const srv = fakeServer()
      const gone = () => { throw new AccountError('not-found', 404, 'device not found') }
      srv.removeDevice = (id) => {
        const { getDevicePrefs, putDevicePrefs } = srv.client
        srv.client.getDevicePrefs = async (d) => (d === id ? gone() : getDevicePrefs(d))
        srv.client.putDevicePrefs = async (d, ...rest) => (d === id ? gone() : putDevicePrefs(d, ...rest))
      }
      return srv
    }

    it('syncNow still pushes account items and reports not-found through onError', async () => {
      const srv = removedServer()
      const ck = await generateContainerKey()
      const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x', 'nexusmd.p.1.sidebar.width': '300' } })
      await a.sync.syncNow()
      srv.removeDevice('dev-a')
      a.storage.setItem('nexusmd.p.1.ado.org', 'y')
      const errors = []
      a.sync.onError((e) => errors.push(e))
      const r = await a.sync.syncNow()
      expect(r.error).toMatchObject({ name: 'AccountError', code: 'not-found' })
      expect(errors.map((e) => e.code)).toEqual(['not-found'])
      expect((await decryptAll(srv, ck))['p.1.ado.org'].value).toBe('y')
      // and again on the next sync: still pushing, still reporting
      a.storage.setItem('nexusmd.p.1.ado.org', 'z')
      const r2 = await a.sync.syncNow()
      expect(r2.error).toMatchObject({ code: 'not-found' })
      expect((await decryptAll(srv, ck))['p.1.ado.org'].value).toBe('z')
    })

    it('push and seed report it too after pushing items', async () => {
      const srv = removedServer()
      const ck = await generateContainerKey()
      srv.removeDevice('dev-a')
      const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x', 'nexusmd.p.1.sidebar.width': '300' } })
      const r = await a.sync.seed()
      expect(r.error).toMatchObject({ code: 'not-found' })
      expect((await decryptAll(srv, ck))['p.1.ado.org'].value).toBe('x')
    })
  })

  it('a stale device blob write conflicts, re-pulls the blob and retries', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const first = device({ srv, ck, deviceId: 'dev-a', init: { 'nexusmd.p.1.sidebar.width': '300' } })
    await first.sync.push()
    const second = device({ srv, ck, deviceId: 'dev-a', init: { 'nexusmd.p.1.sidebar.width': '200', 'nexusmd.p.2.sidebar.width': '222' } })
    const r = await second.sync.push() // never pulled: If-Match 0 is stale
    expect(r.error).toBeUndefined()
    expect(r.conflicts).toBe(0)
    expect(second.storage.getItem('nexusmd.p.1.sidebar.width')).toBe('300') // first sync: remote wins
    const blob = await decryptJson(srv.prefs.get('dev-a').ciphertext, ck, 'nexusmd-device-prefs|dev-a')
    expect(blob.entries['nexusmd:p.1.sidebar.width'].value).toBe('300')
    expect(blob.entries['nexusmd:p.2.sidebar.width'].value).toBe('222')
    expect(srv.prefs.get('dev-a').revision).toBe(2)
  })

  it('an empty change feed never deletes local keys', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBe('x')
    const cursor = metaOf(b).cursor
    expect(cursor).toBeGreaterThan(0)
    // the server still holds the items but answers with an empty feed (and even a reset cursor)
    srv.client.getChanges = async () => ({ items: [], cursor: 0 })
    const applied = vi.fn()
    b.sync.onApplied(applied)
    const r = await b.sync.syncNow()
    expect(r.error).toBeUndefined()
    expect(r.applied).toBe(0)
    expect(r.pushed).toBe(0)
    expect(applied).not.toHaveBeenCalled()
    expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBe('x')
    expect(metaOf(b).cursor).toBe(cursor)
    expect((await decryptAll(srv, ck))['p.1.ado.org'].deleted).toBeFalsy()
  })

  it('a failed pull returns { error }, deletes nothing and leaves meta untouched', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x' }, secrets: { 'google.auth': 't' } })
    await a.sync.syncNow()
    a.storage.setItem('nexusmd.p.1.ado.org', 'changed-while-offline') // so push needs the network
    const before = new Map(a.storage.map)
    before.delete(META)
    const serverState = (m) => ({ cursor: m.cursor, entries: Object.fromEntries(Object.entries(m.entries).map(([id, e]) => [id, [e.hash, e.revision, e.deleted]])) })
    const metaBefore = serverState(metaOf(a))
    srv.fail = 'offline'
    for (const op of ['pull', 'push', 'syncNow', 'seed']) {
      const r = await a.sync[op]()
      expect(r.error).toBeInstanceOf(AccountError)
      expect(r.error.code).toBe('offline')
    }
    const after = new Map(a.storage.map)
    after.delete(META)
    expect(after).toEqual(before)
    // meta may only gain the observation stamp of the offline edit
    expect(serverState(metaOf(a))).toEqual(metaBefore)
    expect(metaOf(a).entries['p.1.ado.org'].changedAt).toBeGreaterThan(0)
    expect(await a.secure.get('google.auth')).toBe('t')
  })

  it('session-expired is surfaced to onError and the caller without wiping anything', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x' } })
    await a.sync.syncNow()
    const before = new Map(a.storage.map)
    const onError = vi.fn()
    a.sync.onError(onError)
    srv.fail = 'session-expired'
    const r = await a.sync.syncNow()
    expect(r.error.code).toBe('session-expired')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'session-expired' }))
    // nothing changes but the error noted for status() (Task 6)
    const after = new Map(a.storage.map)
    const { lastError, ...meta } = JSON.parse(after.get(META))
    expect(lastError).toBeTruthy()
    after.set(META, JSON.stringify(meta))
    expect(after).toEqual(before)
  })

  it('ignores items whose ciphertext was swapped or whose payload id does not match the wire id', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'org', 'nexusmd.p.1.ado.projects': 'pat' } })
    await a.sync.seed()
    const wOrg = await opaqueId('p.1.ado.org', ck)
    const wPat = await opaqueId('p.1.ado.projects', ck)
    // 1. server swaps ciphertexts between the two items
    srv.tamper = (list) => list.map((i) => (i.id === wOrg ? { ...i, ciphertext: srv.items.get(wPat).ciphertext }
      : i.id === wPat ? { ...i, ciphertext: srv.items.get(wOrg).ciphertext } : i))
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.pull()
    expect(b.storage.getItem('nexusmd.p.1.ado.org')).toBeNull()
    expect(b.storage.getItem('nexusmd.p.1.ado.projects')).toBeNull()
    // 2. a validly encrypted payload whose inner id names another entry
    srv.tamper = null
    const forged = await encryptJson({ id: 'p.1.ado.projects', value: 'evil', updatedAt: 1 }, ck, `nexusmd-item|${wOrg}`)
    srv.items.set(wOrg, { ...srv.items.get(wOrg), ciphertext: forged, cursor: 99, revision: 5 })
    const c = device({ srv, ck, deviceId: 'dev-c' })
    await c.sync.pull()
    expect(c.storage.getItem('nexusmd.p.1.ado.projects')).toBe('pat')
    expect(c.storage.getItem('nexusmd.p.1.ado.org')).toBeNull()
  })

  it('ignores items of the other platform and ids the registry rejects', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const android = device({ srv, ck, ns: 'helm', deviceId: 'phone', init: { 'helm.p.1.android.org': 'shared-org', 'helm.p.1.google.auth': 'g' } })
    await android.sync.push()
    // a forged item naming a key the registry never syncs
    const bad = 'nexusmd:sec.account.keys'
    const w = await opaqueId(bad, ck)
    await srv.client.putItems([{ id: w, ifMatch: 0, ciphertext: await encryptJson({ id: bad, value: 'x', updatedAt: 1 }, ck, `nexusmd-item|${w}`) }])
    const desk = device({ srv, ck, deviceId: 'pc' })
    await desk.sync.pull()
    expect(desk.storage.getItem('nexusmd.p.1.ado.org')).toBe('shared-org')
    expect([...desk.storage.map.keys()].filter((k) => k !== META)).toEqual(['nexusmd.p.1.ado.org'])
  })

  it('never pushes nexusmd.sec.account.* or the meta record', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.account.deviceId': 'dev-a' }, secrets: { 'account.session': 'S', 'account.keys': 'K' } })
    await a.sync.seed()
    await a.sync.syncNow()
    expect(srv.items.size).toBe(0)
    expect(a.secure.get).not.toHaveBeenCalledWith('account.session')
  })

  it('seed pushes everything local regardless of meta', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x', 'nexusmd.p.1.ado.projects': 'y' } })
    const r = await a.sync.seed()
    expect(r.pushed).toBe(2)
    expect(metaOf(a).entries['p.1.ado.org'].revision).toBe(1)
  })

  it('pages through the change feed and stores the cursor', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const init = {}
    for (let i = 0; i < 120; i++) init[`nexusmd.p.1.k${i}`] = `v${i}`
    const a = device({ srv, ck, init })
    await a.sync.seed()
    const orig = srv.client.getChanges
    srv.client.getChanges = (since) => orig(since, 50)
    const b = device({ srv, ck, deviceId: 'dev-b' })
    const r = await b.sync.pull()
    expect(r.applied).toBe(120)
    expect(metaOf(b).cursor).toBe(120)
    expect((await b.sync.pull()).applied).toBe(0)
  })

  describe('change feed paging (hasMore)', () => {
    async function seeded(n, opts) {
      const srv = fakeServer(opts)
      const ck = await generateContainerKey()
      const init = {}
      for (let i = 0; i < n; i++) init[`nexusmd.p.1.k${i}`] = `v${i}`
      const a = device({ srv, ck, init })
      await a.sync.seed()
      return { srv, ck }
    }

    it('collects every item across byte-limited pages that hold fewer items than the limit', async () => {
      const { srv, ck } = await seeded(120, { pageBytes: 1000 })
      const b = device({ srv, ck, deviceId: 'dev-b' })
      srv.changesCalls = 0
      const r = await b.sync.pull()
      expect(r.error).toBeUndefined()
      expect(r.applied).toBe(120)
      expect(srv.changesCalls).toBeGreaterThan(5) // many short pages, each with hasMore: true
      expect(metaOf(b).cursor).toBe(120)
      for (let i = 0; i < 120; i++) expect(b.storage.getItem(`nexusmd.p.1.k${i}`)).toBe(`v${i}`)
    })

    it('stops on hasMore: false even when the page is full', async () => {
      const { srv, ck } = await seeded(100)
      const b = device({ srv, ck, deviceId: 'dev-b', pageSize: 50 })
      srv.changesCalls = 0
      expect((await b.sync.pull()).applied).toBe(100)
      expect(srv.changesCalls).toBe(2)
    })

    it('falls back to "a full page means more" when the server omits hasMore', async () => {
      const { srv, ck } = await seeded(120, { legacy: true })
      const b = device({ srv, ck, deviceId: 'dev-b', pageSize: 50 })
      srv.changesCalls = 0
      expect((await b.sync.pull()).applied).toBe(120)
      expect(srv.changesCalls).toBe(3) // 50, 50, 20: a short page ends the feed
      expect(metaOf(b).cursor).toBe(120)
      const c = device({ srv, ck, deviceId: 'dev-c' }) // default page of 500: one request
      srv.changesCalls = 0
      expect((await c.sync.pull()).applied).toBe(120)
      expect(srv.changesCalls).toBe(1)
    })

    for (const [name, page] of [
      ['an empty page', (since) => ({ items: [], cursor: since, hasMore: true })],
      ['the same items again', (since, first) => ({ items: first, cursor: since, hasMore: true })],
    ]) {
      it(`a hasMore: true page that does not advance the cursor (${name}) ends with a server error and changes nothing`, async () => {
        const { srv, ck } = await seeded(3)
        const b = device({ srv, ck, deviceId: 'dev-b', init: { 'nexusmd.p.1.k0': 'local-b', 'nexusmd.p.1.other': 'keep' } })
        await b.sync.syncNow()
        const before = new Map(b.storage.map)
        const cursor = metaOf(b).cursor
        const first = (await srv.client.getChanges(0)).items
        let calls = 0
        srv.client.getChanges = async (since) => { calls++; return page(since, first) }
        const r = await b.sync.pull()
        expect(r.error).toBeInstanceOf(AccountError)
        expect(r.error.code).toBe('server')
        expect(calls).toBe(1)
        expect(b.storage.map).toEqual(before)
        expect(metaOf(b).cursor).toBe(cursor)
      })
    }

    it('caps a pull at 1000 pages and continues from there next time', async () => {
      const srv = fakeServer()
      const ck = await generateContainerKey()
      const b = device({ srv, ck, deviceId: 'dev-b' })
      let calls = 0
      srv.client.getChanges = async (since) => { calls++; return { items: [], cursor: since + 1, hasMore: true } }
      const r = await b.sync.pull()
      expect(r.error).toBeUndefined()
      expect(calls).toBe(1000)
      expect(metaOf(b).cursor).toBe(1000)
    })
  })

  it('onApplied fires only when a pull changed local data', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x' } })
    await a.sync.seed()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    const cb = vi.fn()
    const off = b.sync.onApplied(cb)
    await b.sync.pull()
    expect(cb).toHaveBeenCalledTimes(1)
    await b.sync.pull()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    a.storage.setItem('nexusmd.p.1.ado.org', 'y')
    await a.sync.push()
    await b.sync.pull()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('a listener that throws does not break the pull, and is logged', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.p.1.ado.org': 'x' } })
    await a.sync.seed()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const second = vi.fn()
    b.sync.onApplied(() => { throw new Error('listener bug') })
    b.sync.onApplied(second)
    await b.sync.pull()
    expect(second).toHaveBeenCalledTimes(1)   // the next listener still runs
    expect(warn.mock.calls.map((c) => c[0])).toContain('[sync:account] ignored: a sync listener threw; it must not break sync')
    warn.mockRestore()
  })

  it('start() syncs on an interval, on visibilitychange and online; overlapping syncs coalesce; stop() detaches', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const docListeners = {}
    const winListeners = {}
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (t, f) => { docListeners[t] = f },
      removeEventListener: (t, f) => { if (docListeners[t] === f) delete docListeners[t] },
    })
    vi.stubGlobal('addEventListener', (t, f) => { winListeners[t] = f })
    vi.stubGlobal('removeEventListener', (t, f) => { if (winListeners[t] === f) delete winListeners[t] })
    const srv = fakeServer()
    let calls = 0
    const orig = srv.client.getChanges
    srv.client.getChanges = async (...args) => { calls++; return orig(...args) }
    const ck = await generateContainerKey()
    const storage = fakeStorage()
    const sync = createAccountSync({
      client: srv.client, containerKey: ck, registry: createKeyRegistry({ namespace: 'nexusmd' }),
      storage, secure: fakeSecure(storage), devicePrefs: null, deviceId: 'd', metaKey: META, intervalMs: 1000,
    })
    sync.start()
    sync.start() // idempotent
    const p = sync.syncNow() // overlaps the start() sync
    expect(await p).toEqual({ skipped: 'in-flight' })
    await vi.waitFor(() => expect(calls).toBe(1))
    await new Promise((r) => setTimeout(r, 20))
    vi.advanceTimersByTime(1000)
    await vi.waitFor(() => expect(calls).toBe(2))
    await new Promise((r) => setTimeout(r, 20))
    docListeners.visibilitychange()
    await vi.waitFor(() => expect(calls).toBe(3))
    await new Promise((r) => setTimeout(r, 20))
    winListeners.online()
    await vi.waitFor(() => expect(calls).toBe(4))
    sync.stop()
    expect(docListeners.visibilitychange).toBeUndefined()
    expect(winListeners.online).toBeUndefined()
    vi.advanceTimersByTime(5000)
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toBe(4)
  })

  it('start() is safe without document or window listeners (non-browser)', () => {
    const srv = fakeServer()
    const storage = fakeStorage()
    const sync = createAccountSync({
      client: srv.client, containerKey: {}, registry: createKeyRegistry({ namespace: 'nexusmd' }),
      storage, secure: fakeSecure(storage), devicePrefs: null, deviceId: 'd', metaKey: META,
    })
    expect(() => { sync.start(); sync.stop() }).not.toThrow()
  })
})

describe('createAccountSync data-safety rules', () => {
  it('profiles: an unpushed local rename survives a concurrent remote addition', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const P = 'nexusmd.profiles'
    const a = device({ srv, ck, init: { [P]: JSON.stringify([{ id: '1', name: 'Work' }]) } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    a.storage.setItem(P, JSON.stringify([{ id: '1', name: 'Office' }]))
    b.storage.setItem(P, JSON.stringify([{ id: '1', name: 'Work' }, { id: '2', name: 'Home' }]))
    await b.sync.syncNow()
    await a.sync.syncNow()
    await b.sync.syncNow()
    const norm = (raw) => JSON.parse(raw).map((p) => `${p.id}:${p.name}`).sort()
    expect(norm(a.storage.getItem(P))).toEqual(['1:Office', '2:Home'])
    expect(norm(b.storage.getItem(P))).toEqual(['1:Office', '2:Home'])
    expect(norm((await decryptAll(srv, ck)).profiles.value)).toEqual(['1:Office', '2:Home'])
    // converged: nothing left to push on either side
    expect((await a.sync.syncNow()).pushed).toBe(0)
    expect((await b.sync.syncNow()).pushed).toBe(0)
  })

  it('JSON values that differ only in key order cause no re-push and no onApplied', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({
      srv, ck,
      init: {
        'nexusmd.p.1.custom.obj': '{"a":1,"b":[1,2]}',
        'nexusmd.profiles': JSON.stringify([{ id: '1', name: 'W' }]),
      },
    })
    await a.sync.seed()
    const b = device({
      srv, ck, deviceId: 'dev-b',
      init: {
        'nexusmd.p.1.custom.obj': '{ "b": [1, 2], "a": 1 }',
        'nexusmd.profiles': '[{"name":"W","id":"1"}]',
      },
    })
    const applied = vi.fn()
    b.sync.onApplied(applied)
    const calls = srv.putCalls
    const r = await b.sync.syncNow()
    expect(r.applied).toBe(0)
    expect(r.pushed).toBe(0)
    expect(applied).not.toHaveBeenCalled()
    expect(srv.putCalls).toBe(calls)
    expect(b.storage.getItem('nexusmd.p.1.custom.obj')).toBe('{ "b": [1, 2], "a": 1 }')
  })

  it('skips an entry whose local value changes while the pull is running and reconciles it next sync', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const ORG = 'nexusmd.p.1.ado.org'
    const a = device({ srv, ck, init: { [ORG]: 'v1' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    a.storage.setItem(ORG, 'v2')
    await a.sync.syncNow()
    const orig = b.storage.getItem
    let reads = 0
    // the first read is the snapshot; the user types before the engine gets to write
    b.storage.getItem = (k) => {
      if (k === ORG && ++reads === 2) b.storage.map.set(ORG, 'typed-meanwhile')
      return orig(k)
    }
    const r = await b.sync.pull()
    b.storage.getItem = orig
    expect(r.applied).toBe(0)
    expect(b.storage.getItem(ORG)).toBe('typed-meanwhile')
    await b.sync.syncNow() // the held-back item is seen again: both sides edited, so a conflict
    expect(b.storage.getItem(ORG)).toBe('typed-meanwhile')
    expect(b.sync.conflicts().map(c => c.id)).toEqual(['p.1.ado.org'])
    expect((await decryptAll(srv, ck))['p.1.ado.org'].value).toBe('v2')
  })

  it('skips a secret whose value changes while the pull is running', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, secrets: { 'google.auth': 't1' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b' })
    await b.sync.syncNow()
    await a.secure.set('google.auth', 't2')
    await a.sync.syncNow()
    const orig = b.secure.get.getMockImplementation()
    let reads = 0
    b.secure.get.mockImplementation(async (name) => {
      if (name === 'google.auth' && ++reads === 2) b.secure.vals.set(name, 'refreshed-meanwhile')
      return orig(name)
    })
    await b.sync.pull()
    b.secure.get.mockImplementation(orig)
    expect(await b.secure.get('google.auth')).toBe('refreshed-meanwhile')
  })

  it('stores keyed fingerprints for secrets, never a plain hash of the value', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, secrets: { 'google.auth': '1234' } })
    await a.sync.syncNow()
    const m = metaOf(a).entries['sec:nexusmd:google.auth']
    expect(m).toBeTruthy()
    expect(m.hash).not.toBe(contentHash('1234'))
    expect(m.hash).not.toBe(contentHash(1234))
    expect(m.hash.length).toBeGreaterThanOrEqual(40) // an HMAC-SHA256, not a 32-bit FNV
    expect(a.storage.getItem(META)).not.toContain('1234')
    expect((await a.sync.push()).pushed).toBe(0) // the fingerprint still detects "unchanged"
    await a.secure.set('google.auth', '1235')
    expect((await a.sync.push()).pushed).toBe(1)
  })

  // registry v2: the split tweaks are Android's
  it('never tombstones the tweaks halves when the tweaks key vanishes', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, ns: 'helm', init: { 'helm.tweaks': JSON.stringify({ theme: 'dark', widgets: ['x'] }) } })
    await a.sync.syncNow()
    const b = device({ srv, ck, ns: 'helm', deviceId: 'dev-b', init: { 'helm.tweaks': JSON.stringify({ widgets: ['b'] }) } })
    await b.sync.syncNow()
    a.storage.removeItem('helm.tweaks')
    const r = await a.sync.syncNow()
    expect(r.pushed).toBe(0)
    expect((await decryptAll(srv, ck))['tweaks.account'].deleted).toBeFalsy()
    const blob = await decryptJson(srv.prefs.get('dev-a').ciphertext, ck, 'nexusmd-device-prefs|dev-a')
    expect(blob.entries['tweaks.device'].value).toEqual({ widgets: ['x'] })
    await b.sync.syncNow()
    expect(JSON.parse(b.storage.getItem('helm.tweaks'))).toEqual({ theme: 'dark', widgets: ['b'] })
  })

  it('never tombstones the tweaks halves when the Android active profile has no tweaks key', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    let active = '1'
    const phone = device({
      srv, ck, ns: 'helm', deviceId: 'phone', getActiveProfileId: () => active,
      init: { 'helm.p.1.tweaks': JSON.stringify({ theme: 'dark', navOrder: ['a'] }), 'helm.p.1.android.org': 'o' },
    })
    await phone.sync.syncNow()
    const rev = srv.prefs.get('phone').revision
    active = '2'
    phone.storage.setItem('helm.p.1.android.org', 'o2') // something else still changes and syncs
    const r = await phone.sync.syncNow()
    expect(r.error).toBeUndefined()
    expect(r.pushed).toBe(1)
    const items = await decryptAll(srv, ck)
    expect(items['tweaks.account'].deleted).toBeFalsy()
    expect(items['tweaks.account'].value).toEqual({ theme: 'dark' })
    const blob = await decryptJson(srv.prefs.get('phone').ciphertext, ck, 'nexusmd-device-prefs|phone')
    expect(blob.entries['tweaks.device'].value).toEqual({ navOrder: ['a'] })
    expect(srv.prefs.get('phone').revision).toBe(rev)
  })

  it('a device without a devicePrefs adapter keeps the blob\'s shell prefs when it re-pushes', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const shell = { zoomFactor: 1.2 }
    const one = device({ srv, ck, deviceId: 'dev-a', devicePrefs: { collect: async () => shell, apply: async () => {} }, init: { 'nexusmd.p.1.sidebar.width': '300' } })
    await one.sync.syncNow()
    const two = device({ srv, ck, deviceId: 'dev-a', devicePrefs: null })
    await two.sync.syncNow()
    expect(two.storage.getItem('nexusmd.p.1.sidebar.width')).toBe('300')
    two.storage.setItem('nexusmd.p.1.sidebar.width', '250')
    const r = await two.sync.syncNow()
    expect(r.devicePrefs).toBe(true)
    const blob = await decryptJson(srv.prefs.get('dev-a').ciphertext, ck, 'nexusmd-device-prefs|dev-a')
    expect(blob.entries['nexusmd:p.1.sidebar.width'].value).toBe('250')
    expect(blob.prefs).toEqual(shell)
  })

  it('shell device prefs use the observed edit time too', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const clockRef = { t: 100 }
    const now = () => clockRef.t
    const prefsOf = (init) => {
      const state = { value: init }
      return { state, collect: async () => state.value, apply: vi.fn(async (v) => { state.value = v }) }
    }
    const p1 = prefsOf({ zoom: 1 })
    const p2 = prefsOf({ zoom: 1 })
    const one = device({ srv, ck, deviceId: 'dev-a', devicePrefs: p1, now })
    await one.sync.syncNow()
    const two = device({ srv, ck, deviceId: 'dev-a', devicePrefs: p2, now })
    await two.sync.syncNow()
    clockRef.t = 1000
    p1.state.value = { zoom: 1.5 }
    await one.sync.observe()
    clockRef.t = 2000
    p2.state.value = { zoom: 2 }
    await two.sync.syncNow()
    clockRef.t = 3000
    await one.sync.syncNow()
    expect(p1.state.value).toEqual({ zoom: 2 })
    const blob = await decryptJson(srv.prefs.get('dev-a').ciphertext, ck, 'nexusmd-device-prefs|dev-a')
    expect(blob.prefs).toEqual({ zoom: 2 })
  })

  it('a push interrupted after the first batch records meta only for acknowledged items', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const init = {}
    for (let i = 0; i < 120; i++) init[`nexusmd.p.1.k${i}`] = `v${i}`
    const a = device({ srv, ck, init })
    const orig = srv.client.putItems
    let batches = 0
    srv.client.putItems = async (list) => {
      batches++
      if (batches === 2) throw new AccountError('offline', 0)
      return orig(list)
    }
    const r = await a.sync.push()
    expect(r.error.code).toBe('offline')
    expect(batches).toBe(2)
    const tracked = Object.values(metaOf(a).entries).filter((e) => e.level === 'account' && e.revision > 0)
    expect(tracked).toHaveLength(50)
    expect(srv.items.size).toBe(50)
    const again = await a.sync.push()
    expect(again.pushed).toBe(70)
    expect(srv.items.size).toBe(120)
  })
})

describe('records and fields (registry v2)', () => {
  const L = 'nexusmd.p.A.lists'
  const lists = (d) => JSON.parse(d.storage.getItem(L)).lists

  it('syncs a collection record by record: several records of one key land in one pull, order kept', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { [L]: JSON.stringify({ lists: [{ id: 'l1', n: 1 }, { id: 'l2', n: 2 }] }) } })
    expect((await a.sync.push()).pushed).toBe(2)
    expect(Object.keys(await decryptAll(srv, ck)).sort()).toEqual(['nexusmd:p.A.lists#l1', 'nexusmd:p.A.lists#l2'])
    const b = device({ srv, ck, deviceId: 'dev-b', init: { [L]: JSON.stringify({ lists: [{ id: 'mine' }] }) } })
    const r = await b.sync.pull()
    expect(r.applied).toBe(2)
    expect(lists(b)).toEqual([{ id: 'mine' }, { id: 'l1', n: 1 }, { id: 'l2', n: 2 }])
    // one record edited on a: only that record is pushed, b takes it in place
    a.storage.setItem(L, JSON.stringify({ lists: [{ id: 'l1', n: 1 }, { id: 'l2', n: 22 }] }))
    expect((await a.sync.push()).pushed).toBe(1)
    await b.sync.pull()
    expect(lists(b)).toEqual([{ id: 'mine' }, { id: 'l1', n: 1 }, { id: 'l2', n: 22 }])
    // a record removed on a is removed on b, the others stay
    a.storage.setItem(L, JSON.stringify({ lists: [{ id: 'l2', n: 22 }] }))
    expect((await a.sync.push()).pushed).toBe(1)
    await b.sync.pull()
    expect(lists(b)).toEqual([{ id: 'mine' }, { id: 'l2', n: 22 }])
  })

  it('an unreadable collection on the receiver holds its remote records and pushes no tombstones', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { [L]: JSON.stringify({ lists: [{ id: 'l1' }] }) } })
    await a.sync.push()
    const b = device({ srv, ck, deviceId: 'dev-b', init: { [L]: '{hand edited' } })
    await b.sync.syncNow()
    expect(b.storage.getItem(L)).toBe('{hand edited') // never overwritten
    expect(metaOf(b).entries['nexusmd:p.A.lists#l1']).toBeUndefined() // held: seen again next pull
    expect((await decryptAll(srv, ck))['nexusmd:p.A.lists#l1'].deleted).toBeUndefined()
    // once repaired, the record arrives
    b.storage.setItem(L, JSON.stringify({ lists: [] }))
    await b.sync.syncNow()
    expect(lists(b)).toEqual([{ id: 'l1' }])
    // a synced device whose key turns unreadable does not tombstone its records
    a.storage.setItem(L, 'not json')
    const pushed = await a.sync.push()
    expect(pushed.pushed).toBe(0)
    expect((await decryptAll(srv, ck))['nexusmd:p.A.lists#l1'].deleted).toBeUndefined()
  })

  it('tweaks sync field by field; a field the remote never touches is kept', async () => {
    const T = 'nexusmd.p.A.tweaks'
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { [T]: JSON.stringify({ theme: 'dark', layout: { b: 1, a: 2 } }) } })
    expect((await a.sync.push()).pushed).toBe(2)
    const b = device({ srv, ck, deviceId: 'dev-b', init: { [T]: JSON.stringify({ localOnly: 1 }) } })
    await b.sync.pull()
    expect(JSON.parse(b.storage.getItem(T))).toEqual({ localOnly: 1, theme: 'dark', layout: { a: 2, b: 1 } })
  })
})

describe('per-profile sync status', () => {
  const PROFILES = JSON.stringify([
    { id: 'W', name: 'Work', updatedAt: 1 }, { id: 'H', name: 'Home', updatedAt: 1 },
    { id: 'X', name: 'Gone', updatedAt: 1, purgedAt: 1 },
  ])

  it('status lists every profile with its last sync time after syncNow', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    let t = 5000
    const a = device({ srv, ck, now: () => t, init: { 'nexusmd.profiles': PROFILES, 'nexusmd.p.W.ado.org': 'acme' } })
    expect(a.sync.status()).toEqual({ lastSyncAt: null, profiles: {
      W: { lastSyncAt: null, conflicts: 0, tooLarge: [], quota: [], error: null },
      H: { lastSyncAt: null, conflicts: 0, tooLarge: [], quota: [], error: null },
    } })
    await a.sync.syncNow()
    const s = a.sync.status()
    expect(s.lastSyncAt).toBe(5000)
    expect(Object.keys(s.profiles).sort()).toEqual(['H', 'W']) // a purged profile is not listed
    expect(s.profiles.W).toEqual({ lastSyncAt: 5000, conflicts: 0, tooLarge: [], quota: [], error: null })
    expect(s.profiles.H.lastSyncAt).toBe(5000)
  })

  it('a too-large planner version shows under its profile only', async () => {
    const srv = fakeServer({ maxBytes: 4000 })
    const ck = await generateContainerKey()
    const a = device({
      srv, ck,
      init: { 'nexusmd.profiles': PROFILES, 'nexusmd.p.W.planner.versions': JSON.stringify([{ id: 'v1', body: 'x'.repeat(8000) }]) },
    })
    await a.sync.syncNow()
    const s = a.sync.status()
    expect(s.profiles.W.tooLarge).toEqual(['nexusmd:p.W.planner.versions#v1'])
    expect(s.profiles.H.tooLarge).toEqual([])
    expect(s.profiles.W.lastSyncAt).toEqual(expect.any(Number))
  })

  it('counts each profile\'s open conflicts', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.profiles': PROFILES, 'nexusmd.p.W.ado.org': 'from-a' } })
    await a.sync.syncNow()
    const b = device({ srv, ck, deviceId: 'dev-b', init: { 'nexusmd.profiles': PROFILES, 'nexusmd.p.W.ado.org': 'from-b' } })
    await b.sync.syncNow()
    expect(b.sync.status().profiles.W.conflicts).toBe(1)
    expect(b.sync.status().profiles.H.conflicts).toBe(0)
  })

  it('a failed sync sets error and keeps the previous lastSyncAt', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    let t = 5000
    const a = device({ srv, ck, now: () => t, init: { 'nexusmd.profiles': PROFILES } })
    await a.sync.syncNow()
    t = 9000
    srv.fail = 'offline'
    expect((await a.sync.syncNow()).error.code).toBe('offline')
    const s = a.sync.status()
    expect(s.lastSyncAt).toBe(5000)
    expect(s.profiles.W).toMatchObject({ lastSyncAt: 5000, error: expect.any(String) })
    expect(s.profiles.H.error).toBe(s.profiles.W.error)
    srv.fail = null
    await a.sync.syncNow()
    expect(a.sync.status().profiles.W).toMatchObject({ lastSyncAt: 9000, error: null })
  })
})

// The account sync already leaves a value it cannot read alone (never pushed, never tombstoned; see 'an
// unreadable collection on the receiver' above). It must not do so silently: the status says which profile
// has one, and the log says so once.
describe('unreadable items are reported', () => {
  const PROFILES = JSON.stringify([{ id: 'W', name: 'Work', updatedAt: 1 }, { id: 'H', name: 'Home', updatedAt: 1 }])
  const LISTS_W = 'nexusmd.p.W.lists'
  afterEach(() => vi.restoreAllMocks())

  async function deviceWith(init) {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    return device({ srv, ck, init: { 'nexusmd.profiles': PROFILES, ...init } })
  }

  it('lists the item under its own profile only, and only when there is one', async () => {
    const a = await deviceWith({ [LISTS_W]: '{ torn' })
    await a.sync.syncNow()
    const s = a.sync.status()
    expect(s.profiles.W.unreadable).toEqual(['nexusmd:p.W.lists'])
    expect(s.profiles.H).not.toHaveProperty('unreadable')
    expect(s).not.toHaveProperty('unreadable')
    expect(a.storage.getItem(LISTS_W)).toBe('{ torn') // and the value itself is untouched
  })

  it('clears once the value is readable again', async () => {
    const a = await deviceWith({ [LISTS_W]: '{ torn' })
    await a.sync.syncNow()
    a.storage.setItem(LISTS_W, JSON.stringify({ lists: [] }))
    await a.sync.syncNow()
    expect(a.sync.status().profiles.W).not.toHaveProperty('unreadable')
  })

  it('logs it once per item, not every round, and again if it breaks again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = await deviceWith({ [LISTS_W]: '{ torn' })
    await a.sync.syncNow()
    await a.sync.syncNow()
    const mine = () => warn.mock.calls.filter((c) => String(c[0]).includes('could not be read on this device'))
    expect(mine()).toHaveLength(1)
    expect(mine()[0][0]).toBe('[sync:account] an item could not be read on this device and was left alone')
    expect(mine()[0][1]).toEqual({ id: 'nexusmd:p.W.lists' })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('torn') // never the stored text

    a.storage.setItem(LISTS_W, JSON.stringify({ lists: [] }))
    await a.sync.syncNow()
    a.storage.setItem(LISTS_W, 'broken again')
    await a.sync.syncNow()
    expect(mine()).toHaveLength(2)
  })

  it('an item that belongs to no profile is listed at the top of the status', async () => {
    const a = await deviceWith({ 'nexusmd.p.W.lists': JSON.stringify({ lists: [] }) })
    await a.sync.syncNow()
    a.storage.setItem('nexusmd.profiles', 'not json')
    await a.sync.syncNow()
    expect(a.sync.status().unreadable).toEqual(['profiles'])
  })
})

// The profile list is synced as one plain value, so a corrupt one used to be pushed as the text itself,
// replacing the account's real list, and every other device accepted it (any string fits a plain value).
describe('a corrupt profile list', () => {
  const GOOD = JSON.stringify([{ id: 'W', name: 'Work', updatedAt: 1 }])

  it('is never pushed over the account\'s real list, and is repaired by the next sync once readable', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { 'nexusmd.profiles': GOOD } })
    await a.sync.syncNow()
    expect((await decryptAll(srv, ck)).profiles.value).toBe(GOOD)

    a.storage.setItem('nexusmd.profiles', '{ torn')
    const r = await a.sync.syncNow()
    expect(r.pushed).toBe(0)
    expect((await decryptAll(srv, ck)).profiles.value).toBe(GOOD)        // the server still has the real list
    expect((await decryptAll(srv, ck)).profiles.deleted).toBeUndefined()  // and no deletion
    expect(a.storage.getItem('nexusmd.profiles')).toBe('{ torn')          // the damaged bytes are left alone

    const edited = JSON.stringify([{ id: 'W', name: 'Work', updatedAt: 1 }, { id: 'H', name: 'Home', updatedAt: 2 }])
    a.storage.setItem('nexusmd.profiles', edited)
    await a.sync.syncNow()
    expect((await decryptAll(srv, ck)).profiles.value).toBe(edited)       // an ordinary edit goes up again
  })

  it('is not taken from another device either: a value that is not a profile list does not fit', () => {
    const registry = createKeyRegistry({ namespace: 'nexusmd' })
    const target = resolveTarget(registry, 'profiles')
    expect(target.json).toBe('array')
    expect(validValue(target, GOOD)).toBe(true)
    expect(validValue(target, '[]')).toBe(true)
    expect(validValue(target, 'not json')).toBe(false)
    expect(validValue(target, '{"id":"W"}')).toBe(false)   // JSON, but not a list
    expect(validValue(target, null)).toBe(false)
  })
})

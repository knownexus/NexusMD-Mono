// Save to server / Load from server for one profile: pull({ profileId }) and push({ profileId }) touch only that
// profile (and the profiles list), keep their own times, and leave everything else for the next full sync.
import { describe, it, expect } from 'vitest'
import { generateContainerKey } from '../src/modules/account/crypto.js'
import { fakeServer, decryptAll, device } from './helpers/account-fakes.js'

const PROFILES = 'nexusmd.profiles'
const P = (id, name) => ({ id, name, updatedAt: 100, deletedAt: null, purgedAt: null })
const ORG = (pid) => `nexusmd.p.${pid}.ado.org`

/** a holds profiles W and H, each with an organisation setting; b is a second device on the same account, empty. */
async function setup() {
  const srv = fakeServer()
  const ck = await generateContainerKey()
  const a = device({
    srv, ck,
    init: { [PROFILES]: JSON.stringify([P('W', 'Work'), P('H', 'Home')]), [ORG('W')]: 'work-org', [ORG('H')]: 'home-org' },
  })
  const b = device({ srv, ck, deviceId: 'dev-b' })
  return { srv, ck, a, b }
}
const onServer = async (srv, ck) => Object.keys(await decryptAll(srv, ck))

describe('push({ profileId }): Save to server', () => {
  it('sends only that profile’s items and the profiles list, not another profile’s', async () => {
    const { srv, ck, a } = await setup()
    const r = await a.sync.push({ profileId: 'W' })
    expect(r.error).toBeUndefined()
    const ids = await onServer(srv, ck)
    expect(ids).toContain('profiles')
    expect(ids).toContain('p.W.ado.org')
    expect(ids.some(id => id.includes('p.H.') || id.includes('.H.'))).toBe(false)
  })

  it('a second device that loads everything then has that profile, and not the other one yet', async () => {
    const { a, b } = await setup()
    await a.sync.push({ profileId: 'W' })
    await b.sync.pull()
    expect(b.storage.getItem(ORG('W'))).toBe('work-org')
    expect(b.storage.getItem(ORG('H'))).toBeNull()
  })

  it('saving the other profile afterwards sends it too, and sends nothing for one that is already saved', async () => {
    const { a, b } = await setup()
    await a.sync.push({ profileId: 'W' })
    await a.sync.push({ profileId: 'H' })
    const again = await a.sync.push({ profileId: 'H' })
    expect(again.pushed).toBe(0)
    await b.sync.pull()
    expect(b.storage.getItem(ORG('H'))).toBe('home-org')
  })

  it('keeps when that profile was saved, for that profile only, and not the time of a full sync', async () => {
    const { a } = await setup()
    await a.sync.push({ profileId: 'W' })
    const s = a.sync.status()
    expect(s.profiles.W.lastSavedAt).toBeGreaterThan(0)
    expect(s.profiles.H.lastSavedAt).toBeNull()
    expect(s.profiles.W.lastLoadedAt).toBeNull()
    expect(s.profiles.W.lastSyncAt).toBeNull()
    expect(s.lastSyncAt).toBeNull()
  })

  it('does not say it was saved when the upload failed', async () => {
    const { srv, a } = await setup()
    srv.fail = 'network'
    const r = await a.sync.push({ profileId: 'W' })
    expect(r.error).toBeTruthy()
    expect(a.sync.status().profiles.W.lastSavedAt).toBeNull()
  })

  it('without a profile it still sends everything and leaves the per-profile times alone', async () => {
    const { srv, ck, a } = await setup()
    await a.sync.push()
    const ids = await onServer(srv, ck)
    expect(ids.some(id => id.includes('p.W.'))).toBe(true)
    expect(ids.some(id => id.includes('p.H.'))).toBe(true)
    expect(a.sync.status().profiles.W.lastSavedAt).toBeNull()
  })
})

describe('pull({ profileId }): Load from server', () => {
  /** a and b in sync, then a changes both profiles and syncs. */
  async function changed() {
    const s = await setup()
    await s.a.sync.syncNow()
    await s.b.sync.syncNow()
    s.a.storage.setItem(ORG('W'), 'work-org-2')
    s.a.storage.setItem(ORG('H'), 'home-org-2')
    await s.a.sync.syncNow()
    return s
  }

  it('brings down only that profile’s changes', async () => {
    const { b } = await changed()
    const r = await b.sync.pull({ profileId: 'W' })
    expect(r.error).toBeUndefined()
    expect(b.storage.getItem(ORG('W'))).toBe('work-org-2')
    expect(b.storage.getItem(ORG('H'))).toBe('home-org')
  })

  it('leaves the other profile’s change to arrive in the next full sync, rather than losing it', async () => {
    const { b } = await changed()
    await b.sync.pull({ profileId: 'W' })
    await b.sync.syncNow()
    expect(b.storage.getItem(ORG('H'))).toBe('home-org-2')
    expect(b.storage.getItem(ORG('W'))).toBe('work-org-2')
  })

  it('keeps that local edit, as any pull does, when this device changed the same setting since', async () => {
    const { b } = await changed()
    b.storage.setItem(ORG('W'), 'work-org-local')
    await b.sync.observe()
    await b.sync.pull({ profileId: 'W' })
    // the engine decides by time, as in a sync: whichever side it keeps, the other profile is untouched
    expect(b.storage.getItem(ORG('H'))).toBe('home-org')
  })

  it('keeps when that profile was loaded, for that profile only', async () => {
    const { b } = await changed()
    await b.sync.pull({ profileId: 'W' })
    const s = b.sync.status()
    expect(s.profiles.W.lastLoadedAt).toBeGreaterThan(0)
    expect(s.profiles.H.lastLoadedAt).toBeNull()
    expect(s.profiles.W.lastSavedAt).toBeNull()
  })

  it('does not say it was loaded when the download failed', async () => {
    const { srv, b } = await changed()
    srv.fail = 'network'
    const r = await b.sync.pull({ profileId: 'W' })
    expect(r.error).toBeTruthy()
    expect(b.sync.status().profiles.W.lastLoadedAt).toBeNull()
  })

  it('on a device that has never synced, takes in the profiles list so the profile is there to load', async () => {
    const { a, b } = await setup()
    await a.sync.syncNow()
    await b.sync.pull({ profileId: 'W' })
    expect(JSON.parse(b.storage.getItem(PROFILES)).map(p => p.id).sort()).toEqual(['H', 'W'])
    expect(b.storage.getItem(ORG('W'))).toBe('work-org')
    expect(b.storage.getItem(ORG('H'))).toBeNull()
  })

  it('without a profile it still loads everything', async () => {
    const { b } = await changed()
    await b.sync.pull()
    expect(b.storage.getItem(ORG('W'))).toBe('work-org-2')
    expect(b.storage.getItem(ORG('H'))).toBe('home-org-2')
    expect(b.sync.status().profiles.W.lastLoadedAt).toBeNull()
  })
})

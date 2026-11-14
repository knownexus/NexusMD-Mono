// onApplied says what a pull wrote: which items, which profile each belongs to, and whether any belongs to none (so the
// app can reload only when it has to). See AccountGate for what is done with it.
import { describe, it, expect, vi } from 'vitest'
import { generateContainerKey } from '../src/modules/account/crypto.js'
import { fakeServer, device } from './helpers/account-fakes.js'

const PROFILES = 'nexusmd.profiles'
const P = (id, name, extra = {}) => ({ id, name, updatedAt: 100, deletedAt: null, purgedAt: null, ...extra })
const ORG = (pid) => `nexusmd.p.${pid}.ado.org`

/** a and b in sync on profiles W and H; b listens. */
async function pair() {
  const srv = fakeServer()
  const ck = await generateContainerKey()
  const a = device({ srv, ck, init: { [PROFILES]: JSON.stringify([P('W', 'Work'), P('H', 'Home')]), [ORG('W')]: 'w1', [ORG('H')]: 'h1' } })
  await a.sync.syncNow()
  const b = device({ srv, ck, deviceId: 'dev-b' })
  await b.sync.syncNow()
  const heard = vi.fn()
  b.sync.onApplied(heard)
  return { a, b, heard }
}

describe('onApplied payload', () => {
  it('names the items a pull wrote, each with its profile, and is not global for profile data alone', async () => {
    const { a, b, heard } = await pair()
    a.storage.setItem(ORG('W'), 'w2')
    await a.sync.syncNow()
    await b.sync.pull()
    expect(heard).toHaveBeenCalledTimes(1)
    expect(heard).toHaveBeenCalledWith({ applied: 1, items: [{ id: 'p.W.ado.org', profileId: 'W' }], global: false })
  })

  it('lists every item of a pull, from more than one profile', async () => {
    const { a, b, heard } = await pair()
    a.storage.setItem(ORG('W'), 'w2')
    a.storage.setItem(ORG('H'), 'h2')
    await a.sync.syncNow()
    await b.sync.pull()
    const [info] = heard.mock.calls[0]
    expect(info.applied).toBe(2)
    expect(info.items.map(i => i.profileId).sort()).toEqual(['H', 'W'])
    expect(info.global).toBe(false)
  })

  it('is global when the profiles list changed, which belongs to no profile', async () => {
    const { a, b, heard } = await pair()
    a.storage.setItem(PROFILES, JSON.stringify([P('W', 'Work renamed', { updatedAt: 500 }), P('H', 'Home')]))
    await a.sync.syncNow()
    await b.sync.pull()
    const [info] = heard.mock.calls[0]
    expect(info.global).toBe(true)
    expect(info.items).toContainEqual({ id: 'profiles', profileId: null })
  })

  it('a load of one profile only reports that profile', async () => {
    const { a, b, heard } = await pair()
    a.storage.setItem(ORG('W'), 'w2')
    a.storage.setItem(ORG('H'), 'h2')
    await a.sync.syncNow()
    await b.sync.pull({ profileId: 'W' })
    expect(heard).toHaveBeenCalledWith({ applied: 1, items: [{ id: 'p.W.ado.org', profileId: 'W' }], global: false })
  })

  it('says nothing when nothing was written', async () => {
    const { b, heard } = await pair()
    await b.sync.pull()
    expect(heard).not.toHaveBeenCalled()
  })
})

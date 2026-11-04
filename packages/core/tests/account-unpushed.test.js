// What an account switch would lose: local values that differ from the last synced ones.
import { describe, it, expect } from 'vitest'
import { generateContainerKey } from '../src/modules/account/crypto.js'
import { createKeyRegistry } from '../src/modules/account/key-registry.js'
import { listUnpushed } from '../src/modules/account/account-sync-state.js'
import * as core from '../src/index.js'
import { fakeServer, device, META } from './helpers/account-fakes.js'

const D = 'nexusmd.p.W.md_documents'
const ORG = 'nexusmd.p.W.ado.org'
const docs = (...ids) => JSON.stringify({ docs: ids.map(id => ({ id })) })

describe('listUnpushed', () => {
  it('is exported from core', () => expect(core.listUnpushed).toBe(listUnpushed))

  it('never synced (no meta): every account item is unpushed, by profile; secrets are not judged', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { [D]: docs('d1'), [ORG]: 'acme', 'nexusmd.sidebar.width': '240' }, secrets: { 'nexusmd.p.W.ado.pat': 't' } })
    const list = await listUnpushed({ registry: createKeyRegistry({ namespace: 'nexusmd' }), storage: a.storage, metaKey: META })
    expect(list).toEqual([
      { id: 'nexusmd:p.W.md_documents#d1', profileId: 'W' },
      { id: 'p.W.ado.org', profileId: 'W' },
    ])
  })

  it('after a sync nothing is unpushed; a local edit and an open conflict are', async () => {
    const srv = fakeServer()
    const ck = await generateContainerKey()
    const a = device({ srv, ck, init: { [D]: docs('d1', 'd2'), [ORG]: 'acme' } })
    await a.sync.syncNow()
    const registry = createKeyRegistry({ namespace: 'nexusmd' })
    expect(await listUnpushed({ registry, storage: a.storage, metaKey: META })).toEqual([])
    expect(await a.sync.unpushed()).toEqual([])
    a.storage.setItem(D, JSON.stringify({ docs: [{ id: 'd1', edited: true }, { id: 'd2' }] }))
    expect(await listUnpushed({ registry, storage: a.storage, metaKey: META })).toEqual([{ id: 'nexusmd:p.W.md_documents#d1', profileId: 'W' }])
    // an open conflict counts too
    const b = device({ srv, ck, deviceId: 'dev-b', init: { [ORG]: 'other' } })
    await b.sync.syncNow()
    expect(await b.sync.unpushed()).toEqual([{ id: 'p.W.ado.org', profileId: 'W' }])
  })
})

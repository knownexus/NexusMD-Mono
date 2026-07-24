import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  listSavedConnections, saveConnection, getConnectionSecret, deleteConnection,
} from './db-manager-config.js'

function fakeSecureStorage() {
  const store = new Map()
  return {
    get:    vi.fn(async (k) => store.has(k) ? store.get(k) : null),
    set:    vi.fn(async (k, v) => { store.set(k, v) }),
    remove: vi.fn(async (k) => { store.delete(k) }),
  }
}

describe('db-manager-config', () => {
  beforeEach(() => { localStorage.clear() })

  it('returns an empty list when nothing has been saved', () => {
    expect(listSavedConnections()).toEqual([])
  })

  it('saves a new connection and assigns it an id', async () => {
    const secureStorage = fakeSecureStorage()
    const id = await saveConnection(secureStorage, { name: 'UAT', type: 'sqlite', inputMode: 'fields', filePath: '/data/uat.db' }, '')
    expect(typeof id).toBe('string')
    expect(listSavedConnections()).toEqual([
      { id, name: 'UAT', type: 'sqlite', inputMode: 'fields', filePath: '/data/uat.db' },
    ])
  })

  it('saves multiple connections independently', async () => {
    const secureStorage = fakeSecureStorage()
    const id1 = await saveConnection(secureStorage, { name: 'UAT', type: 'sqlite', filePath: '/a.db' }, '')
    const id2 = await saveConnection(secureStorage, { name: 'Prod', type: 'sqlserver', host: 'h' }, 'pw')
    const list = listSavedConnections()
    expect(list.map(c => c.id)).toEqual([id1, id2])
    expect(list.map(c => c.name)).toEqual(['UAT', 'Prod'])
  })

  it('updates an existing connection when its id is passed back in', async () => {
    const secureStorage = fakeSecureStorage()
    const id = await saveConnection(secureStorage, { name: 'UAT', type: 'sqlite', filePath: '/a.db' }, '')
    await saveConnection(secureStorage, { id, name: 'UAT (renamed)', type: 'sqlite', filePath: '/b.db' }, '')
    const list = listSavedConnections()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id, name: 'UAT (renamed)', filePath: '/b.db' })
  })

  it('round-trips a connection secret through secureStorage, keyed by id', async () => {
    const secureStorage = fakeSecureStorage()
    const id1 = await saveConnection(secureStorage, { name: 'A', type: 'sqlserver' }, 'secret-a')
    const id2 = await saveConnection(secureStorage, { name: 'B', type: 'sqlserver' }, 'secret-b')
    expect(await getConnectionSecret(secureStorage, id1)).toBe('secret-a')
    expect(await getConnectionSecret(secureStorage, id2)).toBe('secret-b')
  })

  it('does not write a secret when none is given', async () => {
    const secureStorage = fakeSecureStorage()
    await saveConnection(secureStorage, { name: 'A', type: 'sqlserver' }, '')
    expect(secureStorage.set).not.toHaveBeenCalled()
  })

  it('leaves an existing secret untouched when updating metadata with an empty secret', async () => {
    const secureStorage = fakeSecureStorage()
    const id = await saveConnection(secureStorage, { name: 'A', type: 'sqlserver' }, 'secret-a')
    await saveConnection(secureStorage, { id, name: 'A renamed', type: 'sqlserver' }, '')
    expect(await getConnectionSecret(secureStorage, id)).toBe('secret-a')
  })

  it('deleteConnection removes the metadata entry and its secret', async () => {
    const secureStorage = fakeSecureStorage()
    const id1 = await saveConnection(secureStorage, { name: 'A', type: 'sqlserver' }, 'secret-a')
    const id2 = await saveConnection(secureStorage, { name: 'B', type: 'sqlserver' }, 'secret-b')

    await deleteConnection(secureStorage, id1)

    expect(listSavedConnections().map(c => c.id)).toEqual([id2])
    expect(await getConnectionSecret(secureStorage, id1)).toBe('')
    expect(await getConnectionSecret(secureStorage, id2)).toBe('secret-b')
  })
})

import { describe, it, expect } from 'vitest'
import {
  createCollection, readCollectionMeta, writeCollectionMeta,
  writeRequest, readRequest, listRequestIds, deleteRequest,
  writeEnvironment, readEnvironment, listEnvironmentNames, deleteEnvironment,
  loadCollection, addTreeNode, removeTreeNode, findTreeNode, flattenRequestRefs,
} from '../../src/modules/api-client/collection-store.js'

// In-memory IFileAdapter.
function memFile(initial = {}) {
  const files = new Map(Object.entries(initial))
  return {
    async read(path) { if (!files.has(path)) throw new Error('ENOENT'); return files.get(path) },
    async write(path, text) { files.set(path, text) },
    async exists(path) { return files.has(path) },
    async list(dirPath) {
      const prefix = dirPath + '/'
      return [...files.keys()].filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length))
    },
    async delete(path) { files.delete(path) },
    async mkdir() {},
  }
}

describe('collection-store', () => {
  it('createCollection writes an empty-tree collection.json', async () => {
    const file = memFile()
    const meta = await createCollection(file, '/col', { name: 'My API', description: 'desc' })
    expect(meta).toEqual({ name: 'My API', description: 'desc', tree: [] })
    expect(await readCollectionMeta(file, '/col')).toEqual(meta)
  })

  it('writeCollectionMeta overwrites the meta file', async () => {
    const file = memFile()
    await createCollection(file, '/col', { name: 'My API' })
    await writeCollectionMeta(file, '/col', { name: 'Renamed', description: '', tree: [] })
    expect((await readCollectionMeta(file, '/col')).name).toBe('Renamed')
  })

  it('round-trips a request file and lists it by refId', async () => {
    const file = memFile()
    await createCollection(file, '/col')
    await writeRequest(file, '/col', 'req1', { method: 'GET', url: '{{baseUrl}}/users' })

    expect(await listRequestIds(file, '/col')).toEqual(['req1'])
    expect(await readRequest(file, '/col', 'req1')).toEqual({ method: 'GET', url: '{{baseUrl}}/users' })

    await deleteRequest(file, '/col', 'req1')
    expect(await listRequestIds(file, '/col')).toEqual([])
  })

  it('round-trips an environment file and lists it by name', async () => {
    const file = memFile()
    await createCollection(file, '/col')
    await writeEnvironment(file, '/col', 'dev', { variables: { baseUrl: { value: 'https://dev.example.com' } } })

    expect(await listEnvironmentNames(file, '/col')).toEqual(['dev'])
    expect(await readEnvironment(file, '/col', 'dev')).toEqual({
      variables: { baseUrl: { value: 'https://dev.example.com' } },
    })

    await deleteEnvironment(file, '/col', 'dev')
    expect(await listEnvironmentNames(file, '/col')).toEqual([])
  })

  it('loadCollection assembles meta + all requests + all environments', async () => {
    const file = memFile()
    await createCollection(file, '/col', { name: 'My API' })
    await writeRequest(file, '/col', 'req1', { method: 'GET', url: '/a' })
    await writeRequest(file, '/col', 'req2', { method: 'POST', url: '/b' })
    await writeEnvironment(file, '/col', 'dev', { variables: {} })

    const loaded = await loadCollection(file, '/col')
    expect(loaded.meta.name).toBe('My API')
    expect(Object.keys(loaded.requests).sort()).toEqual(['req1', 'req2'])
    expect(Object.keys(loaded.environments)).toEqual(['dev'])
  })

  it('loadCollection skips a request file that fails to parse rather than throwing', async () => {
    const file = memFile({ '/col/collection.json': JSON.stringify({ name: 'X', description: '', tree: [] }) })
    await file.write('/col/requests/bad.json', 'not json')
    await file.write('/col/requests/good.json', JSON.stringify({ method: 'GET', url: '/ok' }))

    const loaded = await loadCollection(file, '/col')
    expect(Object.keys(loaded.requests)).toEqual(['good'])
  })
})

describe('collection tree helpers', () => {
  it('addTreeNode inserts at root when path is empty', () => {
    const tree = addTreeNode([], [], { type: 'request', name: 'Get user', refId: 'req1' })
    expect(tree).toEqual([{ type: 'request', name: 'Get user', refId: 'req1' }])
  })

  it('addTreeNode inserts into a nested folder by path', () => {
    const tree = [{ type: 'folder', name: 'Users', children: [] }]
    const updated = addTreeNode(tree, ['Users'], { type: 'request', name: 'Get user', refId: 'req1' })
    expect(updated).toEqual([
      { type: 'folder', name: 'Users', children: [{ type: 'request', name: 'Get user', refId: 'req1' }] },
    ])
  })

  it('findTreeNode locates a request node nested in folders', () => {
    const tree = [{ type: 'folder', name: 'Users', children: [{ type: 'request', name: 'Get user', refId: 'req1' }] }]
    expect(findTreeNode(tree, 'req1')).toEqual({ type: 'request', name: 'Get user', refId: 'req1' })
    expect(findTreeNode(tree, 'missing')).toBeNull()
  })

  it('removeTreeNode removes a request node from anywhere in the tree', () => {
    const tree = [{ type: 'folder', name: 'Users', children: [{ type: 'request', name: 'Get user', refId: 'req1' }] }]
    expect(removeTreeNode(tree, 'req1')).toEqual([{ type: 'folder', name: 'Users', children: [] }])
  })

  it('flattenRequestRefs walks folders depth-first, in tree order', () => {
    const tree = [
      { type: 'request', name: 'A', refId: 'req1' },
      { type: 'folder', name: 'Sub', children: [
        { type: 'request', name: 'B', refId: 'req2' },
        { type: 'folder', name: 'Nested', children: [{ type: 'request', name: 'C', refId: 'req3' }] },
      ] },
    ]
    expect(flattenRequestRefs(tree)).toEqual([
      { refId: 'req1', name: 'A' },
      { refId: 'req2', name: 'B' },
      { refId: 'req3', name: 'C' },
    ])
  })
})

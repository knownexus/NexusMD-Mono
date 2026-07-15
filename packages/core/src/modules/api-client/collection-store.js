// File-backed CRUD for an api-client collection, via the injected IFileAdapter.
// Layout on disk:
//   <dir>/collection.json          { name, description, tree }
//   <dir>/requests/<refId>.json    one file per request (git-diff-friendly)
//   <dir>/environments/<name>.json one file per environment
//
// `tree` is a nested array of { type: 'folder', name, children } and
// { type: 'request', name, refId } nodes describing display order/grouping;
// the request files themselves are the source of truth for request content.

const COLLECTION_META_FILE = 'collection.json'
const REQUESTS_DIR = 'requests'
const ENVIRONMENTS_DIR = 'environments'

const join = (...parts) => parts.join('/')
const stripJsonExt = (names) => names.filter(n => n.endsWith('.json')).map(n => n.slice(0, -5))

export async function createCollection(file, dir, { name, description = '' } = {}) {
  const meta = { name, description, tree: [] }
  await file.mkdir(dir)
  await file.mkdir(join(dir, REQUESTS_DIR))
  await file.mkdir(join(dir, ENVIRONMENTS_DIR))
  await file.write(join(dir, COLLECTION_META_FILE), JSON.stringify(meta, null, 2))
  return meta
}

export async function readCollectionMeta(file, dir) {
  return JSON.parse(await file.read(join(dir, COLLECTION_META_FILE)))
}

export async function writeCollectionMeta(file, dir, meta) {
  await file.write(join(dir, COLLECTION_META_FILE), JSON.stringify(meta, null, 2))
}

export async function listRequestIds(file, dir) {
  return stripJsonExt(await file.list(join(dir, REQUESTS_DIR)))
}

export async function readRequest(file, dir, refId) {
  return JSON.parse(await file.read(join(dir, REQUESTS_DIR, `${refId}.json`)))
}

export async function writeRequest(file, dir, refId, request) {
  await file.write(join(dir, REQUESTS_DIR, `${refId}.json`), JSON.stringify(request, null, 2))
}

export async function deleteRequest(file, dir, refId) {
  await file.delete(join(dir, REQUESTS_DIR, `${refId}.json`))
}

export async function listEnvironmentNames(file, dir) {
  return stripJsonExt(await file.list(join(dir, ENVIRONMENTS_DIR)))
}

export async function readEnvironment(file, dir, name) {
  return JSON.parse(await file.read(join(dir, ENVIRONMENTS_DIR, `${name}.json`)))
}

export async function writeEnvironment(file, dir, name, envDef) {
  await file.write(join(dir, ENVIRONMENTS_DIR, `${name}.json`), JSON.stringify(envDef, null, 2))
}

export async function deleteEnvironment(file, dir, name) {
  await file.delete(join(dir, ENVIRONMENTS_DIR, `${name}.json`))
}

/** Loads the full collection (meta + every request + every environment) into memory. */
export async function loadCollection(file, dir) {
  const meta = await readCollectionMeta(file, dir)

  const requests = {}
  for (const refId of await listRequestIds(file, dir)) {
    try { requests[refId] = await readRequest(file, dir, refId) } catch { /* skip unreadable request */ }
  }

  const environments = {}
  for (const name of await listEnvironmentNames(file, dir)) {
    try { environments[name] = await readEnvironment(file, dir, name) } catch { /* skip unreadable environment */ }
  }

  return { dir, meta, requests, environments }
}

// ── Tree helpers (pure — operate on the `tree` array from collection meta) ──

/** Inserts `node` under the folder path (array of folder names); [] = root. */
export function addTreeNode(tree, path, node) {
  if (!path.length) return [...tree, node]
  const [head, ...rest] = path
  return tree.map(n => (
    n.type === 'folder' && n.name === head
      ? { ...n, children: addTreeNode(n.children || [], rest, node) }
      : n
  ))
}

export function removeTreeNode(tree, refId) {
  return tree
    .filter(n => !(n.type === 'request' && n.refId === refId))
    .map(n => (n.type === 'folder' ? { ...n, children: removeTreeNode(n.children || [], refId) } : n))
}

export function findTreeNode(tree, refId) {
  for (const n of tree) {
    if (n.type === 'request' && n.refId === refId) return n
    if (n.type === 'folder') {
      const found = findTreeNode(n.children || [], refId)
      if (found) return found
    }
  }
  return null
}

/** Depth-first, in-order list of every request node under `nodes` (recursing into folders). */
export function flattenRequestRefs(nodes) {
  const out = []
  for (const n of nodes) {
    if (n.type === 'request') out.push({ refId: n.refId, name: n.name })
    else if (n.type === 'folder') out.push(...flattenRequestRefs(n.children || []))
  }
  return out
}

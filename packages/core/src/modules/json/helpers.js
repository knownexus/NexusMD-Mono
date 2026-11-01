// json-editor-helpers.js — pure, DOM-free JSON tree helpers for JsonEditorView.
// Every path-mutation helper returns a NEW tree (never mutates its input), so
// React state updates via setData(next) trigger re-renders correctly.

export function typeOf(val) {
  if (Array.isArray(val)) return 'array'
  if (val === null) return 'null'
  return typeof val
}

export function getAtPath(data, path) {
  let cur = data
  for (const k of path) cur = cur[k]
  return cur
}

function cloneShallow(val) {
  return Array.isArray(val) ? [...val] : { ...val }
}

// Returns a new tree with `updater(node)` applied to the node at parentPath,
// cloning every container from the root down to parentPath (structural
// sharing everywhere else).
function updateAtPath(data, parentPath, updater) {
  if (parentPath.length === 0) return updater(data)
  const [head, ...rest] = parentPath
  const clone = cloneShallow(data)
  clone[head] = updateAtPath(data[head], rest, updater)
  return clone
}

export function setValueAtPath(data, path, newVal) {
  if (path.length === 0) return newVal
  const parentPath = path.slice(0, -1)
  const key = path[path.length - 1]
  return updateAtPath(data, parentPath, node => {
    const clone = cloneShallow(node)
    clone[key] = newVal
    return clone
  })
}

export function deleteAtPath(data, path) {
  if (path.length === 0) return data
  const parentPath = path.slice(0, -1)
  const key = path[path.length - 1]
  return updateAtPath(data, parentPath, node => {
    if (Array.isArray(node)) return node.filter((_, i) => i !== key)
    const clone = { ...node }
    delete clone[key]
    return clone
  })
}

// Renames/replaces the node at `path` in one step: used by the edit modal,
// which can change a key, its type, and its value all at once. `newKey` is
// ignored for array items (array indices aren't renameable).
export function replaceAtPath(data, path, newKey, newVal) {
  if (path.length === 0) return newVal
  const parentPath = path.slice(0, -1)
  const oldKey = path[path.length - 1]
  return updateAtPath(data, parentPath, node => {
    if (Array.isArray(node)) {
      const clone = [...node]
      clone[oldKey] = newVal
      return clone
    }
    if (newKey === undefined || newKey === String(oldKey)) {
      return { ...node, [oldKey]: newVal }
    }
    // Preserve key order: rebuild entries with the renamed key in place.
    const entries = Object.entries(node)
    const idx = entries.findIndex(([k]) => k === String(oldKey))
    entries[idx] = [newKey, newVal]
    return Object.fromEntries(entries)
  })
}

export function addFieldAtPath(data, path, key, val) {
  return updateAtPath(data, path, node => {
    if (Array.isArray(node)) return [...node, val]
    return { ...node, [key]: val }
  })
}

export function coerceVal(type, raw) {
  if (type === 'string') return raw
  if (type === 'number') return isNaN(Number(raw)) ? 0 : Number(raw)
  if (type === 'boolean') return raw === true || raw === 'true' || raw === '1'
  if (type === 'null') return null
  if (type === 'object') return {}
  if (type === 'array') return []
  return null
}

// Every container path in `data` (root included, as ''). Used to seed the
// "collapsed" set for collapseAll().
export function allContainerPaths(data, path = [], out = []) {
  const t = typeOf(data)
  if (t !== 'object' && t !== 'array') return out
  out.push(path.join('.'))
  if (t === 'object') for (const [k, v] of Object.entries(data)) allContainerPaths(v, [...path, k], out)
  else data.forEach((v, i) => allContainerPaths(v, [...path, i], out))
  return out
}

// Splits `text` into [{ text, match }] segments for highlight rendering —
// React renders `match` segments in a <mark>, avoiding dangerouslySetInnerHTML.
export function highlightSegments(text, term) {
  const str = String(text)
  if (!term) return [{ text: str, match: false }]
  const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const segments = []
  let lastIndex = 0
  let m
  while ((m = re.exec(str)) !== null) {
    if (m.index > lastIndex) segments.push({ text: str.slice(lastIndex, m.index), match: false })
    segments.push({ text: m[0], match: true })
    lastIndex = m.index + m[0].length
    if (m[0].length === 0) re.lastIndex++
  }
  if (lastIndex < str.length) segments.push({ text: str.slice(lastIndex), match: false })
  return segments.length ? segments : [{ text: str, match: false }]
}

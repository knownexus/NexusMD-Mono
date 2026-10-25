/**
 * Nested folders from the worktree's flat file list: folders first, then files, each sorted by name.
 * A node is { name, path, dirs: [node], files: [{ name, path }] }; the root has path ''.
 * Folders with no listed file (git doesn't track empty ones) don't appear.
 */
export function buildFileTree(files) {
  const root = { name: '', path: '', dirs: [], files: [] }
  const byPath = new Map([['', root]])
  const folder = dir => {
    let node = byPath.get(dir)
    if (node) return node
    const i = dir.lastIndexOf('/')
    const parent = folder(i < 0 ? '' : dir.slice(0, i))
    node = { name: dir.slice(i + 1), path: dir, dirs: [], files: [] }
    parent.dirs.push(node)
    byPath.set(dir, node)
    return node
  }
  for (const file of files) {
    const i = file.lastIndexOf('/')
    folder(i < 0 ? '' : file.slice(0, i)).files.push({ name: file.slice(i + 1), path: file })
  }
  const sort = node => {
    node.dirs.sort((a, b) => a.name.localeCompare(b.name))
    node.files.sort((a, b) => a.name.localeCompare(b.name))
    node.dirs.forEach(sort)
  }
  sort(root)
  return root
}

/** The folder a drop on this row lands in: a folder row is itself, a file row its folder. */
export const dropFolder = (row) => row.kind === 'dir' ? row.path : row.path.slice(0, Math.max(0, row.path.lastIndexOf('/')))

/** One line saying what a drop did, e.g. "Added 2 files, replaced 1, skipped 1." */
export function importSummary({ added = 0, replaced = 0, skipped = 0, failed = [] }) {
  const n = k => `${k} ${k === 1 ? 'file' : 'files'}`
  const parts = []
  // Only the first count names the unit: "Added 2 files, replaced 1, skipped 1."
  const count = k => (parts.length ? k : n(k))
  if (added) parts.push(`added ${count(added)}`)
  if (replaced) parts.push(`replaced ${count(replaced)}`)
  if (skipped) parts.push(`skipped ${count(skipped)}`)
  if (failed.length) parts.push(`${failed.length} failed`)
  if (!parts.length) return 'Nothing to copy.'
  const text = parts.join(', ')
  return `${text[0].toUpperCase()}${text.slice(1)}.`
}

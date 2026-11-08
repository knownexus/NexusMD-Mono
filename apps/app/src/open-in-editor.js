// open-in-editor.js — a text file opened with the app that is not Markdown goes to the Editor. The Editor on Android works on
// an in-app workspace (adapters/editor-workspace.js), so the file is copied in there and opened from there.
//
// The workspace may already hold a file of that name with edits made in the Editor, so a different file never replaces it: the
// new one gets a numbered name. The same file opened again opens the copy that is there.

import { MAX_OPEN_BYTES } from '@nexusmd/core'

const MAX_COPIES = 99

function numbered(safe, n) {
  const dot = safe.lastIndexOf('.')
  return dot > 0 ? `${safe.slice(0, dot)} (${n})${safe.slice(dot)}` : `${safe} (${n})`
}

/**
 * @param {{ fs: { exists(p: string): Promise<boolean>, read(p: string): Promise<string>, write(p: string, t: string): Promise<void> } }} workspace
 * @param {{ name?: string, text: string }} file
 * @param {{ root?: string }} [opts]
 * @returns {Promise<string>} the file's path in the workspace
 */
export async function importIntoWorkspace(workspace, file, { root = '/editor' } = {}) {
  const text = String(file?.text ?? '')
  if (text.includes('\0')) throw new Error('Only text files can be opened.')
  if (text.length > MAX_OPEN_BYTES) throw new Error(`That file is too large to open here (the limit is ${Math.round(MAX_OPEN_BYTES / 1048576)} MB).`)
  const safe = String(file?.name ?? '').replace(/[\/]/g, '_').trim() || 'Untitled.txt'
  const fs = workspace.fs
  for (let n = 1; n <= MAX_COPIES; n++) {
    const path = `${root}/${n === 1 ? safe : numbered(safe, n)}`
    if (!(await fs.exists(path))) { await fs.write(path, text); return path }
    if ((await fs.read(path)) === text) return path
  }
  throw new Error('There are too many copies of that file in the workspace.')
}

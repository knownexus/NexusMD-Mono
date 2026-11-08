// open-text-file.js — a .txt or .md file the person opened with this app (from a file manager, a download, another app) becomes a
// saved document in the Markdown tool on the Documents page, the same `md_documents` store the tool and the desktop layout use.
// A .json file becomes a saved document in the JSON editor (the `json_editor_documents` store), whether or not it parses.
//
// A file opened again, unchanged, brings its document forward instead of making a copy; the newest document is the one the
// Documents page opens on, so the file is what is showing when it appears.

import { jsonAutoName } from '../json/helpers.js'

export const MAX_OPEN_BYTES = 2 * 1024 * 1024 // a text file bigger than this is not opened (it would fill the browser's storage)
const DEFAULT_KEY = 'md_documents'
const JSON_KEY = 'json_editor_documents'

/** The file's name without its folder and its last extension, or null when there is nothing left ('.md', ''). */
export function documentNameOf(fileName) {
  if (typeof fileName !== 'string') return null
  const base = fileName.split(/[\\/]/).pop()
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : dot === 0 ? '' : base
  return stem.trim() || null
}

// The name a document gets from its first # heading, as the Markdown tool does (md-phone.jsx).
const autoNameOf = (content) => { const m = String(content).match(/^#\s+(.+)/m); return m ? m[1].trim().slice(0, 80) : 'Untitled' }
const randomId = () => Math.random().toString(36).slice(2, 10)

// Where each tool keeps its documents: the Markdown tool as { docs: [...] }, the JSON editor as a plain array.
const MARKDOWN_SHAPE = { unwrap: (v) => (v && Array.isArray(v.docs) ? v.docs : undefined), wrap: (docs) => ({ docs }) }
const JSON_SHAPE = { unwrap: (v) => (Array.isArray(v) ? v : undefined), wrap: (docs) => docs }

function readDocs(storage, key, unwrap) {
  const raw = storage.getItem(key)
  if (raw === null || raw === undefined || raw === '') return []
  let parsed
  try { parsed = JSON.parse(raw) } catch { parsed = undefined }
  const docs = unwrap(parsed)
  if (!docs) throw new Error('Your saved documents could not be read, so this file was not added. Nothing has been changed.')
  return docs
}

// Adds the file to the documents kept under `key`, or brings the existing copy forward when the same file is opened again.
function addDocument(storage, file, { now, id, key, autoNameOf: nameFor, shape }) {
  const text = String(file?.text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (text.length > MAX_OPEN_BYTES) throw new Error(`That file is too large to open here (the limit is ${Math.round(MAX_OPEN_BYTES / 1048576)} MB).`)
  const name = documentNameOf(file?.name)
  const docs = readDocs(storage, key, shape.unwrap)

  const same = docs.find((d) => d.content === text && (d.name ?? null) === name)
  const next = same
    ? docs.map((d) => (d.id === same.id ? { ...d, updatedAt: now } : d))
    : [...docs, { id, name, autoName: nameFor(text), content: text, createdAt: now, updatedAt: now }]
  try { storage.setItem(key, JSON.stringify(shape.wrap(next))) } catch { throw new Error('This file could not be saved: the browser storage is full.') }
  return same ? { id: same.id, created: false } : { id, created: true }
}

/**
 * Adds the opened file to the saved Markdown documents.
 * @param {{ getItem(k: string): string|null, setItem(k: string, v: string): void }} storage
 * @param {{ name?: string, text: string }} file
 * @param {{ now?: number, id?: string, key?: string }} [opts] key: where the documents are kept (the phone layout uses the bare key, the tablet layout one per profile)
 * @returns {{ id: string, created: boolean }}
 */
export function addOpenedDocument(storage, file, { now = Date.now(), id = randomId(), key = DEFAULT_KEY } = {}) {
  return addDocument(storage, file, { now, id, key, autoNameOf, shape: MARKDOWN_SHAPE })
}

/**
 * Adds the opened file to the JSON editor's saved documents, as it is: a file that is not valid JSON is kept so the editor can show the error.
 * The JSON editor's documents are a plain array, on the phone and the tablet layouts alike.
 * @returns {{ id: string, created: boolean }}
 */
export function addOpenedJsonDocument(storage, file, { now = Date.now(), id = randomId(), key = JSON_KEY } = {}) {
  return addDocument(storage, file, { now, id, key, autoNameOf: jsonAutoName, shape: JSON_SHAPE })
}

/** True for a Markdown file: by its extension, or by the type the sender gave it (some send .md as text/plain, some as text/markdown). */
export function isMarkdownFile({ name, type } = {}) {
  if (/^text\/(x-)?markdown$/i.test(String(type || ''))) return true
  return /\.(md|markdown|mdown)$/i.test(String(name || '').split(/[\/]/).pop())
}

/** True for a JSON file: by its extension, or by the type the sender gave it. (.jsonc and .json5 are not JSON files.) */
export function isJsonFile({ name, type } = {}) {
  if (/^application\/json$/i.test(String(type || '').split(';')[0].trim())) return true
  return /\.json$/i.test(String(name || '').split(/[\\/]/).pop())
}

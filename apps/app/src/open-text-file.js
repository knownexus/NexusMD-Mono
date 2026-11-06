// open-text-file.js — a .txt or .md file the person opened with this app (from a file manager, a download, another app) becomes a
// saved document in the Markdown tool on the Documents page, the same `md_documents` store the tool and the desktop layout use.
//
// A file opened again, unchanged, brings its document forward instead of making a copy; the newest document is the one the
// Documents page opens on, so the file is what is showing when it appears.

export const MAX_OPEN_BYTES = 2 * 1024 * 1024 // a text file bigger than this is not opened (it would fill the browser's storage)
const DEFAULT_KEY = 'md_documents'

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

function readDocs(storage, key) {
  const raw = storage.getItem(key)
  if (raw === null || raw === undefined || raw === '') return []
  let parsed
  try { parsed = JSON.parse(raw) } catch { parsed = undefined }
  if (!parsed || !Array.isArray(parsed.docs)) throw new Error('Your saved documents could not be read, so this file was not added. Nothing has been changed.')
  return parsed.docs
}

/**
 * Adds the opened file to the saved documents.
 * @param {{ getItem(k: string): string|null, setItem(k: string, v: string): void }} storage
 * @param {{ name?: string, text: string }} file
 * @param {{ now?: number, id?: string, key?: string }} [opts] key: where the documents are kept (the phone layout uses the bare key, the tablet layout one per profile)
 * @returns {{ id: string, created: boolean }}
 */
export function addOpenedDocument(storage, file, { now = Date.now(), id = randomId(), key = DEFAULT_KEY } = {}) {
  const text = String(file?.text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (text.length > MAX_OPEN_BYTES) throw new Error(`That file is too large to open here (the limit is ${Math.round(MAX_OPEN_BYTES / 1048576)} MB).`)
  const name = documentNameOf(file?.name)
  const docs = readDocs(storage, key)

  const same = docs.find((d) => d.content === text && (d.name ?? null) === name)
  const next = same
    ? docs.map((d) => (d.id === same.id ? { ...d, updatedAt: now } : d))
    : [...docs, { id, name, autoName: autoNameOf(text), content: text, createdAt: now, updatedAt: now }]
  try { storage.setItem(key, JSON.stringify({ docs: next })) } catch { throw new Error('This file could not be saved: the browser storage is full.') }
  return same ? { id: same.id, created: false } : { id, created: true }
}

/** True for a Markdown file: by its extension, or by the type the sender gave it (some send .md as text/plain, some as text/markdown). */
export function isMarkdownFile({ name, type } = {}) {
  if (/^text\/(x-)?markdown$/i.test(String(type || ''))) return true
  return /\.(md|markdown|mdown)$/i.test(String(name || '').split(/[\/]/).pop())
}

import { addOpenedDocument, addOpenedJsonDocument, documentNameOf, isMarkdownFile, isJsonFile, savedDocIds } from '@nexusmd/core'
import { getProfileKey } from '@nexusmd/shell-sdk'

// Files the desktop app was opened with (double-click, "Open with") that are Markdown or JSON: each becomes a saved document, a
// copy kept in the app, in the tool's own store under the active profile's key (the same stores the tools read, as on Android).
// The Documents screen watches `getSnapshot()`: `count` rises with each arrival, so it shows the newest document in `tool`
// (or, for `openDoc`, the one named by `docId`).
const STORE_KEYS = { markdown: 'md_documents', json: 'json_editor_documents' }
export function createOpenedFiles({ storage = globalThis.localStorage, profileKey = getProfileKey } = {}) {
  let snapshot = { count: 0, tool: 'markdown', docId: null }
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    /** Adds { name, text } to the Markdown or JSON documents. Throws a message fit to show when it cannot. */
    add(file) {
      let tool, result
      if (isJsonFile(file)) {
        tool = 'json'
        result = addOpenedJsonDocument(storage, file, { key: profileKey('json_editor_documents') })
      } else if (isMarkdownFile(file)) {
        tool = 'markdown'
        result = addOpenedDocument(storage, file, { key: profileKey('md_documents') })
      } else {
        throw new Error(`${file?.name || 'That file'} is not a Markdown or JSON file.`)
      }
      snapshot = { count: snapshot.count + 1, tool, docId: null }
      listeners.forEach(fn => fn())
      return { tool, ...result, name: documentNameOf(file.name) }
    },
    /** Shows one saved document, by id, in its tool (a Home shortcut). { ok: false } when there is no such document. */
    openDoc({ tool, docId } = {}) {
      const key = STORE_KEYS[tool]
      if (!key || !savedDocIds(storage.getItem(profileKey(key))).some(d => d.id === docId)) return { ok: false }
      snapshot = { count: snapshot.count + 1, tool, docId }
      listeners.forEach(fn => fn())
      return { ok: true }
    },
  }
}

// The one the running app uses.
export const openedFiles = createOpenedFiles()

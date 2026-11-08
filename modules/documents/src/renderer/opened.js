import { addOpenedDocument, addOpenedJsonDocument, documentNameOf, isMarkdownFile, isJsonFile } from '@nexusmd/core'
import { getProfileKey } from '@nexusmd/shell-sdk'

// Files the desktop app was opened with (double-click, "Open with") that are Markdown or JSON: each becomes a saved document, a
// copy kept in the app, in the tool's own store under the active profile's key (the same stores the tools read, as on Android).
// The Documents screen watches `getSnapshot()`: `count` rises with each arrival, so it shows the newest document in `tool`.
export function createOpenedFiles({ storage = globalThis.localStorage, profileKey = getProfileKey } = {}) {
  let snapshot = { count: 0, tool: 'markdown' }
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
      snapshot = { count: snapshot.count + 1, tool }
      listeners.forEach(fn => fn())
      return { tool, ...result, name: documentNameOf(file.name) }
    },
  }
}

// The one the running app uses.
export const openedFiles = createOpenedFiles()

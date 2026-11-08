// opened-file.js — a text file opened with the Android app (Open with / Share) arrives through the OpenedFile native
// plugin (OpenedFilePlugin.java). A Markdown file is added to the Markdown documents and a JSON file to the JSON editor's
// documents (open-text-file.js in @nexusmd/core); any other text file is put in the Editor's workspace (open-in-editor.js). The app is told
// which, so it can show it.
import { registerPlugin, Capacitor } from '@capacitor/core'
import { addOpenedDocument, addOpenedJsonDocument, documentNameOf, isMarkdownFile, isJsonFile } from '@nexusmd/core'
import { importIntoWorkspace } from './open-in-editor.js'
import { editorWorkspace, WORKSPACE_ROOT } from './adapters/editor-workspace.js'

export const openedFilePlugin = Capacitor.isNativePlatform() ? registerPlugin('OpenedFile') : null

/**
 * Takes each file the app is opened with, at start and whenever another arrives, and adds it to the documents.
 * @param {{ plugin?: object|null, storage?: Storage, storageKey?: string, jsonStorageKey?: string, workspace?: object, onOpen: (r: { target: 'documents', tool: 'markdown'|'json', id: string, created: boolean, name: string|null } | { target: 'editor', path: string, name: string }) => void, onError: (message: string) => void }} o
 * @returns {() => void} stops listening
 */
export function watchOpenedFiles({ plugin = openedFilePlugin, storage = globalThis.localStorage, storageKey, jsonStorageKey, workspace = editorWorkspace, onOpen, onError }) {
  if (!plugin) return () => {}
  let stopped = false
  let chain = Promise.resolve() // files are taken one at a time, so two arriving together are not read at once
  const drain = () => {
    chain = chain.then(async () => {
      if (stopped) return
      let file
      try { file = await plugin.take() } catch (err) { onError(`The file could not be opened: ${err?.message || err}`); return }
      if (file?.error) { onError(file.error); return }
      if (typeof file?.text !== 'string') return
      try {
        if (isMarkdownFile(file)) {
          const r = addOpenedDocument(storage, file, storageKey ? { key: storageKey } : {})
          onOpen({ target: 'documents', tool: 'markdown', ...r, name: documentNameOf(file.name) })
        } else if (isJsonFile(file)) {
          const r = addOpenedJsonDocument(storage, file, jsonStorageKey ? { key: jsonStorageKey } : {})
          onOpen({ target: 'documents', tool: 'json', ...r, name: documentNameOf(file.name) })
        } else {
          const path = await importIntoWorkspace(workspace, file, { root: WORKSPACE_ROOT })
          onOpen({ target: 'editor', path, name: String(file.name || '').split(/[\\/]/).pop() || 'Untitled.txt' })
        }
      } catch (err) { onError(err.message) }
    })
    return chain
  }
  const sub = Promise.resolve(plugin.addListener?.('fileOpened', drain)).catch(() => null)
  drain()
  return () => { stopped = true; sub.then((s) => s?.remove?.()).catch(() => {}) }
}

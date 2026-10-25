import React from 'react'
import { getProfileKey } from '@nexusmd/shell-sdk'
import { createEditorStore } from './editor-store.js'

// The file API the main process offers (window.electronAPI.editor), looked up when called.
export const editorApi = {
  stat: p => window.electronAPI.editor.stat(p),
  read: p => window.electronAPI.editor.read(p),
  write: (p, text, options) => window.electronAPI.editor.write(p, text, options),
  list: p => window.electronAPI.editor.list(p),
}

// Recent files and folders are kept per profile, like the rest of the app's settings.
const storage = {
  get: key => { try { return localStorage.getItem(getProfileKey(key)) } catch { return null } },
  set: (key, value) => { try { localStorage.setItem(getProfileKey(key), value) } catch { /* ignore */ } },
}

// One store for the window: the screen shows it, and the editor.openPath capability feeds it.
export const editorStore = createEditorStore({ api: editorApi, storage })

export function useEditorStore(store = editorStore) {
  return React.useSyncExternalStore(store.subscribe, store.getState)
}

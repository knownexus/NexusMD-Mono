import { EditorApp } from './editor-app.jsx'
import { editorStore } from './editor-singleton.js'
import { isDirty } from './editor-store.js'

// What the shell gets from the Editor app (see apps/desktop/src/shell/modules.js).
//   views     view id -> component, rendered as <View adapters={...} host={...} />
//   activate  registers what this app offers other apps, and listens for files opened with the app:
//               editor.openPath(path, line?)   open a file (or a folder) in the Editor and show it
//               editor.openText({ id, name, text, origin })
//                                              show text that isn't on disk in a read-only tab
export default {
  id: 'editor',
  views: { editor: EditorApp },
  activate(host) {
    host.capabilities.provide('editor.openPath', async (path, line) => {
      const ok = await editorStore.openPath(path, { line: line ?? null })
      if (ok) host.navigate('editor')
      return ok
    })
    host.capabilities.provide('editor.openText', spec => {
      editorStore.openText(spec)
      host.navigate('editor')
      return true
    })

    const api = typeof window !== 'undefined' ? window.electronAPI?.editor : null
    // Pop-out windows load the same page but are not the app; they must not take its open requests.
    const isPopout = typeof location !== 'undefined' && /^#?popout=/.test(location.hash)
    if (!api || isPopout) return

    const open = paths => {
      for (const p of paths) editorStore.openPath(p)
      if (paths.length) host.navigate('editor')
    }
    // Files the app was launched with, then any from later launches.
    Promise.resolve(api.takePending?.()).then(paths => { if (Array.isArray(paths)) open(paths) }).catch(() => {})
    api.onOpenRequest?.(open)

    // Closing the window with unsaved edits asks first.
    window.addEventListener('beforeunload', e => {
      if (editorStore.getState().docs.some(isDirty)) { e.preventDefault(); e.returnValue = '' }
    })
  },
}

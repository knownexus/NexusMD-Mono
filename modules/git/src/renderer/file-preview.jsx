import React from 'react'
import { CodeEditor, languageForPath } from '@nexusmd/editor-kit/code-editor.jsx'
import { ipcMessage } from './use-git-actions.js'

/**
 * A file's text, read-only and highlighted, for the explorer's preview. `load()` resolves
 * { text } or { missing: true } or { text: null, note } (why it isn't shown: binary, too large),
 * and is called again whenever `loadKey` changes. `extra` follows a note (e.g. a link to GitHub).
 */
export function TextPreview({ path, load, loadKey, extra = null }) {
  const [state, setState] = React.useState({ status: 'loading' })
  const latest = React.useRef(load)
  latest.current = load
  React.useEffect(() => {
    let live = true
    setState(s => (s.status === 'ready' && s.path === path ? s : { status: 'loading' }))
    Promise.resolve().then(() => latest.current()).then(
      r => { if (live) setState(r?.missing ? { status: 'missing' } : r?.text == null ? { status: 'note', note: r?.note } : { status: 'ready', path, text: r.text }) },
      e => { if (live) setState({ status: 'error', error: ipcMessage(e) || String(e) }) },
    )
    return () => { live = false }
  }, [path, loadKey])
  if (state.status === 'loading') return <div className="nx-gw-fx-note nx-gw-fx-pad">Loading…</div>
  if (state.status === 'error') return <div role="alert" className="nx-alert bad nx-gw-fx-pad">{state.error}</div>
  if (state.status === 'missing') return <div className="nx-gw-fx-note nx-gw-fx-pad">This file isn’t there any more.</div>
  if (state.status === 'note') return <div className="nx-gw-fx-note nx-gw-fx-pad">{state.note}{extra && <> {extra}</>}</div>
  return (
    <div className="nx-gw-fx-code">
      <CodeEditor key={path} value={state.text} language={languageForPath(path)} ariaLabel={`Preview of ${path}`} readOnly />
    </div>
  )
}

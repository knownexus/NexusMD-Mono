import React from 'react'
import { profileFileKind, formatJson } from '@nexusmd/core'
import { CodeEditor } from './code-editor.jsx'
import { useProfileFile } from './use-profile-file.js'

const alertStyle = { padding: 10, color: 'var(--danger)' }

export function ProfileFileEditor({ adapter, config, path, onDirtyChange, forms = {} }) {
  const f = useProfileFile({ adapter, config, path })
  const Form = forms[path]
  const [mode, setMode] = React.useState(Form ? 'form' : 'text')
  React.useEffect(() => { onDirtyChange?.(f.dirty) }, [f.dirty, onDirtyChange])

  let parsed = null
  let parseError = null
  if (Form && mode === 'form' && f.status === 'ready') {
    try { parsed = f.text.trim() ? JSON.parse(f.text) : {} } catch (e) { parseError = e.message }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{path}</strong>
        {f.dirty && <span className="chip">Unsaved</span>}
        {Form && (
          <span style={{ display: 'flex', gap: 4 }}>
            <button className={`btn sm ${mode === 'form' ? '' : 'ghost'}`} aria-pressed={mode === 'form'} onClick={() => setMode('form')}>Form</button>
            <button className={`btn sm ${mode === 'text' ? '' : 'ghost'}`} aria-pressed={mode === 'text'} onClick={() => setMode('text')}>Text</button>
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn sm ghost" disabled={!f.dirty || f.saving} onClick={f.revert}>Revert</button>
          <button className="btn sm primary" disabled={!f.dirty || f.saving || f.errors.length > 0} onClick={() => f.save()}>Save</button>
        </span>
      </div>
      {f.restored && <span style={{ color: 'var(--text-muted)' }}>Unsaved changes from earlier were restored.</span>}
      {f.missing && <span style={{ color: 'var(--text-muted)' }}>{`${path} doesn't exist yet - fill it in and Save to create it.`}</span>}
      {f.error && <div className="card" role="alert" style={alertStyle}>{f.error}</div>}
      {f.conflict && (
        <div className="card" role="alert" style={{ ...alertStyle, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>This file changed on disk since you opened it.</span>
          <button className="btn sm" onClick={f.revert}>Reload (discard my changes)</button>
          <button className="btn sm danger" onClick={() => f.save({ overwrite: true })}>Overwrite</button>
        </div>
      )}
      {f.errors.length > 0 && (
        <div className="card" role="alert" style={alertStyle}>
          <strong>Fix before saving</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {f.errors.map((e, i) => <li key={i}>{e.line ? `Line ${e.line}: ${e.message}` : e.message}</li>)}
          </ul>
        </div>
      )}
      {f.status === 'loading' && <span style={{ color: 'var(--text-muted)' }}>Loading…</span>}
      {f.status === 'ready' && Form && mode === 'form' && (parseError
        ? <span style={{ color: 'var(--text-muted)' }}>Fix the JSON in the Text view first.</span>
        : <Form value={parsed} onChange={obj => f.setText(formatJson(obj))} />)}
      {f.status === 'ready' && (!Form || mode === 'text') && (
        <CodeEditor value={f.text} language={profileFileKind(path)} onChange={f.setText} ariaLabel={`Edit ${path}`} />
      )}
    </div>
  )
}

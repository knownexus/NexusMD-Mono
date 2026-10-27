import React from 'react'
import { profileFileKind, formatJson } from '@nexusmd/core'
import { CodeEditor } from '@nexusmd/editor-kit/code-editor.jsx'
import { useProfileFile } from './use-profile-file.js'

export function ProfileFileEditor({ adapter, config, path, onSaved, forms = {} }) {
  const f = useProfileFile({ adapter, config, path })
  const Form = forms[path]
  const save = async opts => { if (await f.save(opts)) onSaved?.() }
  const [mode, setMode] = React.useState(Form ? 'form' : 'text')

  let parsed = null
  let parseError = null
  if (Form && mode === 'form' && f.status === 'ready') {
    try { parsed = f.text.trim() ? JSON.parse(f.text) : {} } catch (e) { parseError = e.message }
  }
  const asForm = f.status === 'ready' && Form && mode === 'form'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div className="nx-editor-head">
        <span className="nx-editor-path nx-trunc" title={path}>{path}</span>
        {f.dirty && <span className="nx-badge warn">Unsaved</span>}
        {Form && (
          <div role="group" aria-label="Edit as" className="nx-pills" style={{ marginLeft: 6 }}>
            <button className="nx-pill" aria-pressed={mode === 'form'} onClick={() => setMode('form')} style={{ height: 26 }}>Form</button>
            <button className="nx-pill" aria-pressed={mode === 'text'} onClick={() => setMode('text')} style={{ height: 26 }}>Text</button>
          </div>
        )}
        <span className="row" style={{ marginLeft: 'auto', gap: 8 }}>
          <button className="btn sm ghost" disabled={!f.dirty || f.saving} onClick={f.revert}>Revert</button>
          <button className="btn sm accent" disabled={!f.dirty || f.saving || f.errors.length > 0} onClick={() => save()}>Save</button>
        </span>
      </div>
      <div className="nx-editor-notes">
        {f.restored && <div className="nx-alert" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>Unsaved changes from earlier were restored.</div>}
        {f.missing && !f.error && <div className="nx-section-note">{`${path} doesn't exist yet - fill it in and Save to create it.`}</div>}
        {f.error && <div className="nx-alert bad" role="alert">{f.error}</div>}
        {f.conflict && (
          <div className="nx-alert bad" role="alert">
            <span style={{ flex: 1 }}>This file changed on disk since you opened it.</span>
            <button className="btn sm" disabled={f.saving} onClick={f.revert}>Reload (discard my changes)</button>
            <button className="btn sm danger" disabled={f.saving} onClick={() => save({ overwrite: true })}>Overwrite</button>
          </div>
        )}
        {f.errors.length > 0 && (
          <div className="nx-alert bad" role="alert" style={{ display: 'block' }}>
            <strong>Fix before saving</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {f.errors.map((e, i) => <li key={i}>{e.line ? `Line ${e.line}: ${e.message}` : e.message}</li>)}
            </ul>
          </div>
        )}
      </div>
      <div className="nx-editor-body">
        {f.status === 'loading' && <span className="nx-muted">Loading…</span>}
        {asForm && (parseError
          ? <span className="nx-muted">Fix the JSON in the Text view first.</span>
          : <Form value={parsed} onChange={obj => f.setText(formatJson(obj))} />)}
        {f.status === 'ready' && (!Form || mode === 'text') && (
          <CodeEditor value={f.text} language={profileFileKind(path)} onChange={f.setText} ariaLabel={`Edit ${path}`} />
        )}
      </div>
    </div>
  )
}

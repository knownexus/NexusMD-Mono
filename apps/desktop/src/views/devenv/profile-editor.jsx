import React from 'react'
import yaml from 'js-yaml'
import { profileFileKind, validateProfileFile, parseProfileJson, formatProfileJson, profileTextStyle } from '@nexusmd/core'
import { getDraft, setDraft, clearDraft } from './profile-drafts.js'
import { EnvironmentForm } from './environment-form.jsx'
import { MacForm } from './mac-form.jsx'

const parseYaml = text => yaml.load(text)
const STRUCTURED = ['environment', 'mac']
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

// One profile file: what's on disk, the draft over it, and saving with the stamp the draft
// started from, so a file changed meanwhile (devenv's mac key-setup, another editor) is
// reported instead of overwritten. The draft text is the single source of truth; the forms
// edit a parse of it and write it back.
export function ProfileEditor({ adapter, config, dir, path, picker, busyLabel, onSaved }) {
  const kind = profileFileKind(path)
  const [file, setFile] = React.useState(null)
  const [readError, setReadError] = React.useState(null)
  const [saveError, setSaveError] = React.useState(null)
  const [conflict, setConflict] = React.useState(null)
  const [saving, setSaving] = React.useState(false)
  const [mode, setMode] = React.useState(STRUCTURED.includes(kind) ? 'Form' : 'Text')
  const [reformatNoted, setReformatNoted] = React.useState(false)
  const [, rerender] = React.useReducer(x => x + 1, 0)
  const reqId = React.useRef(0)

  const load = React.useCallback(async () => {
    const seq = ++reqId.current
    setReadError(null)
    try {
      const r = await adapter.readProfileFile(config, path)
      if (seq !== reqId.current) return
      setFile(r)
      const draft = getDraft(r.dir, path)
      // The disk moved on under a draft kept from earlier: say so before the user saves.
      setConflict(draft && draft.baseStamp !== r.stamp ? { stamp: r.stamp } : null)
    } catch (e) {
      if (seq === reqId.current) { setFile(null); setReadError(e?.message || `Couldn't open ${path}`) }
    }
  }, [adapter, config, path])

  React.useEffect(() => {
    setFile(null); setConflict(null); setSaveError(null); setReformatNoted(false)
    setMode(STRUCTURED.includes(kind) ? 'Form' : 'Text')
    load()
  }, [load, kind])

  const fileDir = file?.dir ?? dir
  const editable = !!file && !file.binary && !file.tooLarge
  const baseText = file?.missing ? '' : (file?.text ?? '')
  const draft = file ? getDraft(fileDir, path) : null
  const text = draft ? draft.text : baseText
  const dirty = !!draft && draft.text !== baseText

  const change = next => {
    if (next === baseText && !conflict) clearDraft(fileDir, path)
    else setDraft(fileDir, path, { text: next, baseStamp: draft ? draft.baseStamp : (file?.stamp ?? null) })
    rerender()
  }

  const check = React.useMemo(() => (editable ? validateProfileFile(path, text, { parseYaml }) : { errors: [], warnings: [] }),
    [editable, path, text])
  const issues = React.useMemo(() => [...check.errors, ...check.warnings.map(w => ({ ...w, warning: true }))], [check])

  // A missing structured file starts as an empty object in the form.
  const parsed = React.useMemo(() => {
    if (!STRUCTURED.includes(kind)) return null
    if (text.trim() === '') return { value: {} }
    const p = parseProfileJson(text)
    return p.error ? p : isObject(p.value) ? p : { error: `${path} must be a JSON object to use the form.` }
  }, [kind, text, path])

  const formChange = next => {
    if (!reformatNoted) setReformatNoted(true)
    const style = text.trim() === '' ? { bom: false, eol: '\n' } : profileTextStyle(text)
    change(formatProfileJson(next, style))
  }

  const write = async expected => {
    setSaving(true)
    setSaveError(null)
    try {
      const r = await adapter.writeProfileFile(config, path, text, { expected, dir: fileDir })
      if (r?.ok) {
        clearDraft(fileDir, path)
        setConflict(null)
        setFile({ dir: fileDir, path, text, stamp: r.stamp })
        onSaved?.(path)
      } else if (r?.stale) {
        setConflict({ stamp: r.stamp })
      }
    } catch (e) {
      setSaveError(e?.message || `Couldn't save ${path}`)
    } finally {
      setSaving(false)
    }
  }

  const canSave = editable && !saving && !check.errors.length && dirty
  const save = () => { if (canSave && !conflict) write(draft ? draft.baseStamp : file.stamp) }
  const overwrite = () => write(conflict.stamp)
  const reload = () => { clearDraft(fileDir, path); setConflict(null); load() }
  const revert = () => { clearDraft(fileDir, path); setConflict(null); rerender() }

  const onKeyDown = e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() }
  }

  if (readError) return <div className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{readError}</div>
  if (!file) return <div style={{ padding: 10, color: 'var(--text-muted)' }}>{`Opening ${path}…`}</div>
  if (!editable) {
    return (
      <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <strong>{path}</strong>
        <span>{file.tooLarge ? "This file is over 1 MiB, so it can't be edited here." : "This file isn't text, so it can't be edited here."}</span>
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => adapter.open({ path: fileDir })}>Open folder</button>
      </div>
    )
  }

  return (
    <div onKeyDown={onKeyDown} style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ flex: 1 }}>{path}{dirty ? ' •' : ''}</strong>
        {STRUCTURED.includes(kind) && ['Form', 'Text'].map(m => (
          <button key={m} className={`btn sm ${mode === m ? '' : 'ghost'}`} aria-pressed={mode === m} onClick={() => setMode(m)}>{m}</button>
        ))}
        <button className="btn sm ghost" disabled={!draft} onClick={revert}>Revert</button>
        <button className="btn sm primary" disabled={!canSave || !!conflict} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </div>

      {file.missing && <span style={{ color: 'var(--text-muted)' }}>{`${path} doesn't exist yet - Save creates it.`}</span>}
      {busyLabel && <span style={{ color: 'var(--text-muted)' }}>{`devenv is running ${busyLabel} - it may have read the file before your save.`}</span>}

      {conflict && (
        <div className="card" role="alert" style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>{conflict.stamp === null ? `${path} was deleted on disk since you opened it.` : `${path} changed on disk since you opened it.`}</span>
          <button className="btn sm" onClick={reload}>Reload</button>
          <button className="btn sm danger" disabled={saving || !!check.errors.length} onClick={overwrite}>Overwrite</button>
        </div>
      )}
      {saveError && <div className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{saveError}</div>}

      {mode === 'Form' && STRUCTURED.includes(kind) && (
        parsed?.error
          ? <div className="card" style={{ padding: 10 }}>{`The form needs valid JSON - fix it in Text. ${parsed.error}`}</div>
          : (
            <>
              {reformatNoted && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Form edits rewrite this file with 2-space indentation.</span>}
              {kind === 'environment'
                ? <EnvironmentForm value={parsed.value} issues={issues} onChange={formChange} />
                : <MacForm value={parsed.value} issues={issues} onChange={formChange} picker={picker} />}
            </>
          )
      )}
      {mode === 'Text' && (
        <textarea aria-label={`Text of ${path}`} spellCheck={false} wrap="off" value={text} onChange={e => change(e.target.value)}
          style={{ minHeight: 360, flex: 1, fontFamily: 'var(--font-mono, monospace)', fontSize: 12, padding: 8, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', resize: 'vertical' }} />
      )}

      {issues.length > 0 && (
        <ul aria-label="Problems" style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
          {issues.map((i, n) => (
            <li key={n} style={{ color: i.warning ? 'var(--warning, #b8860b)' : 'var(--danger)' }}>
              {i.at ? <code>{i.at}</code> : null}{i.at ? ': ' : ''}{i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

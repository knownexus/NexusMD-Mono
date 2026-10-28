import React from 'react'
// api-client-env-editor.jsx — edits one environment's variables. Plain values
// live in the collection's environments/<name>.json; secret ones keep only a
// { secret: true } marker there and their value in secureStorage (see
// var-resolve.js), so the editor loads and saves those separately.

import { Icon } from '../icons.jsx'
import { secretStorageKey, setSecretVar, removeSecretVar } from '@nexusmd/core'

const EMPTY_ROW = { key: '', value: '', secret: false }

async function loadRows(secureStorage, dir, name, envDef) {
  const rows = []
  for (const [key, def] of Object.entries(envDef?.variables || {})) {
    const value = def?.secret
      ? ((await secureStorage?.get?.(secretStorageKey(dir, name, key))) ?? '')
      : (def?.value ?? '')
    rows.push({ key, value: String(value), secret: !!def?.secret })
  }
  return rows.length ? rows : [{ ...EMPTY_ROW }]
}

/** Writes secrets to secureStorage and returns the envDef to save to disk. */
async function saveRows(secureStorage, dir, name, rows, previous) {
  const variables = {}
  for (const { key, value, secret } of rows) {
    if (!key) continue
    if (secret) {
      await setSecretVar(secureStorage, dir, name, key, value)
      variables[key] = { secret: true }
    } else {
      variables[key] = { value }
    }
  }
  // A secret that was removed, renamed or made plain shouldn't linger in secureStorage.
  for (const [key, def] of Object.entries(previous?.variables || {})) {
    if (def?.secret && !variables[key]?.secret) await removeSecretVar(secureStorage, dir, name, key)
  }
  return { ...previous, variables }
}

export function EnvironmentEditor({ dir, name, envDef, secureStorage, onSave, onClose }) {
  const [rows, setRows] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setRows(null)
    setError(null)
    loadRows(secureStorage, dir, name, envDef)
      .then(r => { if (!cancelled) setRows(r) })
      .catch(err => { if (!cancelled) setError(err?.message || String(err)) })
    return () => { cancelled = true }
  }, [secureStorage, dir, name, envDef])

  const update = (i, field, val) => setRows(rows.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)))
  const remove = (i) => setRows(rows.length > 1 ? rows.filter((_, idx) => idx !== i) : [{ ...EMPTY_ROW }])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(await saveRows(secureStorage, dir, name, rows, envDef))
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ac-env-editor">
      <div className="ac-request-bar">
        <div className="ac-env-title">Environment: <strong>{name}</strong></div>
        <div className="ac-request-actions">
          <button className="btn sm" onClick={onClose}>Close</button>
          <button className="btn sm accent" onClick={save} disabled={!rows || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && <div className="ac-error-text" style={{ marginBottom: 8 }}>{error}</div>}
      {!rows && !error && <div className="ac-empty-note">Loading variables…</div>}

      {rows && (
        <div>
          <div className="ac-env-row ac-env-head">
            <span>Variable</span><span>Value</span><span>Secret</span><span/>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="ac-env-row">
              <input className="ac-input" placeholder="name" aria-label="Variable name" value={r.key} onChange={e => update(i, 'key', e.target.value)}/>
              <input
                className="ac-input" placeholder="value" aria-label={`Value of ${r.key || 'variable'}`}
                type={r.secret ? 'password' : 'text'} value={r.value} onChange={e => update(i, 'value', e.target.value)}
              />
              <input type="checkbox" aria-label={`${r.key || 'variable'} is secret`} checked={r.secret} onChange={e => update(i, 'secret', e.target.checked)}/>
              <button className="btn sm icon ghost" onClick={() => remove(i)} title="Remove variable">
                <Icon name="x" size={13}/>
              </button>
            </div>
          ))}
          <button className="ac-add-link" onClick={() => setRows([...rows, { ...EMPTY_ROW }])}>+ Add</button>
          <div className="ac-empty-note">Secret values are kept in this device's secure storage, not in the environment file.</div>
        </div>
      )}
    </div>
  )
}

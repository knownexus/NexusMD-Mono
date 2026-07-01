import React from 'react'
import { mdToHtml } from '@nexusmd/ui'
import { fieldBucket } from './ado-workitem-types.js'
import { settInputStyle } from './desktop-settings.jsx'

function FieldLabel({ def }) {
  return <span>{def.name}{def.alwaysRequired ? ' *' : ''}</span>
}

export function FieldInput({ def, value, onChange, team, paths }) {
  const bucket = fieldBucket(def)
  const id = `wi-field-${def.referenceName}`

  if (bucket === 'picklist') {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <FieldLabel def={def} />
        <select id={id} aria-label={def.name} value={value || ''} onChange={(e) => onChange(e.target.value)} style={settInputStyle}>
          <option value="" />
          {def.allowedValues.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
    )
  }

  if (bucket === 'identity') {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <FieldLabel def={def} />
        <select id={id} aria-label={def.name} value={value || ''} onChange={(e) => onChange(e.target.value)} style={settInputStyle}>
          <option value="">Unassigned</option>
          {(team || []).map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
        </select>
      </label>
    )
  }

  if (bucket === 'treePath') {
    const isArea = def.referenceName === 'System.AreaPath'
    const listId = `${id}-list`
    const options = isArea ? paths.areas : paths.iterations
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <FieldLabel def={def} />
        <input id={id} aria-label={def.name} list={listId} value={value || ''} onChange={(e) => onChange(e.target.value)} style={settInputStyle} />
        <datalist id={listId}>
          {options.map((p) => <option key={p} value={p} />)}
        </datalist>
      </label>
    )
  }

  if (bucket === 'dateTime') {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <FieldLabel def={def} />
        <input id={id} aria-label={def.name} type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} style={settInputStyle} />
      </label>
    )
  }

  if (bucket === 'boolean') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input id={id} aria-label={def.name} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <FieldLabel def={def} />
      </label>
    )
  }

  if (bucket === 'number') {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <FieldLabel def={def} />
        <input id={id} aria-label={def.name} type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={settInputStyle} />
      </label>
    )
  }

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <FieldLabel def={def} />
      <input id={id} aria-label={def.name} type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} style={settInputStyle} />
    </label>
  )
}

const tabStyle = (active) => ({
  fontSize: 11.5, padding: '2px 10px', borderRadius: 6, border: '1px solid var(--border)',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? '#fff' : 'var(--text-muted)',
  cursor: 'pointer', lineHeight: '20px',
})

export function MarkdownField({ label, value, onChange, required, rows = 4 }) {
  const [preview, setPreview] = React.useState(false)
  const id = `wi-md-${label}`

  return (
    <div className="drawer-section">
      <h4 style={{ marginBottom: 6 }}>{label}{required ? ' *' : ''}</h4>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <button type="button" style={tabStyle(!preview)} onClick={() => setPreview(false)}>Write</button>
        <button type="button" style={tabStyle(preview)} onClick={() => setPreview(true)}>Preview</button>
      </div>
      {preview ? (
        <div
          className="wi-html-content"
          style={{ minHeight: 72, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', fontSize: 13, lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: value.trim() ? mdToHtml(value) : '<em>Nothing to preview</em>' }}
        />
      ) : (
        <textarea
          id={id}
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text)', resize: 'vertical', boxSizing: 'border-box' }}
        />
      )}
    </div>
  )
}

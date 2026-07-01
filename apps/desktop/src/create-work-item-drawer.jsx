import React from 'react'
import { mdToHtml, Drawer, TypeIcon, Icon } from '@nexusmd/ui'
import { adoTypeToHelm } from '@nexusmd/core'
import { fieldBucket, fieldGroup } from './ado-workitem-types.js'
import * as adoWorkItemTypesModule from './ado-workitem-types.js'
import { SettField, settInputStyle } from './desktop-settings.jsx'

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

const DEFAULT_TYPE_REF = 'Microsoft.VSTS.WorkItemTypes.Task'

export function CreateWorkItemDrawer({ open, title: initialTitle, project: projectsList, team, onClose, onCreate }) {
  const [project, setProject] = React.useState(projectsList[0] || '')
  const [typeRef, setTypeRef] = React.useState(DEFAULT_TYPE_REF)
  const [defs, setDefs] = React.useState(null)
  const [wiTitle, setWiTitle] = React.useState('')
  const [values, setValues] = React.useState({})
  const [status, setStatus] = React.useState('')

  const load = React.useCallback((proj, type, opts = {}) => {
    adoWorkItemTypesModule.loadWorkItemTypeDefs(proj, type, opts).then((d) => {
      setDefs(d)
      setValues({})
    })
  }, [])

  React.useEffect(() => {
    if (!open) return
    setWiTitle(initialTitle || '')
    setProject(projectsList[0] || '')
    setTypeRef(DEFAULT_TYPE_REF)
    load(projectsList[0] || '', DEFAULT_TYPE_REF)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const typeName = (defs?.types || []).find((t) => t.referenceName === typeRef)?.name || 'Work Item'
  const fields = defs?.fields || []
  const mainFields = fields.filter((f) => fieldGroup(f) === 'main')
  const statusFields = fields.filter((f) => fieldGroup(f) === 'status')
  const classificationFields = fields.filter((f) => fieldGroup(f) === 'classification')
  const planningFields = fields.filter((f) => fieldGroup(f) === 'planning')
  const tagsFields = fields.filter((f) => fieldGroup(f) === 'tags')
  const additionalFields = fields.filter((f) => fieldGroup(f) === 'additional')

  const setFieldValue = (refName, v) => setValues((prev) => ({ ...prev, [refName]: v }))

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`New ${typeName}`}
      badges={<TypeIcon type={adoTypeToHelm(typeName)} />}
      actions={(
        <button className="btn icon ghost sm" title="Refresh field definitions"
          onClick={() => load(project, typeRef, { forceRefresh: true })}>
          <Icon name="refresh" size={13} />
        </button>
      )}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <SettField label="Project">
          <select aria-label="Project" value={project} onChange={(e) => { setProject(e.target.value); load(e.target.value, typeRef) }}>
            {projectsList.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </SettField>
        <SettField label="Type">
          <select aria-label="Type" value={typeRef} onChange={(e) => { setTypeRef(e.target.value); load(project, e.target.value) }}>
            {(defs?.types || []).map((t) => <option key={t.referenceName} value={t.referenceName}>{t.name}</option>)}
          </select>
        </SettField>
      </div>

      <SettField label="Title">
        <input aria-label="Title" value={wiTitle} onChange={(e) => setWiTitle(e.target.value)} autoFocus />
      </SettField>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, marginTop: 14 }}>
        <div>
          {mainFields.map((f) => (
            <div key={f.referenceName} className="drawer-section">{f.name}</div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[statusFields, classificationFields, planningFields, tagsFields].map((group, i) => (
            group.length > 0 && (
              <div key={i} className="drawer-section" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {group.map((f) => (
                  <div key={f.referenceName}>{f.name}</div>
                ))}
              </div>
            )
          ))}
          {additionalFields.length > 0 && (
            <div className="drawer-section">
              <h4>Additional Fields</h4>
              {additionalFields.map((f) => (
                <div key={f.referenceName}>{f.name}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {status && <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>{status}</div>}
    </Drawer>
  )
}

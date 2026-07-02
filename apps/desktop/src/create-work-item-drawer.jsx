import React from 'react'
import { mdToHtml, Drawer, TypeIcon, Icon } from '@nexusmd/ui'
import { adoTypeToHelm } from '@nexusmd/core'
import { fieldBucket, fieldGroup, LINK_TYPES, resolveTypeLayout } from './ado-workitem-types.js'
import * as adoWorkItemTypesModule from './ado-workitem-types.js'
import { SettField, settInputStyle } from './desktop-settings.jsx'

function FieldLabel({ def }) {
  return <span>{def.name}{def.alwaysRequired ? ' *' : ''}</span>
}

export function FieldInput({ def, value, onChange, team, paths }) {
  const bucket = fieldBucket(def)
  const id = `wi-field-${def.referenceName}`

  if (bucket === 'picklist') {
    const isNumeric = typeof def.allowedValues[0] === 'number'
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <FieldLabel def={def} />
        <select id={id} aria-label={def.name} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : (isNumeric ? Number(e.target.value) : e.target.value))} style={settInputStyle}>
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
        <input id={id} aria-label={def.name} type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} style={settInputStyle} />
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
  const [loadError, setLoadError] = React.useState('')

  const load = React.useCallback((proj, type, opts = {}) => {
    setLoadError('')
    adoWorkItemTypesModule.loadWorkItemTypeDefs(proj, type, opts).then((d) => {
      setDefs(d)
      setValues({})
    }).catch((e) => setLoadError(e?.message || 'Failed to load fields.'))
  }, [])

  React.useEffect(() => {
    if (!open) return
    setWiTitle(initialTitle || '')
    setProject(projectsList[0] || '')
    setTypeRef(DEFAULT_TYPE_REF)
    load(projectsList[0] || '', DEFAULT_TYPE_REF)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const [tab, setTab] = React.useState('details')
  const [attachmentFiles, setAttachmentFiles] = React.useState([])
  const [links, setLinks] = React.useState([])
  const [linkRel, setLinkRel] = React.useState(LINK_TYPES[0].rel)
  const [linkId, setLinkId] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [titleError, setTitleError] = React.useState('')

  if (!open) return null

  const typeName = (defs?.types || []).find((t) => t.referenceName === typeRef)?.name || 'Work Item'
  const fields = defs?.fields || []
  const mainFields = fields.filter((f) => fieldGroup(f) === 'main')
  const statusFields = fields.filter((f) => fieldGroup(f) === 'status' && f.referenceName !== 'System.State')
  const classificationFields = fields.filter((f) => fieldGroup(f) === 'classification')
  const planningFields = fields.filter((f) => fieldGroup(f) === 'planning')
  const tagsFields = fields.filter((f) => fieldGroup(f) === 'tags')
  const additionalFields = fields.filter((f) => fieldGroup(f) === 'additional')
  const stateField = fields.find((f) => f.referenceName === 'System.State')
  const typeLayout = resolveTypeLayout(typeName, fields)

  const setFieldValue = (refName, v) => setValues((prev) => ({ ...prev, [refName]: v }))

  const submit = async () => {
    if (!wiTitle.trim()) { setTitleError('Title is required.'); return }
    setTitleError('')
    setSaving(true)
    setStatus('Creating…')
    try {
      const fieldValues = { 'System.Title': wiTitle.trim(), ...values }
      const result = await onCreate({ project, type: typeRef, fields: fieldValues, attachmentFiles, links })
      if (result.warnings && result.warnings.length > 0) {
        setStatus(`Created #${result.id} — ${result.warnings.length} attachment(s)/link(s) failed: ${result.warnings.join('; ')}`)
      } else {
        setStatus(`Created #${result.id}.`)
      }
    } catch (e) {
      setStatus('Error: ' + (e?.message || 'Failed to create'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      defaultWidth={820}
      headerContent={(
        <div className="wi-drawer-header">
          <TypeIcon type={adoTypeToHelm(typeName)} />
          <input
            aria-label="Title"
            className="wi-title-input"
            value={wiTitle}
            onChange={(e) => setWiTitle(e.target.value)}
            autoFocus
          />
          {stateField && (
            <select
              aria-label={stateField.name}
              className="wi-state-pill"
              value={values[stateField.referenceName] ?? ''}
              onChange={(e) => setFieldValue(stateField.referenceName, e.target.value)}
            >
              <option value="" />
              {stateField.allowedValues.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
        </div>
      )}
      actions={(
        <button className="btn icon ghost sm" title="Refresh field definitions"
          onClick={() => load(project, typeRef, { forceRefresh: true })}>
          <Icon name="refresh" size={13} />
        </button>
      )}
    >
      {loadError && (
        <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          {loadError} — click Refresh to retry.
        </div>
      )}

      <div className="wi-tabs" role="tablist">
        <button type="button" className={`wi-tab${tab === 'details' ? ' active' : ''}`} onClick={() => setTab('details')}>Details</button>
        <button type="button" className="wi-tab" disabled title="Available after the item is created">Discussion</button>
        <button type="button" className={`wi-tab${tab === 'links' ? ' active' : ''}`} onClick={() => setTab('links')}>Links</button>
        <button type="button" className={`wi-tab${tab === 'attachments' ? ' active' : ''}`} onClick={() => setTab('attachments')}>Attachments</button>
        <button type="button" className="wi-tab" disabled title="Available after the item is created">History</button>
      </div>

      {titleError && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{titleError}</div>}

      <div hidden={tab !== 'details'}>
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

        {typeLayout ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 14 }}>
            <div>
              {typeLayout.left.map((f) => (
                <MarkdownField
                  key={f.referenceName}
                  label={f.name}
                  required={f.alwaysRequired}
                  value={values[f.referenceName] || ''}
                  onChange={(v) => setFieldValue(f.referenceName, v)}
                />
              ))}
            </div>
            <div>
              {typeLayout.middleTop && (
                <MarkdownField
                  label={typeLayout.middleTop.name}
                  required={typeLayout.middleTop.alwaysRequired}
                  value={values[typeLayout.middleTop.referenceName] || ''}
                  onChange={(v) => setFieldValue(typeLayout.middleTop.referenceName, v)}
                />
              )}
              {typeLayout.planning.length > 0 && (
                <div className="drawer-section" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {typeLayout.planning.map((f) => (
                    <FieldInput
                      key={f.referenceName}
                      def={f}
                      value={values[f.referenceName]}
                      onChange={(v) => setFieldValue(f.referenceName, v)}
                      team={team}
                      paths={defs?.paths || { areas: [], iterations: [] }}
                    />
                  ))}
                </div>
              )}
              {typeLayout.additional.length > 0 && (
                <div className="drawer-section">
                  <h4>Additional Fields</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {typeLayout.additional.map((f) => (
                      <FieldInput
                        key={f.referenceName}
                        def={f}
                        value={values[f.referenceName]}
                        onChange={(v) => setFieldValue(f.referenceName, v)}
                        team={team}
                        paths={defs?.paths || { areas: [], iterations: [] }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, marginTop: 14 }}>
            <div>
              {mainFields.map((f) => (
                <MarkdownField
                  key={f.referenceName}
                  label={f.name}
                  required={f.alwaysRequired}
                  value={values[f.referenceName] || ''}
                  onChange={(v) => setFieldValue(f.referenceName, v)}
                />
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[statusFields, classificationFields, planningFields, tagsFields].map((group, i) => (
                group.length > 0 && (
                  <div key={i} className="drawer-section" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {group.map((f) => (
                      <FieldInput
                        key={f.referenceName}
                        def={f}
                        value={values[f.referenceName]}
                        onChange={(v) => setFieldValue(f.referenceName, v)}
                        team={team}
                        paths={defs?.paths || { areas: [], iterations: [] }}
                      />
                    ))}
                  </div>
                )
              ))}
              {additionalFields.length > 0 && (
                <div className="drawer-section">
                  <h4>Additional Fields</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {additionalFields.map((f) => (
                      <FieldInput
                        key={f.referenceName}
                        def={f}
                        value={values[f.referenceName]}
                        onChange={(v) => setFieldValue(f.referenceName, v)}
                        team={team}
                        paths={defs?.paths || { areas: [], iterations: [] }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div hidden={tab !== 'attachments'} className="drawer-section">
        <h4>Attachments</h4>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>Attach files</span>
          <input
            aria-label="Attach files"
            type="file"
            multiple
            onChange={(e) => setAttachmentFiles((prev) => [...prev, ...Array.from(e.target.files)])}
          />
        </label>
        {attachmentFiles.length > 0 && (
          <ul style={{ marginTop: 8, paddingLeft: 18 }}>
            {attachmentFiles.map((f, i) => (
              <li key={i} style={{ fontSize: 12.5 }}>
                {f.name}
                <button type="button" className="btn icon ghost sm" style={{ marginLeft: 6 }}
                  onClick={() => setAttachmentFiles((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Icon name="x" size={10} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div hidden={tab !== 'links'} className="drawer-section">
        <h4>Links</h4>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>Link type</span>
            <select aria-label="Link type" value={linkRel} onChange={(e) => setLinkRel(e.target.value)}>
              {LINK_TYPES.map((lt) => <option key={lt.rel} value={lt.rel}>{lt.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>Linked work item ID</span>
            <input aria-label="Linked work item ID" type="number" value={linkId} onChange={(e) => setLinkId(e.target.value)} />
          </label>
          <button type="button" className="btn sm"
            onClick={() => {
              const id = parseInt(linkId, 10)
              if (!id) return
              setLinks((prev) => [...prev, { rel: linkRel, id }])
              setLinkId('')
            }}>
            + Add link
          </button>
        </div>
        {links.length > 0 && (
          <ul style={{ paddingLeft: 18 }}>
            {links.map((l, i) => (
              <li key={i} style={{ fontSize: 12.5 }}>
                #{l.id} ({LINK_TYPES.find((lt) => lt.rel === l.rel)?.label})
                <button type="button" className="btn icon ghost sm" title="Remove link" style={{ marginLeft: 6 }}
                  onClick={() => setLinks((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Icon name="x" size={10} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ position: 'sticky', bottom: 0, background: 'var(--surface)', paddingTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
        <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
        {status && <span style={{ fontSize: 12.5, color: status.startsWith('Error') ? 'var(--danger)' : 'var(--text-muted)' }}>{status}</span>}
      </div>
    </Drawer>
  )
}

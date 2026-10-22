// apps/desktop/src/jira-create-form.jsx — generic Jira issue form driven by the
// normalised create-meta from @nexusmd/core (core fields first, then required,
// then optional extras under "More fields").
import { linkAdapter } from './adapters/link.js'
import React from 'react'
import { mdToHtml } from '@nexusmd/ui'
import { layoutCreateFields } from '@nexusmd/core'
import { MarkdownField } from './create-work-item-drawer.jsx'
import { SettField, settInputStyle } from './desktop-settings.jsx'

function JiraFieldInput({ field, value, onChange, people }) {
  const label = `${field.name}${field.required ? ' *' : ''}`
  switch (field.kind) {
    case 'richtext':
      return <MarkdownField label={field.name} required={field.required} value={value || ''} onChange={onChange} />
    case 'user':
      return (
        <SettField label={label}>
          <select aria-label={label} value={value || ''} onChange={e => onChange(e.target.value)} style={settInputStyle}>
            <option value="">Unassigned</option>
            {people.map(p => <option key={p.accountId} value={p.accountId}>{p.displayName}</option>)}
          </select>
        </SettField>
      )
    case 'option':
      return (
        <SettField label={label}>
          <select aria-label={label} value={value || ''} onChange={e => onChange(e.target.value)} style={settInputStyle}>
            <option value="" />
            {field.allowedValues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </SettField>
      )
    case 'multi-option':
      return (
        <SettField label={label}>
          <select aria-label={label} multiple value={value || []} style={{ ...settInputStyle, minHeight: 64 }}
            onChange={e => onChange(Array.from(e.target.selectedOptions).map(o => o.value))}>
            {field.allowedValues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </SettField>
      )
    case 'number':
      return (
        <SettField label={label}>
          <input aria-label={label} type="number" value={value ?? ''} onChange={e => onChange(e.target.value)} style={settInputStyle} />
        </SettField>
      )
    case 'date':
      return (
        <SettField label={label}>
          <input aria-label={label} type="date" value={value || ''} onChange={e => onChange(e.target.value)} style={settInputStyle} />
        </SettField>
      )
    case 'datetime':
      return (
        <SettField label={label}>
          <input aria-label={label} type="datetime-local" value={value || ''} onChange={e => onChange(e.target.value)} style={settInputStyle} />
        </SettField>
      )
    case 'labels':
      return (
        <SettField label={label} hint="Comma-separated. Spaces become hyphens.">
          <input aria-label={label} value={value || ''} onChange={e => onChange(e.target.value)} style={settInputStyle} />
        </SettField>
      )
    case 'parent':
      return (
        <SettField label={label} hint="Parent or epic key, e.g. ABC-12">
          <input aria-label={label} value={value || ''} onChange={e => onChange(e.target.value)} style={settInputStyle} />
        </SettField>
      )
    default:
      return (
        <SettField label={label}>
          <input aria-label={label} value={value || ''} onChange={e => onChange(e.target.value)} style={settInputStyle} />
        </SettField>
      )
  }
}

export function JiraCreateForm({ source, projectKeys = [], people = [], site = '', initialTitle = '', onCreated }) {
  const [projectKey, setProjectKey] = React.useState(projectKeys[0] || '')
  const [types, setTypes] = React.useState([])
  const [typeId, setTypeId] = React.useState('')
  const [fields, setFields] = React.useState([])
  const [values, setValues] = React.useState({})
  const [summary, setSummary] = React.useState(initialTitle || '')
  const [linkTypes, setLinkTypes] = React.useState([])
  const [links, setLinks] = React.useState([])
  const [linkType, setLinkType] = React.useState('')
  const [linkKey, setLinkKey] = React.useState('')
  const [files, setFiles] = React.useState([])
  const [error, setError] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [fieldsLoading, setFieldsLoading] = React.useState(false)
  // Set after a successful create; any later change to the form clears it, so the
  // same issue can't be submitted twice by accident.
  const [created, setCreated] = React.useState(false)

  React.useEffect(() => {
    if (!projectKey) return
    setError('')
    source.getCreateTypes(projectKey)
      .then(t => { setTypes(t); setTypeId(t[0]?.id || '') })
      .catch(e => setError(e?.message || 'Could not load issue types'))
  }, [projectKey, source])

  React.useEffect(() => {
    if (!projectKey || !typeId) return
    let cancelled = false
    setValues({})
    setFields([])
    setFieldsLoading(true)
    source.getCreateFields(projectKey, typeId)
      .then(f => { if (!cancelled) { setFields(f); setError('') } })
      .catch(e => { if (!cancelled) setError(e?.message || 'Could not load fields') })
      .finally(() => { if (!cancelled) setFieldsLoading(false) })
    return () => { cancelled = true }
  }, [projectKey, typeId, source])

  React.useEffect(() => { setCreated(false) }, [projectKey, typeId, summary, values, links, files])

  React.useEffect(() => {
    source.getLinkTypes()
      .then(t => { setLinkTypes(t); setLinkType(t[0]?.name || '') })
      .catch(() => {})
  }, [source])

  const layout = layoutCreateFields(fields)
  const setValue = (key, v) => setValues(prev => ({ ...prev, [key]: v }))
  const renderField = (f) => <JiraFieldInput key={f.key} field={f} value={values[f.key]} onChange={v => setValue(f.key, v)} people={people} />

  const submit = async () => {
    if (saving || fieldsLoading || created) return
    if (!summary.trim()) { setError('Summary is required.'); return }
    const missing = [...layout.core, ...layout.required].filter(f => f.required && (values[f.key] === undefined || values[f.key] === '' || (Array.isArray(values[f.key]) && !values[f.key].length)))
    if (missing.length) { setError(`Fill in: ${missing.map(f => f.name).join(', ')}`); return }
    setError('')
    setSaving(true)
    setStatus('Creating…')
    try {
      const prepared = { ...values }
      fields.filter(f => f.kind === 'richtext' && prepared[f.key]).forEach(f => { prepared[f.key] = mdToHtml(prepared[f.key]) })
      const result = await source.createIssue(
        { projectKey, typeId, summary: summary.trim(), values: prepared, fields },
        { attachments: files, links },
      )
      setStatus(result.warnings?.length ? `Created ${result.key} — ${result.warnings.join('; ')}` : `Created ${result.key}.`)
      setCreated(true)
      onCreated?.(result)
    } catch (e) {
      setStatus('')
      setError('Error: ' + (e?.message || 'Failed to create'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <SettField label="Project">
          <select aria-label="Project" value={projectKey} onChange={e => setProjectKey(e.target.value)} style={settInputStyle}>
            {projectKeys.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </SettField>
        <SettField label="Issue type">
          <select aria-label="Issue type" value={typeId} onChange={e => setTypeId(e.target.value)} style={settInputStyle}>
            {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </SettField>
      </div>
      <SettField label="Summary *">
        <input aria-label="Summary" value={summary} onChange={e => setSummary(e.target.value)} autoFocus style={settInputStyle} />
      </SettField>

      {layout.unsupportedRequired.length > 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          This issue type needs {layout.unsupportedRequired.map(f => f.name).join(', ')}, which NexusMD can&apos;t set yet.{' '}
          <a href={`${site}/browse/${encodeURIComponent(projectKey)}`} target="_blank" rel="noopener"
            onClick={e => { if (linkAdapter.canOpenLink()) { e.preventDefault(); linkAdapter.openLink(`${site}/browse/${encodeURIComponent(projectKey)}`) } }}>
            Open project in Jira
          </a>
        </div>
      ) : (
        <>
          {layout.core.map(renderField)}
          {layout.required.map(renderField)}
          {layout.more.length > 0 && (
            <details>
              <summary style={{ fontSize: 12.5, cursor: 'pointer' }}>More fields</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>{layout.more.map(renderField)}</div>
            </details>
          )}

          <div className="drawer-section">
            <h4>Links</h4>
            <div style={{ display: 'flex', gap: 6 }}>
              <select aria-label="Link type" value={linkType} onChange={e => setLinkType(e.target.value)} style={{ ...settInputStyle, width: 'auto' }}>
                {linkTypes.map(t => <option key={t.id} value={t.name}>{t.outward}</option>)}
              </select>
              <input aria-label="Linked issue key" value={linkKey} onChange={e => setLinkKey(e.target.value)} placeholder="ABC-12" style={settInputStyle} />
              <button type="button" className="btn sm" disabled={!linkKey.trim() || !linkType}
                onClick={() => { setLinks(l => [...l, { typeName: linkType, key: linkKey.trim().toUpperCase() }]); setLinkKey('') }}>Add</button>
            </div>
            {links.map((l, i) => (
              <div key={i} style={{ fontSize: 12.5, marginTop: 4 }}>
                {linkTypes.find(t => t.name === l.typeName)?.outward || l.typeName} <span className="mono">{l.key}</span>
                <button type="button" className="btn icon ghost sm" title="Remove link" onClick={() => setLinks(ls => ls.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>

          <div className="drawer-section">
            <h4>Attachments</h4>
            <input aria-label="Attachments" type="file" multiple onChange={e => setFiles(Array.from(e.target.files || []))} />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn primary" onClick={submit} disabled={saving || fieldsLoading || created}>{saving ? 'Creating…' : 'Create issue'}</button>
            {status && <span style={{ fontSize: 12.5, color: 'var(--success)' }}>{status}</span>}
          </div>
        </>
      )}
      {error && <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>{error}</div>}
    </div>
  )
}

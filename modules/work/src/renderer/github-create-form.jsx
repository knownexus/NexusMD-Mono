// modules/work/src/renderer/github-create-form.jsx — new GitHub issue in one of the selected
// repos: title, markdown body, and the repo's own labels, assignees and milestones.
import React from 'react'
import { SettField } from '@nexusmd/ui'
import { MarkdownField } from './create-work-item-drawer.jsx'
import { settInputStyle } from './form-style.js'

const EMPTY_META = { labels: [], assignees: [], milestones: [] }
const selected = (e) => Array.from(e.target.selectedOptions).map(o => o.value)

export function GithubCreateForm({ source, repos = [], defaultTitle = '', onTitleChange, onCreated }) {
  const [repo, setRepo] = React.useState(repos[0] || '')
  const [meta, setMeta] = React.useState(EMPTY_META)
  const [title, setTitle] = React.useState(defaultTitle || '')
  const [body, setBody] = React.useState('')
  const [labels, setLabels] = React.useState([])
  const [assignees, setAssignees] = React.useState([])
  const [milestone, setMilestone] = React.useState('')
  const [error, setError] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  // Set after a successful create; any later change clears it, so one issue isn't made twice.
  const [created, setCreated] = React.useState(false)

  React.useEffect(() => {
    if (!repo) return
    let cancelled = false
    setMeta(EMPTY_META); setLabels([]); setAssignees([]); setMilestone('')
    source.getCreateMeta(repo)
      .then(m => { if (!cancelled) { setMeta(m || EMPTY_META); setError('') } })
      .catch(e => { if (!cancelled) setError(e?.message || 'Could not load labels and assignees') })
    return () => { cancelled = true }
  }, [repo, source])

  React.useEffect(() => { setCreated(false) }, [repo, title, body, labels, assignees, milestone])

  const changeTitle = (v) => { setTitle(v); onTitleChange?.(v) }

  const submit = async () => {
    if (saving || created || !title.trim()) return
    setError(''); setSaving(true); setStatus('Creating…')
    try {
      // GitHub stores markdown, so the body goes as typed.
      const result = await source.createIssue({
        repo, title: title.trim(), body, labels, assignees, milestone: milestone ? Number(milestone) : null,
      })
      setStatus(`Created ${result.id.replace(/^gh:/, '')}.`)
      setCreated(true)
      onCreated?.(result)
    } catch (e) {
      setStatus('')
      setError('Error: ' + (e?.message || 'Failed to create'))
    } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SettField label="Repository">
        <select aria-label="Repository" value={repo} onChange={e => setRepo(e.target.value)} style={settInputStyle}>
          {repos.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </SettField>
      <SettField label="Title *">
        <input aria-label="Title" value={title} onChange={e => changeTitle(e.target.value)} autoFocus style={settInputStyle} />
      </SettField>
      <MarkdownField label="Body" value={body} onChange={setBody} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <SettField label="Labels">
          <select aria-label="Labels" multiple value={labels} onChange={e => setLabels(selected(e))} style={{ ...settInputStyle, minHeight: 72 }}>
            {meta.labels.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </SettField>
        <SettField label="Assignees">
          <select aria-label="Assignees" multiple value={assignees} onChange={e => setAssignees(selected(e))} style={{ ...settInputStyle, minHeight: 72 }}>
            {meta.assignees.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </SettField>
      </div>
      <SettField label="Milestone">
        <select aria-label="Milestone" value={milestone} onChange={e => setMilestone(e.target.value)} style={settInputStyle}>
          <option value="">None</option>
          {meta.milestones.map(m => <option key={m.number} value={String(m.number)}>{m.title}</option>)}
        </select>
      </SettField>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn primary" onClick={submit} disabled={saving || created || !title.trim()}>{saving ? 'Creating…' : 'Create issue'}</button>
        {status && <span style={{ fontSize: 12.5, color: 'var(--success)' }}>{status}</span>}
      </div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>{error}</div>}
    </div>
  )
}

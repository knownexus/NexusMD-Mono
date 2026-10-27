import React from 'react'
import { VsCard, VsRow } from '@nexusmd/ui'

// Settings → Cards & Tables: the links along the top of the Dashboard.
export function QuickLinksCard({ links, onChange }) {
  const [editing, setEditing] = React.useState(null)
  const [form, setForm] = React.useState({ label: '', url: '', color: 'var(--accent)' })

  const open = (idx) => {
    if (idx === 'new') {
      setForm({ label: '', url: '', color: 'var(--accent)' })
    } else {
      setForm({ ...links[idx] })
    }
    setEditing(idx)
  }
  const save = () => {
    if (!form.label || !form.url) return
    if (!/^https?:\/\//i.test(form.url)) return
    const next = editing === 'new'
      ? [...links, form]
      : links.map((l, i) => i === editing ? form : l)
    onChange(next)
    setEditing(null)
  }
  const remove = (idx) => onChange(links.filter((_, i) => i !== idx))

  const inp = { width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }

  return (
    <VsCard title="Quick links" icon="link">
      {links.map((l, i) => (
        <VsRow key={i} title={l.label} desc={l.url}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm ghost" onClick={() => open(i)}>Edit</button>
            <button className="btn sm ghost danger" onClick={() => remove(i)}>Remove</button>
          </div>
        </VsRow>
      ))}
      <div style={{ padding: '8px 16px' }}>
        <button className="btn sm" onClick={() => open('new')}>+ Add link</button>
      </div>
      {editing !== null && (
        <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input placeholder="Label" value={form.label} style={inp} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
          <input placeholder="URL" value={form.url} style={inp} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
          <input placeholder="Colour (CSS var or hex)" value={form.color} style={inp} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn sm primary" onClick={save} disabled={!form.label || !form.url}>Save</button>
          </div>
        </div>
      )}
    </VsCard>
  )
}

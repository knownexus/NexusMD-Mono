import React from 'react'
import { Icon } from '@nexusmd/ui'

export function ProjectAreasModal({ open, onClose }) {
  const [areas, setAreas] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('nexusmd.projectAreas.v3') || '[]') } catch { return [] }
  })

  React.useEffect(() => {
    if (open) {
      try { setAreas(JSON.parse(localStorage.getItem('nexusmd.projectAreas.v3') || '[]')) } catch { setAreas([]) }
    }
  }, [open])

  const save = (next) => {
    setAreas(next)
    try { localStorage.setItem('nexusmd.projectAreas.v3', JSON.stringify(next)) } catch {}
  }

  if (!open) return null

  const addArea  = () => save([...areas, { id: Date.now().toString(), label: 'New area' }])
  const remove   = (id) => save(areas.filter(a => a.id !== id))
  const rename   = (id, label) => save(areas.map(a => a.id === id ? { ...a, label } : a))

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 10, padding: 24, width: 'min(520px, 92vw)',
        maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Project Areas</h2>
          <button className="btn sm ghost" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {areas.length === 0 && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>No areas yet. Click "+ Add area" to create one.</p>
          )}
          {areas.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <input
                value={a.label}
                onChange={e => rename(a.id, e.target.value)}
                style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13 }}
              />
              <button className="btn sm ghost" onClick={() => remove(a.id)} title="Delete area">
                <Icon name="trash" size={12}/>
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn sm" onClick={addArea}>+ Add area</button>
          <button className="btn sm primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

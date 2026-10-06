import React from 'react'
import { Icon, TypeIcon, Avatar, useNexusData } from '@nexusmd/ui'
import { displayIdOf } from '@nexusmd/core'

function readTeamNotes(storage, devId) {
  let all = []
  try { all = JSON.parse(storage.getItem('nexusmd.team.notes') || '[]') } catch { all = [] }
  return all.filter(n => n.devId === devId)
}

function formatNoteDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function PersonSummary({ dev, onOpenItem, onOpenPR }) {
  const { storage } = useNexusData()
  const [notes, setNotes] = React.useState(() => readTeamNotes(storage, dev.id))

  React.useEffect(() => {
    setNotes(readTeamNotes(storage, dev.id))
    const onChanged = () => setNotes(readTeamNotes(storage, dev.id))
    window.addEventListener('nexusmd:team-notes-changed', onChanged)
    return () => window.removeEventListener('nexusmd:team-notes-changed', onChanged)
  }, [storage, dev.id])

  const deleteNote = (noteId) => {
    window.dispatchEvent(new CustomEvent('nexusmd:team-delete-note', { detail: { noteId } }))
  }

  return (
    <div>
      <div className="drawer-section" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar who={dev.id} size="lg"/>
        <div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{dev.name}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>{dev.role}{dev.tz ? ` · ${dev.tz}` : ''}</div>
          {dev.focus && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>{dev.focus}</div>}
        </div>
      </div>

      <div className="drawer-section">
        <div className="dev-card-stats">
          <div className="dev-stat">
            <div className="dev-stat-label">Active</div>
            <div className="dev-stat-value">{dev.active.length}</div>
          </div>
          <div className="dev-stat">
            <div className="dev-stat-label">Open PRs</div>
            <div className="dev-stat-value">{dev.myPRs.length}</div>
          </div>
          <div className="dev-stat">
            <div className="dev-stat-label">Sprint pts</div>
            <div className="dev-stat-value">{dev.points}</div>
          </div>
        </div>
      </div>

      {dev.blocked.length > 0 && (
        <div className="drawer-section" style={{
          background: 'var(--danger-soft)', color: 'var(--danger)', padding: '6px 10px', borderRadius: 6,
          fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Icon name="alert" size={12}/>
          <span style={{ fontWeight: 500 }}>{dev.blocked.length} blocker{dev.blocked.length !== 1 ? 's' : ''}</span>
          <span className="truncate" style={{ opacity: 0.8 }}>· {dev.blocked[0].title}</span>
        </div>
      )}

      <div className="drawer-section">
        <h4>Active work ({dev.active.length})</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {dev.active.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No active work items.</div>}
          {dev.active.map(w => (
            <div key={w.id} onClick={() => onOpenItem(w)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <TypeIcon type={w.type}/><span style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontSize: 11.5 }}>{displayIdOf(w)}</span>
              <span>{w.title}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="drawer-section">
        <h4>Open PRs ({dev.myPRs.length})</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {dev.myPRs.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No open pull requests.</div>}
          {dev.myPRs.map(p => (
            <div key={p.id} onClick={() => onOpenPR(p)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontSize: 11.5 }}>#{p.id}</span>
              <span>{p.title}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="drawer-section">
        <h4>Notes ({notes.length})</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {notes.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No notes yet.</div>}
          {notes.map(n => (
            <div key={n.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12.5 }}>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.note}</span>
              <span className="muted" style={{ fontSize: 10.5, flexShrink: 0, marginTop: 1 }}>{formatNoteDate(n.date)}</span>
              <button className="btn icon ghost sm" title="Delete note" style={{ height: 18, padding: 0, flexShrink: 0 }}
                onClick={() => deleteNote(n.id)}>
                <Icon name="trash" size={11}/>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function PersonActions({ dev }) {
  const scheduleOneOnOne = () => window.dispatchEvent(
    new CustomEvent('nexusmd:team-schedule-1on1', { detail: { id: dev.id, name: dev.name } })
  )
  const addNote = () => window.dispatchEvent(
    new CustomEvent('nexusmd:team-add-note', { detail: { id: dev.id, name: dev.name } })
  )
  return (
    <React.Fragment>
      <button className="btn sm ghost" onClick={scheduleOneOnOne}><Icon name="clock" size={12}/> Schedule 1:1</button>
      <button className="btn sm ghost" onClick={addNote}><Icon name="message" size={12}/> Add note</button>
    </React.Fragment>
  )
}

import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { normaliseRefPrompt } from '@nexusmd/core'

const field = { width: '100%', padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontSize: 13 }
const heading = { fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 6 }

// devenv's branch picker: an existing worktree, a remote branch (devenv creates a worktree
// for it), or any ref. Closing it keeps the current branch, as Enter does in the terminal.
export function RefPickerDialog({ prompt, onAnswer }) {
  const ref = normaliseRefPrompt(prompt)
  const [filter, setFilter] = React.useState('')
  const [typed, setTyped] = React.useState('')
  const q = filter.trim().toLowerCase()
  const remotes = ref.remotes.filter(r => !q || r.toLowerCase().includes(q))
  const cancel = () => onAnswer({ kind: 'cancel' })

  return (
    <PlModal open closeOnBackdrop={false} onClose={cancel} icon="build" title={prompt.title || `Branch for ${ref.name}`} sub={`Currently ${ref.current}`}
      footer={<button className="btn ghost" onClick={cancel}>Cancel</button>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={heading}>Worktrees</div>
        {ref.worktrees.map((w, i) => (
          <button key={w.path} className="btn ghost sm" style={{ textAlign: 'left' }} onClick={() => onAnswer({ kind: 'worktree', index: i })}>
            {`${w.display}  (${w.folder})${w.current ? ' — current' : ''}`}
          </button>
        ))}
        {!ref.worktrees.length && <div style={{ color: 'var(--text-muted)' }}>No worktrees found.</div>}

        <div style={heading}>Remote branches</div>
        <input aria-label="Filter remote branches" placeholder="Filter remote branches" value={filter} onChange={e => setFilter(e.target.value)} style={field} />
        <div style={{ maxHeight: 220, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {remotes.map(r => (
            <button key={r} className="btn ghost sm" style={{ textAlign: 'left' }} title="Creates a new worktree" onClick={() => onAnswer({ kind: 'remote', name: r })}>
              {`${r} — creates a new worktree`}
            </button>
          ))}
        </div>

        <div style={heading}>Other ref</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input aria-label="Branch, tag or SHA" placeholder="Branch, tag or SHA" value={typed} onChange={e => setTyped(e.target.value)} style={field} />
          <button className="btn" disabled={!typed.trim()} onClick={() => onAnswer({ kind: 'ref', value: typed.trim() })}>Use</button>
        </div>
      </div>
    </PlModal>
  )
}

import React from 'react'
import { PlModal } from '@nexusmd/ui'

/**
 * Dropped files whose names already exist in the target folder, asked about one at a time:
 * Replace or Skip each (or tick "Apply to all remaining"). `onDone(replace)` gets the names to replace;
 * Cancel (or closing) copies nothing at all.
 */
export function ImportDialog({ folder, conflicts, onDone, onCancel }) {
  const [index, setIndex] = React.useState(0)
  const [all, setAll] = React.useState(false)
  const replace = React.useRef([])
  const current = conflicts[index]
  const choose = doReplace => {
    const rest = all ? conflicts.slice(index) : [current]
    if (doReplace) replace.current.push(...rest)
    if (all || index + 1 >= conflicts.length) onDone(replace.current)
    else setIndex(index + 1)
  }
  const left = conflicts.length - index
  return (
    <PlModal open onClose={onCancel} title="Replace existing files?" icon="warning"
      footer={(
        <>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" onClick={() => choose(false)}>Skip</button>
          <button className="btn primary" autoFocus onClick={() => choose(true)}>Replace</button>
        </>
      )}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div>
          <code style={{ wordBreak: 'break-all' }}>{current}</code>
          {` already exists in ${folder ? folder : 'the repository root'}.`}
        </div>
        <div role="note" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Replacing overwrites the file on disk; any uncommitted changes in it are lost.
        </div>
        {conflicts.length > 1 && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />
            {`Apply to all remaining (${left})`}
          </label>
        )}
      </div>
    </PlModal>
  )
}

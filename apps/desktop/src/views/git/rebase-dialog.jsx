import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { rebasePlan, moveRow, setRowAction, setRowMessage, rebaseProblems, messageRows, REBASE_ACTIONS } from '@nexusmd/core'

/**
 * Arrange an interactive rebase: commits oldest first, an action each, order by ↑/↓, and a message
 * field for rewords and for the last commit of each squash group (where git asks for it).
 */
export function RebaseDialog({ commits, base, onClose, onRun }) {
  const [rows, setRows] = React.useState(() => rebasePlan(commits))
  const problems = rebaseProblems(rows)
  const withMessage = messageRows(rows)
  const footer = (
    <>
      <button className="btn sm ghost" onClick={onClose}>Cancel</button>
      <button className="btn sm" disabled={problems.length > 0} onClick={() => onRun({ base, rows: rows.map(({ oid, action, message }) => ({ oid, action, message })) })}>Preview rebase</button>
    </>
  )
  return (
    <PlModal open wide onClose={onClose} title="Interactive rebase" sub={`onto ${base.slice(0, 7)}`} icon="git-branch" footer={footer}>
      <ol aria-label="Rebase plan" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
        {rows.map((r, i) => (
          <li key={r.oid}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select aria-label={`Action for ${r.oid.slice(0, 7)}`} value={r.action} onChange={e => setRows(setRowAction(rows, r.oid, e.target.value))}>
                {REBASE_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <code>{r.oid.slice(0, 7)}</code>
              <span style={{ flex: 1, textDecoration: r.action === 'drop' ? 'line-through' : undefined }}>{r.subject}</span>
              <button className="btn sm ghost" aria-label={`Move ${r.oid.slice(0, 7)} up`} disabled={i === 0} onClick={() => setRows(moveRow(rows, r.oid, -1))}>↑</button>
              <button className="btn sm ghost" aria-label={`Move ${r.oid.slice(0, 7)} down`} disabled={i === rows.length - 1} onClick={() => setRows(moveRow(rows, r.oid, 1))}>↓</button>
            </div>
            {withMessage.has(r.oid) && (
              <textarea aria-label={`Message for ${r.oid.slice(0, 7)}`} rows={2} style={{ width: '100%', marginTop: 4 }}
                placeholder={r.action === 'reword' ? 'New message' : 'Message for the combined commit (empty keeps git\'s)'}
                value={r.message ?? ''} onChange={e => setRows(setRowMessage(rows, r.oid, e.target.value))} />
            )}
          </li>
        ))}
      </ol>
      {problems.length > 0 && <ul role="alert" style={{ color: 'var(--danger)', margin: '8px 0 0', paddingLeft: 18 }}>{problems.map(p => <li key={p}>{p}</li>)}</ul>}
      <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Only commits that haven't been pushed can be rebased here, so nothing published is rewritten.</p>
    </PlModal>
  )
}

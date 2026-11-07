import React from 'react'
import { relativeTime } from './history-pane.jsx'

const WORD = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed' }
const TONE = { unstaged: 'warn', staged: 'ok', untracked: 'info', conflict: 'bad' }

// "Modified · not staged", "Modified · staged", "Untracked", "Conflicted".
function statusText(change) {
  if (change.area === 'untracked') return 'Untracked'
  if (change.area === 'conflict') return 'Conflicted'
  const code = change.area === 'staged' ? change.xy?.[0] : change.xy?.[1]
  const word = WORD[code] ?? 'Modified'
  return `${word} · ${change.area === 'staged' ? 'staged' : 'not staged'}`
}

const baseOf = path => path.slice(path.lastIndexOf('/') + 1)
const dirOf = path => path.slice(0, Math.max(0, path.lastIndexOf('/')))

/**
 * The Files tab's right-hand panel for the picked file: its name and folder, how it is changed (when it is)
 * with View diff, Stage / Unstage and Discard…, its latest commits, and the ways to open it. `change` is the
 * file's change (unstaged first), `counts` its { add, del } lines when known, `commits` the recent ones
 * (null while loading), `elsewhere` the other app's { label }.
 */
export function FileRail({
  path, change, counts = null, commits, elsewhere, onViewDiff, onStage, onUnstage, onDiscard, onOpenCommit,
  onEdit = null, onElsewhere, onReveal, onNewWindow,
}) {
  const staged = change?.area === 'staged'
  const destructive = change && change.area !== 'staged' && change.area !== 'conflict'
  return (
    <div className="nx-gw-crail">
      <div className="nx-gw-rail-head">
        <div className="nx-gw-rail-file">{baseOf(path)}</div>
        {dirOf(path) && <div className="nx-gw-rail-dir" title={dirOf(path)}>{dirOf(path)}</div>}
      </div>
      {change && (
        <div className="nx-gw-card nx-gw-statuscard" data-tone={TONE[change.area]}>
          <div className="nx-gw-status-line">
            <span>{statusText(change)}</span>
            {counts && <span className="add">{`+${counts.add}`}</span>}
            {counts && <span className="del">{`−${counts.del}`}</span>}
          </div>
          <div className="nx-gw-status-btns">
            <button className="btn sm" onClick={onViewDiff}>View diff</button>
            {change.area !== 'conflict' && (staged
              ? <button className="btn sm" onClick={() => onUnstage(change)}>Unstage</button>
              : <button className="btn sm" onClick={() => onStage(change)}>Stage</button>)}
            {destructive && <button className="btn sm ghost danger" onClick={() => onDiscard(change)}>{change.area === 'untracked' ? 'Delete…' : 'Discard…'}</button>}
          </div>
        </div>
      )}
      <div className="nx-gw-eyebrow">Recent commits</div>
      {commits === null ? <div className="nx-gw-rail-note">Loading…</div>
        : !commits.length ? <div className="nx-gw-rail-note">No commits yet.</div>
          : (
            <ul className="nx-gw-rail-commits">
              {commits.map(c => (
                <li key={c.oid}>
                  <button type="button" onClick={() => onOpenCommit(c.oid)} title={c.subject}>
                    <span className="subject">{c.subject}</span>
                    <span className="meta"><span className="nx-hash">{c.oid.slice(0, 7)}</span>{` · ${relativeTime(c.when)}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      <div className="nx-gw-spacer-y" />
      {onEdit && <button className="btn accent nx-gw-crail-primary" onClick={onEdit}>Edit here<span className="kbd">Enter</span></button>}
      <button className="btn nx-gw-crail-secondary" onClick={onElsewhere}>{elsewhere.label}</button>
      <div className="nx-gw-rail-pair">
        <button className="btn ghost nx-gw-crail-secondary" onClick={onReveal}>Show in Explorer</button>
        <button className="btn ghost nx-gw-crail-secondary" onClick={onNewWindow}>New window</button>
      </div>
    </div>
  )
}

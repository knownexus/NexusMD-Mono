import React from 'react'
import { PlModal, Icon } from '@nexusmd/ui'
import { parseRefList, checkBranchName, worktreeDefaultPath } from '@nexusmd/core'

const VERB = {
  fetch: 'Fetch', pull: 'Pull', push: 'Push', branch: 'Create branch', checkout: 'Check out', worktreeAdd: 'Add worktree',
  worktreeRemove: 'Remove worktree', stashPush: 'Stash', stashApply: 'Apply', stashPop: 'Pop', stashDrop: 'Drop',
  revert: 'Revert', continue: 'Continue', skip: 'Skip', abort: 'Abort', rebaseInteractive: 'Rebase',
}
const TYPED = { stashDrop: 'DROP' }
const input = { padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)' }
const shortRef = r => r.replace(/^refs\/(heads|remotes)\//, '')

function Commits({ list, label }) {
  if (!list?.length) return null
  return (
    <div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{label}</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, maxHeight: 140, overflow: 'auto' }}>
        {list.map(c => <li key={c.oid}><code>{c.oid}</code>{` ${c.subject}`}</li>)}
      </ul>
    </div>
  )
}

// What will happen, per kind, from the preview's details.
function Details({ kind, details }) {
  if (!details) return null
  if (kind === 'pull') {
    return (
      <div style={{ fontSize: 12 }}>
        <div>{`${details.behind} to bring in, ${details.ahead} of yours (${details.asOf}).`}</div>
        <Commits list={details.incoming} label="Incoming" />
      </div>
    )
  }
  if (kind === 'push') {
    return (
      <div style={{ fontSize: 12 }}>
        <div>{`${details.local} → ${details.remote}/${details.dest}${details.newBranch ? ' (new branch)' : ''}${details.setUpstream ? '; sets the upstream' : ''}`}</div>
        <Commits list={details.commits} label="Commits to push" />
      </div>
    )
  }
  if (kind === 'rebaseInteractive') return <pre style={{ margin: 0, fontSize: 12 }}>{details.todo}</pre>
  const text = details.note ?? (details.subject ? `“${details.subject}”` : null)
  return text ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{text}</div> : null
}

function useRefs(adapter, target, registered, wanted) {
  const [refs, setRefs] = React.useState([])
  React.useEffect(() => {
    if (!wanted || !target) return undefined
    let live = true
    adapter.refs({ name: target.repo, path: target.repoRoot }, target.worktreePath, registered).then(
      r => { if (live) setRefs(parseRefList(r.refs).map(x => x.ref).filter(x => !x.startsWith('refs/tags/'))) },
      () => { if (live) setRefs([]) },
    )
    return () => { live = false }
  }, [adapter, target, registered, wanted])
  return refs
}

// The options each kind takes. Changing one re-previews (on blur or change), so what runs is what was shown.
function Options({ kind, options, onOptions, details, refs, target }) {
  const [draft, setDraft] = React.useState(options)
  React.useEffect(() => { setDraft(options) }, [options])
  const commit = patch => onOptions({ ...options, ...patch })
  const text = (key, label, check) => (
    <label style={{ display: 'grid', gap: 2 }}>
      <span style={{ fontSize: 12 }}>{label}</span>
      <input aria-label={label} style={input} value={draft[key] ?? ''} onChange={e => setDraft({ ...draft, [key]: e.target.value })}
        onBlur={() => { if (draft[key] !== options[key]) commit({ [key]: draft[key] }) }} />
      {check && draft[key] && check(draft[key]) && <span role="note" style={{ color: 'var(--danger)', fontSize: 12 }}>{check(draft[key])}</span>}
    </label>
  )
  const box = (key, label) => (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="checkbox" aria-label={label} checked={!!options[key]} onChange={e => commit({ [key]: e.target.checked })} />{label}
    </label>
  )
  const select = (key, label, values, render = v => v) => (
    <label style={{ display: 'grid', gap: 2 }}>
      <span style={{ fontSize: 12 }}>{label}</span>
      <select aria-label={label} style={input} value={options[key] ?? ''} onChange={e => commit({ [key]: e.target.value || undefined })}>
        <option value="">(choose)</option>
        {values.map(v => <option key={v} value={v}>{render(v)}</option>)}
      </select>
    </label>
  )
  if (kind === 'pull' && !options.batch) {
    return (
      <div role="group" aria-label="Pull mode" style={{ display: 'flex', gap: 6 }}>
        {[['ff', 'Fast-forward'], ['rebase', 'Rebase'], ['merge', 'Merge']].map(([m, label]) => (
          <button key={m} className={`btn sm ${(options.mode ?? 'ff') === m ? '' : 'ghost'}`} aria-pressed={(options.mode ?? 'ff') === m} onClick={() => commit({ mode: m })}>{label}</button>
        ))}
      </div>
    )
  }
  if (kind === 'push') {
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        {select('remote', 'Remote', details?.remotes ?? (options.remote ? [options.remote] : []))}
        {text('dest', 'Remote branch', checkBranchName)}
        {box('setUpstream', 'Set as upstream')}
      </div>
    )
  }
  if (kind === 'branch') {
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        {text('name', 'Branch name', checkBranchName)}
        {options.startLabel ? <div style={{ fontSize: 12 }}>{`Starts at ${options.startLabel}`}</div> : select('start', 'Start from', ['HEAD', ...refs], v => (v === 'HEAD' ? 'HEAD (current commit)' : shortRef(v)))}
        {box('checkout', 'Check it out')}
      </div>
    )
  }
  if (kind === 'checkout' && options.oid === undefined) return select('branch', 'Branch', refs.filter(r => r.startsWith('refs/heads/')), shortRef)
  if (kind === 'worktreeAdd') {
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={{ display: 'grid', gap: 2 }}>
          <span style={{ fontSize: 12 }}>Branch</span>
          <select aria-label="Branch" style={input} value={options.ref ?? ''} onChange={e => {
            const ref = e.target.value
            if (!ref) return
            commit({ ref, path: worktreeDefaultPath(target.repoRoot, shortRef(ref), { remote: ref.startsWith('refs/remotes/') }) })
          }}>
            <option value="">(choose)</option>
            {refs.map(r => <option key={r} value={r}>{shortRef(r)}</option>)}
          </select>
        </label>
        {text('path', 'Folder')}
      </div>
    )
  }
  if (kind === 'stashPush') return <div style={{ display: 'grid', gap: 6 }}>{text('message', 'Message')}{box('includeUntracked', 'Include untracked files')}</div>
  if (kind === 'stashApply' || kind === 'stashPop') return box('index', 'Restore staged changes too')
  if (kind === 'revert' && options.parents > 1) {
    // main wants the parent as a number (git's -m).
    return (
      <label style={{ display: 'grid', gap: 2 }}>
        <span style={{ fontSize: 12 }}>Keep parent</span>
        <select aria-label="Keep parent" style={input} value={String(options.parent ?? 1)} onChange={e => commit({ parent: Number(e.target.value) })}>
          {Array.from({ length: options.parents }, (_, i) => <option key={i} value={String(i + 1)}>{i === 0 ? '1 (main line)' : String(i + 1)}</option>)}
        </select>
      </label>
    )
  }
  return null
}

/** The stage 4 preview: options, what will happen per target, what runs, then per-target results. */
export function ActionDialog({ sync, adapter, registered }) {
  const d = sync.dialog
  const [typed, setTyped] = React.useState('')
  React.useEffect(() => { setTyped('') }, [d?.runId])
  const first = d?.targets?.[0]
  const wantsRefs = !!d && ['branch', 'checkout', 'worktreeAdd'].includes(d.kind)
  const refs = useRefs(adapter, first, registered, wantsRefs)
  if (!d) return null
  const word = TYPED[d.kind]
  const rows = d.model?.rows ?? []
  const runnable = rows.filter(r => r.eligible)
  const done = !!d.results
  const failed = done && Object.values(d.results).some(r => !r.ok)
  const canRun = !d.loading && !d.running && !done && runnable.length > 0 && (!word || typed === word)
  // Options are passed through to main as they are; strip the dialog-only ones.
  const setOptions = o => sync.setOptions(o)
  const footer = done
    ? <>{failed && <button className="btn sm" onClick={() => sync.retryFailed(d.runId)}>Retry failed</button>}<button className="btn sm" onClick={sync.close}>Close</button></>
    : <><button className="btn sm ghost" disabled={d.running} onClick={sync.close}>Cancel</button><button className={`btn sm${word || d.kind === 'abort' ? ' danger' : ''}`} disabled={!canRun} onClick={sync.confirm}>{d.running ? 'Running…' : VERB[d.kind]}</button></>
  return (
    <PlModal open wide onClose={sync.close} title={d.model?.title ?? VERB[d.kind]} icon="git-branch" footer={footer} closeOnBackdrop={!d.running}>
      <div style={{ display: 'grid', gap: 10 }}>
        <Options kind={d.kind} options={d.options} onOptions={setOptions} details={rows[0]?.details} refs={refs} target={first} />
        {d.loading && <div style={{ color: 'var(--text-muted)' }}>Checking the current state…</div>}
        <ul aria-label="Targets" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {rows.map(r => {
            const result = d.results?.[r.id]
            return (
              <li key={r.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <strong style={{ flex: 1 }}>{r.label}</strong>
                  {result ? <span aria-label={result.ok ? 'Succeeded' : 'Failed'} style={{ color: result.ok ? 'var(--success)' : 'var(--danger)' }}>{result.ok ? '✓' : '✗'}</span>
                    : !r.eligible && <span style={{ color: 'var(--text-muted)' }}>skipped</span>}
                </div>
                {!r.eligible && r.reason && <div role="note" style={{ color: 'var(--text-muted)', fontSize: 12 }}>{r.reason}</div>}
                {r.eligible && !result && <Details kind={d.kind} details={r.details} />}
                {r.eligible && r.programs.length > 0 && !result && <div style={{ fontSize: 12 }}>{`Runs: ${r.programs.join(', ')}`}</div>}
                {result && <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, color: result.ok ? 'inherit' : 'var(--danger)' }}>{result.detail}</pre>}
              </li>
            )
          })}
        </ul>
        {d.model?.note && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{d.model.note}</div>}
        {word && !done && (
          <label style={{ display: 'grid', gap: 4 }}>
            {`Type ${word} to confirm`}
            <input aria-label={`Type ${word} to confirm`} value={typed} onChange={e => setTyped(e.target.value)} />
          </label>
        )}
      </div>
    </PlModal>
  )
}

/** The session's actions, newest first, with git's output on expand. Closing hides it until the next entry. */
export function ActivityDrawer({ sync }) {
  const [open, setOpen] = React.useState(false)
  // The newest entry when it was closed; the log is newest first.
  const [closedAt, setClosedAt] = React.useState(null)
  const newest = sync.activity[0]
  if (!newest || newest === closedAt) return null
  const runs = [...new Set(sync.activity.map(e => e.runId))]
  const copy = () => navigator.clipboard?.writeText(sync.activity.map(e => `${new Date(e.at).toLocaleTimeString()} ${e.ok ? '✓' : '✗'} ${e.kind} ${e.label}\n${e.detail}`).join('\n\n')).catch(() => {})
  return (
    <section aria-label="Activity" className="card" style={{ padding: 8, flex: 'none' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn sm ghost" aria-expanded={open} onClick={() => setOpen(o => !o)}>{`Activity (${sync.activity.length})`}</button>
        {open && <button className="btn sm ghost" onClick={copy}>Copy</button>}
        <button className="nx-icon-btn" style={{ marginLeft: 'auto' }} aria-label="Close activity" title="Close" onClick={() => { setOpen(false); setClosedAt(newest) }}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {open && runs.map(runId => {
        const entries = sync.activity.filter(e => e.runId === runId)
        return (
          <div key={runId} style={{ display: 'grid', gap: 2, padding: '4px 0', borderTop: '1px solid var(--border)' }}>
            {entries.map((e, i) => (
              <details key={i}>
                <summary style={{ fontSize: 12 }}>
                  <span style={{ color: e.ok ? 'var(--success)' : 'var(--danger)' }}>{e.ok ? '✓' : '✗'}</span>
                  {` ${new Date(e.at).toLocaleTimeString()} ${VERB[e.kind] ?? e.kind} · ${e.label} - ${e.summary}`}
                </summary>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>{e.detail}</pre>
              </details>
            ))}
            {entries.some(e => !e.ok) && <button className="btn sm ghost" style={{ justifySelf: 'start' }} onClick={() => sync.retryFailed(runId)}>Retry failed</button>}
          </div>
        )
      })}
    </section>
  )
}

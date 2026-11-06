import React from 'react'
import { recordingsAdapter } from './adapters/recordings.js'
import { useRecording, clock } from './use-recording.js'
import { RecordingTree } from './recording-tree.jsx'

const CSS = `
.rp{display:flex;flex-direction:column;gap:10px;padding:8px 16px 12px;border-bottom:1px solid var(--border-subtle,var(--border))}
.rp-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.rp-bar h4{margin:0;font-size:13px}
.rp-label{flex:1 1 200px;min-width:160px;padding:6px 9px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);font-size:13px;color:var(--text)}
.rp-live{display:inline-flex;align-items:center;gap:8px;font-size:13px}
.rp-dot{width:9px;height:9px;border-radius:50%;background:var(--danger);flex:none}
.rp-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.rp-item{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:6px 0;border-top:1px solid var(--border-subtle,var(--border));font-size:13px}
.rp-item:first-child{border-top:0}
.rp-what{flex:1 1 220px;min-width:0}
.rp-what b{font-weight:600}
.rp-sub{display:block;font-size:12px;color:var(--text-muted)}
.rp-acts{display:inline-flex;gap:6px}
.rp-msg{font-size:12.5px;margin:0}
@media (prefers-reduced-motion:no-preference){.rp-dot{animation:rp-pulse 1.4s ease-in-out infinite}}
@keyframes rp-pulse{50%{opacity:.35}}
`

// An error from the main process arrives as "Error invoking remote method 'x': Error: the message".
const plain = (err) => String(err?.message ?? err).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')

const kb = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)
const when = (t) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '')
const NOTE = {
  unfinished: 'The app closed before it finished; what was written is here.',
  capped: 'Stopped at its size limit.',
  unreadable: 'Made by another version of NexusMD, so it cannot be opened here.',
}

function Panel() {
  const { status, elapsedMs, reload } = useRecording()
  const [list, setList] = React.useState(null)
  const [label, setLabel] = React.useState('')
  const [error, setError] = React.useState('')
  const [note, setNote] = React.useState('')
  const [opened, setOpened] = React.useState(null)
  const [confirming, setConfirming] = React.useState(null)

  const refresh = React.useCallback(async () => {
    try { setList((await recordingsAdapter.list()) ?? []) } catch (err) { setError(plain(err)) }
  }, [])
  React.useEffect(() => { refresh() }, [refresh, status.recording])

  const attempt = async (work) => {
    setError(''); setNote('')
    try { return await work() } catch (err) { setError(plain(err)); return undefined }
  }

  const open = (id) => attempt(async () => { setOpened(await recordingsAdapter.read(id)) })
  const record = () => attempt(async () => { await recordingsAdapter.start(label.trim()); setLabel(''); await reload() })
  const stop = () => attempt(async () => {
    const done = await recordingsAdapter.stop()
    await reload(); await refresh()
    if (done?.id) await open(done.id)
  })
  const remove = (id) => attempt(async () => {
    await recordingsAdapter.remove(id)
    setConfirming(null)
    if (opened?.header?.id === id) setOpened(null)
    await refresh()
  })
  const exportOne = (id) => attempt(async () => { if ((await recordingsAdapter.exportTo(id))?.saved) setNote('Saved.') })
  const importOne = () => attempt(async () => { if (await recordingsAdapter.importFile()) await refresh() })

  return (
    <div className="rp">
      <style>{CSS}</style>
      <div className="rp-bar">
        <h4>Recordings</h4>
        {status.recording ? (
          <>
            <span className="rp-live"><span className="rp-dot" aria-hidden /><span>Recording</span><span>{clock(elapsedMs)}</span><span>{`${status.events ?? 0} events`}</span></span>
            <button className="btn sm" onClick={stop}>Stop</button>
          </>
        ) : (
          <>
            <input className="rp-label" aria-label="Recording label" placeholder="What are you about to do? (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <button className="btn sm" onClick={record}>Record</button>
          </>
        )}
        <button className="btn sm ghost" onClick={importOne}>Import recording</button>
      </div>
      <p className="rp-msg" style={{ color: 'var(--text-muted)' }}>Press Record, use the app, then press Stop to see every call that ran, with its values, in order.</p>
      {error && <p role="alert" className="rp-msg" style={{ color: 'var(--danger)' }}>{error}</p>}
      {note && <p role="status" className="rp-msg">{note}</p>}

      {list && list.length === 0 && <p className="rp-msg" style={{ color: 'var(--text-muted)' }}>No recordings yet.</p>}
      {list && list.length > 0 && (
        <ul className="rp-list">
          {list.map((r) => {
            const name = r.label || 'untitled recording'
            return (
              <li key={r.id} className="rp-item">
                <span className="rp-what">
                  <b>{name}</b>
                  <span className="rp-sub">{[when(r.startedAt), r.status !== 'unreadable' ? `${r.events} events` : null, kb(r.bytes ?? 0)].filter(Boolean).join(', ')}</span>
                  {NOTE[r.status] && <span className="rp-sub">{NOTE[r.status]}</span>}
                </span>
                <span className="rp-acts">
                  {r.status !== 'unreadable' && <button className="btn sm" aria-label={`Open ${name}`} onClick={() => open(r.id)}>Open</button>}
                  <button className="btn sm ghost" aria-label={`Export ${name}`} onClick={() => exportOne(r.id)}>Export</button>
                  {confirming === r.id
                    ? <button className="btn sm ghost danger" onClick={() => remove(r.id)}>Delete for good</button>
                    : <button className="btn sm ghost" aria-label={`Delete ${name}`} onClick={() => setConfirming(r.id)}>Delete</button>}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {opened && (
        <div>
          <button className="btn sm ghost" aria-label="Close recording" onClick={() => setOpened(null)}>Close</button>
          <RecordingTree recording={opened} />
        </div>
      )}
    </div>
  )
}

/** The Record control and the saved recordings. Nothing outside the desktop app. */
export function RecordingsPanel() {
  return recordingsAdapter.available() ? <Panel /> : null
}

export default RecordingsPanel

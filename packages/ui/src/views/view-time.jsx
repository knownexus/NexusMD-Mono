import React from 'react'
import { formatClock } from '@nexusmd/core'
import { Icon } from '../icons.jsx'
import {
  emptyLog, runningEntries, startEntry, stopEntry, updateEntry, removeEntry, setTimes, addNote, removeNote, assignRef,
  addMark, updateMark, removeMark, splitPoints, splitAtMarks, assignRefMany,
  durationMs, unionMs, groupByDay, dayLabel, dayKey, weekTotals, totalsByTask, colorSlot, tapeLayout, formatHm, matchTickets,
  toHHMM, withClock, timesError, timelineEvents, timelineMarkdown,
} from './time-log.js'

const { useState, useEffect, useMemo, useRef, useCallback } = React

const clockTime = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const slotVar = ref => { const s = colorSlot(ref); return s < 0 ? 'var(--text-subtle)' : `var(--tl-c${s})` }
const LANE_H = 22

/** useState that survives restarts: the log lives in localStorage under `key` (each shell scopes it to the profile). */
function useStoredLog(key) {
  const [value, setValue] = useState(() => {
    try { const raw = window.localStorage.getItem(key); return raw === null ? emptyLog() : JSON.parse(raw) } catch { return emptyLog() }
  })
  useEffect(() => { try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* quota or private mode */ } }, [key, value])
  return [value, setValue]
}

/** Work items as the tickets the picker offers: { id, title, source }. */
export function ticketsFromWorkItems(items) {
  return (items || []).map(i => ({ id: String(i.key ?? i.id), title: i.title || '', source: i.source || 'ado' }))
}

function useNow(active) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (!active) return undefined
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

function Chip({ task }) {
  return task ? <span className="tl-chip" style={{ '--c': slotVar(task) }}>{task.id}</span> : null
}

/** Type to find a ticket from Work; Enter or a click picks it. */
function TicketSelect({ tickets, onPick, onCancel, autoFocus = true }) {
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const matches = useMemo(() => matchTickets(tickets, text), [tickets, text])
  const key = e => {
    if (e.key === 'ArrowDown' && matches.length) { e.preventDefault(); setActive(a => (a + 1) % matches.length) }
    else if (e.key === 'ArrowUp' && matches.length) { e.preventDefault(); setActive(a => (a - 1 + matches.length) % matches.length) }
    else if (e.key === 'Enter' && matches[active]) { e.preventDefault(); onPick(matches[active]) }
    else if (e.key === 'Escape') onCancel?.()
  }
  return (
    <div className="tl-select">
      <input className="tl-edit" value={text} autoFocus={autoFocus} placeholder="Find a ticket by id or title" aria-label="Find a ticket"
        role="combobox" aria-expanded={matches.length > 0} aria-controls="tl-pick-list" autoComplete="off"
        onChange={e => { setText(e.target.value); setActive(0) }} onKeyDown={key}/>
      {matches.length > 0 && (
        <ul className="tl-suggest" id="tl-pick-list" role="listbox">
          {matches.map((t, i) => (
            <li key={t.id} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
              onMouseDown={e => { e.preventDefault(); onPick(t) }} onMouseEnter={() => setActive(i)}>
              <Chip task={t}/><span className="tl-suggest-title">{t.title}</span>
            </li>
          ))}
        </ul>
      )}
      {text.trim() && matches.length === 0 && (
        <div className="tl-hint-box">{tickets.length ? 'No ticket matches that.' : 'No tickets to pick from. They come from Work items once that is connected.'}</div>
      )}
    </div>
  )
}

/** One field to say what you are doing, with an optional note before you begin. */
function Starter({ tickets, recent, onStart }) {
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [picked, setPicked] = useState(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const matches = useMemo(() => (picked ? [] : matchTickets(tickets, text)), [tickets, text, picked])
  const listOpen = open && matches.length > 0

  const begin = (ref, label, withNote = note) => {
    onStart({ ref, label, note: withNote })
    setText(''); setNote(''); setNoteOpen(false); setPicked(null); setOpen(false); setActive(0)
  }
  const pick = t => { setPicked(t); setText(t.title); setOpen(false) }

  const onKeyDown = e => {
    if (e.key === 'ArrowDown' && matches.length) { e.preventDefault(); setOpen(true); setActive(a => (a + 1) % matches.length) }
    else if (e.key === 'ArrowUp' && matches.length) { e.preventDefault(); setActive(a => (a - 1 + matches.length) % matches.length) }
    else if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (listOpen) pick(matches[active])
      else if (picked) begin(picked, text)
      else if (text.trim()) begin(null, text)
    }
  }

  const canStart = !!picked || !!text.trim()
  return (
    <div className="tl-starter">
      <div className="tl-field">
        {picked && <Chip task={picked}/>}
        <input
          className="tl-input" value={text} placeholder="What are you working on?"
          aria-label="What are you working on" role="combobox" aria-expanded={listOpen} aria-controls="tl-suggest"
          aria-activedescendant={listOpen ? `tl-opt-${active}` : undefined} autoComplete="off"
          onChange={e => { setText(e.target.value); setPicked(null); setOpen(true); setActive(0) }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={onKeyDown}/>
        <button className="btn ghost sm" onClick={() => setNoteOpen(o => !o)} aria-expanded={noteOpen}>
          <Icon name="doc" size={12}/> Note
        </button>
        <button className="btn primary" disabled={!canStart} onClick={() => begin(picked, text)}>
          <Icon name="play" size={12}/> Start
        </button>
        {listOpen && (
          <ul className="tl-suggest" id="tl-suggest" role="listbox">
            {matches.map((t, i) => (
              <li key={t.id} id={`tl-opt-${i}`} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
                onMouseDown={e => { e.preventDefault(); pick(t) }} onMouseEnter={() => setActive(i)}>
                <Chip task={t}/><span className="tl-suggest-title">{t.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {noteOpen && (
        <input className="tl-edit tl-note-start" value={note} autoFocus placeholder="A note for the start: the plan, who asked" aria-label="Note before starting"
          onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && canStart) begin(picked, text) }}/>
      )}
      {recent.length > 0 && (
        <div className="tl-recent" aria-label="Recent">
          <span className="tl-muted">Recent</span>
          {recent.map(r => (
            <button key={r.key} className="tl-recent-btn" onClick={() => begin(r.ref, r.label, '')} title={`Start ${r.label}`}>
              <span className="tl-dot" style={{ background: slotVar(r.ref) }}/>{r.ref ? r.ref.id : r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NoteList({ entry, onRemove }) {
  if (!entry.notes?.length) return null
  return (
    <ul className="tl-notes">
      {entry.notes.map(n => (
        <li key={n.id}>
          <span className="tl-num tl-note-at">{clockTime(n.at)}</span>
          <span className="tl-note-text">{n.text}</span>
          <button className="tl-icon tl-note-x" aria-label={`Delete note: ${n.text}`} title="Delete note" onClick={() => onRemove(entry.id, n.id)}><Icon name="x" size={11}/></button>
        </li>
      ))}
    </ul>
  )
}

/** Marks on an entry: a point in time with an optional note. Finished entries can be cut at them. */
function MarkList({ entry, onNote, onRemove, onSplit }) {
  const [editing, setEditing] = useState(null)
  const marks = entry.marks || []
  const cuts = splitPoints(entry).length
  if (!marks.length) return null
  return (
    <div className="tl-marks">
      <ul className="tl-notes">
        {marks.map(m => (
          <li key={m.id} className="tl-mark-item">
            <span className="tl-num tl-note-at"><i className="tl-diamond" aria-hidden="true"/>{clockTime(m.at)}</span>
            {editing === m.id || !m.note
              ? (
                <input className="tl-edit tl-mark-input" defaultValue={m.note} placeholder="Note for this mark" aria-label={`Note for the mark at ${clockTime(m.at)}`}
                  autoFocus={editing === m.id}
                  onBlur={e => { onNote(entry.id, m.id, e.target.value); setEditing(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = m.note; e.currentTarget.blur() } }}/>
              )
              : <button className="tl-note-text tl-note-btn" title="Edit note" onClick={() => setEditing(m.id)}>{m.note}</button>}
            <button className="tl-icon tl-note-x" aria-label={`Delete mark at ${clockTime(m.at)}`} title="Delete mark" onClick={() => onRemove(entry.id, m.id)}><Icon name="x" size={11}/></button>
          </li>
        ))}
      </ul>
      {onSplit && cuts > 0 && (
        <button className="btn sm" onClick={() => onSplit(entry.id)}>
          <Icon name="flag" size={12}/> Split into {cuts + 1} entries
        </button>
      )}
    </div>
  )
}

/** Adds a mark to a finished entry at a time you choose, for a moment you forgot to mark live. */
function MarkAt({ entry, now, onAdd, onDone }) {
  const [time, setTime] = useState(toHHMM(entry.start))
  const [note, setNote] = useState('')
  const at = withClock(entry.start, time)
  const bad = at == null || at <= entry.start || at >= (entry.end ?? now)
  const submit = () => { if (!bad) { onAdd(entry.id, at, note); onDone() } }
  return (
    <div className="tl-markat">
      <label className="tl-tfield">Mark at
        <input type="time" className="tl-edit tl-num" value={time} aria-label="Mark time" onChange={e => setTime(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }}/>
      </label>
      <label className="tl-tfield tl-grow">Note
        <input className="tl-edit" value={note} placeholder="Optional" aria-label="Mark note" onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); else if (e.key === 'Escape') onDone() }}/>
      </label>
      <button className="btn sm primary" onClick={submit} disabled={bad}>Add mark</button>
      <button className="btn sm ghost" onClick={onDone}>Cancel</button>
      {bad && <span className="tl-hint-box">Pick a time between {clockTime(entry.start)} and {entry.end ? clockTime(entry.end) : 'now'}.</span>}
    </div>
  )
}

function NoteInput({ onAdd, onDone, placeholder = 'Add a note' }) {
  const [text, setText] = useState('')
  const submit = () => { if (text.trim()) { onAdd(text); setText('') } }
  return (
    <input className="tl-edit" value={text} placeholder={placeholder} aria-label="Add a note" autoFocus={!!onDone}
      onChange={e => setText(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') { submit(); onDone?.() } else if (e.key === 'Escape') onDone?.() }}
      onBlur={() => { submit(); onDone?.() }}/>
  )
}

/** Every timer that is running, each with its own clock, a quick note and its own Stop. */
function RunningPanel({ running, now, onStop, onNote, onRemoveNote, onMark, onMarkNote, onRemoveMark }) {
  if (running.length === 0) {
    return (
      <section className="tl-running idle" aria-label="Running">
        <div className="tl-now-title">Nothing running</div>
        <div className="tl-now-sub">Start a timer below. You can run several at once, and they keep counting while the app is closed.</div>
      </section>
    )
  }
  return (
    <section className="tl-running" aria-label="Running">
      {running.map(e => (
        <div key={e.id} className="tl-run">
          <div className="tl-run-main">
            <div className="tl-now-title"><span className="tl-pulse" aria-hidden="true"/><Chip task={e.ref}/><span>{e.label}</span></div>
            <div className="tl-now-sub">Started {clockTime(e.start)}</div>
          </div>
          <div className="tl-clock tl-num" role="timer" aria-label={`Elapsed time for ${e.label}`}>{formatClock(durationMs(e, now))}</div>
          <span className="tl-run-btns">
            <button className="btn tl-markbtn" onClick={() => onMark(e.id)} aria-label={`Mark now on ${e.label}`} title="Drop a mark at this moment"><Icon name="flag" size={12}/> Mark</button>
            <button className="btn tl-stop" onClick={() => onStop(e.id)} aria-label={`Stop ${e.label}`}><Icon name="x" size={12}/> Stop</button>
          </span>
          <div className="tl-run-notes">
            <MarkList entry={e} onNote={onMarkNote} onRemove={onRemoveMark}/>
            <NoteList entry={e} onRemove={onRemoveNote}/>
            <NoteInput onAdd={t => onNote(e.id, t)}/>
          </div>
        </div>
      ))}
    </section>
  )
}

function DayTape({ entries, dayKeyStr, now }) {
  const tape = useMemo(() => tapeLayout(entries, dayKeyStr, now), [entries, dayKeyStr, now])
  const day = entries.filter(e => dayKey(e.start) === dayKeyStr)
  const total = day.reduce((a, e) => a + durationMs(e, now), 0)
  const elapsed = unionMs(day, now)
  const trackH = tape.lanes * LANE_H + 12
  return (
    <section className="tl-tape" aria-label={`${dayLabel(dayKeyStr, now)} on the clock`}>
      <div className="tl-tape-head">
        <h2>{dayLabel(dayKeyStr, now)}</h2>
        <span className="tl-num">{formatHm(total)}{elapsed < total - 60000 ? ` over ${formatHm(elapsed)}` : ''}</span>
      </div>
      <div className="tl-ruler" role="img" aria-label={`${formatHm(total)} logged between ${tape.from}:00 and ${tape.to}:00`}>
        {tape.ticks.map(t => <span key={t.hour} className="tl-tick" style={{ left: `${t.left}%` }}><i style={{ height: trackH + 6 }}/>{String(t.hour).padStart(2, '0')}</span>)}
        <div className="tl-track" style={{ height: trackH }}>
          {tape.segments.map(s => (
            <span key={s.entry.id} className={`tl-seg${s.entry.end == null ? ' live' : ''}`}
              style={{ left: `${s.left}%`, width: `${s.width}%`, top: 6 + s.lane * LANE_H, height: LANE_H - 4, background: slotVar(s.entry.ref) }}
              title={`${s.entry.label} · ${clockTime(s.entry.start)}–${s.entry.end ? clockTime(s.entry.end) : 'now'} · ${formatHm(durationMs(s.entry, now))}`}/>
          ))}
          {tape.marks.map(m => (
            <span key={m.id} className="tl-pin" style={{ left: `${m.left}%`, top: 6 + m.lane * LANE_H, height: LANE_H - 4 }}
              title={`Mark ${m.note ? `· ${m.note}` : ''}`}/>
          ))}
          {tape.nowLeft != null && <span className="tl-now" style={{ left: `${tape.nowLeft}%` }}/>}
        </div>
      </div>
    </section>
  )
}

function EntryRow({
  entry, now, tickets, editing, selected, onSelect, onEdit, onDone, onSave, onContinue, onDelete, onNote, onRemoveNote, onAssign,
  onAddMark, onMarkNote, onRemoveMark, onSplit,
}) {
  const [label, setLabel] = useState(entry.label)
  const [refDraft, setRefDraft] = useState(entry.ref)
  const [changingRef, setChangingRef] = useState(false)
  const [startText, setStartText] = useState(toHHMM(entry.start))
  const [endText, setEndText] = useState(entry.end != null ? toHHMM(entry.end) : '')
  const [breakText, setBreakText] = useState(String(Math.round((entry.breakMs || 0) / 60000)))
  const [panel, setPanel] = useState(null) // 'note' | 'ticket' | 'mark'
  const [open, setOpen] = useState(false) // narrow screens: show every action, not just the main one

  const isLive = entry.end == null
  const next = {
    start: withClock(entry.start, startText),
    end: isLive ? null : withClock(entry.start, endText),
    breakMs: /^\d+$/.test(breakText.trim() || '0') ? Number(breakText.trim() || 0) * 60000 : -1,
  }
  const error = next.start == null || (!isLive && next.end == null) ? 'Enter times like 09:15.' : timesError(next, now)
  const commit = () => { if (!error) onSave(entry.id, label.trim() || entry.label, next, refDraft) }
  const key = e => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') onDone() }
  // Quick fixes: move one end of the entry by 5 minutes; typing handles the bigger jumps.
  const nudge = (which, min) => {
    const cur = withClock(entry.start, which === 'start' ? startText : endText)
    if (cur == null) return
    const v = toHHMM(cur + min * 60000)
    which === 'start' ? setStartText(v) : setEndText(v)
  }

  if (editing) {
    return (
      <li className="tl-row editing">
        <span className="tl-dot" style={{ background: slotVar(refDraft) }}/>
        <div className="tl-what"><Chip task={refDraft}/>
          <input className="tl-edit" value={label} aria-label="Entry name" autoFocus onChange={e => setLabel(e.target.value)} onKeyDown={key}/>
        </div>
        <div className="tl-edit-times">
          <div className="tl-tfield">Ticket
            {changingRef
              ? <TicketSelect tickets={tickets} onPick={t => { setRefDraft(t); setChangingRef(false) }} onCancel={() => setChangingRef(false)}/>
              : (
                <span className="tl-refline">
                  <span>{refDraft ? refDraft.id : 'None'}</span>
                  <button type="button" className="tl-link" onClick={() => setChangingRef(true)}>{refDraft ? 'Change' : 'Assign'}</button>
                  {refDraft && <button type="button" className="tl-link" onClick={() => setRefDraft(null)}>Remove</button>}
                </span>
              )}
          </div>
          <label className="tl-tfield">Started
            <span className="tl-nudge">
              <button type="button" aria-label="Start 5 minutes earlier" onClick={() => nudge('start', -5)}>−5</button>
              <input type="time" className="tl-edit tl-num" value={startText} onChange={e => setStartText(e.target.value)} onKeyDown={key}/>
              <button type="button" aria-label="Start 5 minutes later" onClick={() => nudge('start', 5)}>+5</button>
            </span>
          </label>
          {isLive
            ? <span className="tl-tfield">Ended<span className="tl-muted tl-running-note">still running</span></span>
            : (
              <label className="tl-tfield">Ended
                <span className="tl-nudge">
                  <button type="button" aria-label="End 5 minutes earlier" onClick={() => nudge('end', -5)}>−5</button>
                  <input type="time" className="tl-edit tl-num" value={endText} onChange={e => setEndText(e.target.value)} onKeyDown={key}/>
                  <button type="button" aria-label="End 5 minutes later" onClick={() => nudge('end', 5)}>+5</button>
                </span>
              </label>
            )}
          <label className="tl-tfield">Break (min)
            <input className="tl-edit tl-num tl-break" inputMode="numeric" value={breakText} aria-label="Break in minutes"
              onChange={e => setBreakText(e.target.value)} onKeyDown={key}/>
          </label>
          <span className="tl-tfield">Counts as
            <span className="tl-num tl-counts">{error ? '–' : formatHm(durationMs({ ...next, end: next.end ?? now }, now))}</span>
          </span>
        </div>
        <span className="tl-actions on">
          <button className="btn sm primary" onClick={commit} disabled={!!error}>Save</button>
          <button className="btn sm ghost" onClick={onDone}>Cancel</button>
        </span>
        {error && <span className="tl-hint" role="alert">{error}</span>}
      </li>
    )
  }
  return (
    <li className={`tl-row${isLive ? ' live' : ''}${selected ? ' selected' : ''}${open ? ' open' : ''}`}>
      <input type="checkbox" className="tl-check" checked={!!selected} onChange={() => onSelect(entry.id)} aria-label={`Select ${entry.label}`}/>
      <span className="tl-dot" style={{ background: slotVar(entry.ref) }}/>
      <div className="tl-what">
        {entry.ref ? <Chip task={entry.ref}/> : <button className="tl-assign" onClick={() => setPanel(p => (p === 'ticket' ? null : 'ticket'))}>Assign ticket</button>}
        <span className="tl-label">{entry.label}</span>
      </div>
      <span className="tl-range tl-num">{clockTime(entry.start)}–{isLive ? 'now' : clockTime(entry.end)}{entry.breakMs ? ` · −${Math.round(entry.breakMs / 60000)}m break` : ''}</span>
      <span className="tl-dur tl-num">{formatHm(durationMs(entry, now))}</span>
      <span className="tl-actions">
        {!isLive && <button className="tl-icon" aria-label={`Continue ${entry.label}`} title="Continue" onClick={() => onContinue(entry)}><Icon name="play" size={12}/></button>}
        <button className="tl-icon tl-secondary" aria-label={`Add note to ${entry.label}`} title="Add note" onClick={() => setPanel(p => (p === 'note' ? null : 'note'))}><Icon name="doc" size={13}/></button>
        {!isLive && <button className="tl-icon tl-secondary" aria-label={`Add mark to ${entry.label}`} title="Add mark" onClick={() => setPanel(p => (p === 'mark' ? null : 'mark'))}><Icon name="flag" size={13}/></button>}
        <button className="tl-icon tl-secondary" aria-label={`Change ticket for ${entry.label}`} title={entry.ref ? 'Change ticket' : 'Assign ticket'} onClick={() => setPanel(p => (p === 'ticket' ? null : 'ticket'))}><Icon name="link" size={13}/></button>
        <button className="tl-icon tl-secondary" aria-label={`Edit ${entry.label}`} title="Edit times" onClick={() => onEdit(entry.id)}><Icon name="edit" size={13}/></button>
        <button className="tl-icon tl-secondary" aria-label={`Delete ${entry.label}`} title="Delete" onClick={() => onDelete(entry.id)}><Icon name="trash" size={13}/></button>
        <button className="tl-icon tl-more" aria-label={`More actions for ${entry.label}`} aria-expanded={open} title="More" onClick={() => setOpen(o => !o)}><Icon name="more" size={16}/></button>
      </span>
      {(entry.notes?.length > 0 || entry.marks?.length > 0 || panel) && (
        <div className="tl-row-extra">
          <MarkList entry={entry} onNote={onMarkNote} onRemove={onRemoveMark} onSplit={onSplit}/>
          <NoteList entry={entry} onRemove={onRemoveNote}/>
          {panel === 'mark' && <MarkAt entry={entry} now={now} onAdd={onAddMark} onDone={() => setPanel(null)}/>}
          {panel === 'note' && <NoteInput onAdd={t => onNote(entry.id, t)} onDone={() => setPanel(null)}/>}
          {panel === 'ticket' && <TicketSelect tickets={tickets} onPick={t => { onAssign(entry.id, t); setPanel(null) }} onCancel={() => setPanel(null)}/>}
        </div>
      )}
    </li>
  )
}

function Timeline({ entries, dayKeyStr, now }) {
  const [copied, setCopied] = useState(false)
  const events = useMemo(() => timelineEvents(entries, dayKeyStr, now), [entries, dayKeyStr, now])
  const lanes = useMemo(() => {
    const t = tapeLayout(entries, dayKeyStr, now)
    return new Map(t.segments.map(s => [s.entry.id, s.lane]))
  }, [entries, dayKeyStr, now])
  const copy = async () => {
    try { await navigator.clipboard.writeText(timelineMarkdown(entries, dayKeyStr, now)); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { setCopied(false) }
  }
  if (events.length === 0) {
    return <div className="tl-empty"><strong>Nothing on {dayLabel(dayKeyStr, now).toLowerCase()}'s timeline.</strong><p>Start a timer and it appears here with your notes, in the order things happened.</p></div>
  }
  return (
    <div className="tl-timeline">
      <div className="tl-tl-head">
        <h3>{dayLabel(dayKeyStr, now)}, in order</h3>
        <button className="btn sm" onClick={copy}><Icon name="doc" size={12}/> {copied ? 'Copied' : 'Copy as markdown'}</button>
      </div>
      <ol className="tl-events">
        {events.map((ev, i) => {
          const e = ev.entry
          return (
            <li key={`${e.id}-${ev.kind}-${ev.note?.id || i}`} className={`tl-ev ${ev.kind}`} style={{ '--lane': lanes.get(e.id) || 0 }}>
              <span className="tl-num tl-ev-at">{clockTime(ev.at)}</span>
              <span className="tl-ev-mark" style={{ '--c': slotVar(e.ref) }} aria-hidden="true"/>
              <span className="tl-ev-body">
                {ev.kind === 'note'
                  ? <><span className="tl-ev-note">{ev.note.text}</span><span className="tl-muted"> on {e.ref ? e.ref.id : e.label}</span></>
                  : ev.kind === 'mark'
                    ? <><span className="tl-ev-verb">Mark</span>{ev.mark.note && <span className="tl-ev-note">{ev.mark.note}</span>}<span className="tl-muted"> on {e.ref ? e.ref.id : e.label}</span></>
                  : <><span className="tl-ev-verb">{ev.kind === 'start' ? 'Started' : 'Stopped'}</span> <Chip task={e.ref}/> <span>{e.label}</span>
                    {ev.kind === 'stop' && <span className="tl-muted tl-num">{formatHm(durationMs(e, now))}</span>}</>}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function WeekPanel({ entries, now, selected, onSelect }) {
  const days = useMemo(() => weekTotals(entries, now), [entries, now])
  const max = Math.max(1, ...days.map(d => d.totalMs), 8 * 3600000)
  const weekKeys = new Set(days.map(d => d.key))
  const tasks = useMemo(() => totalsByTask(entries.filter(e => weekKeys.has(dayKey(e.start))), now).slice(0, 6), [entries, now]) // eslint-disable-line react-hooks/exhaustive-deps
  const week = days.reduce((a, d) => a + d.totalMs, 0)
  const top = tasks[0]?.totalMs || 1
  return (
    <aside className="tl-week" aria-label="This week">
      <div className="tl-tape-head"><h2>This week</h2><span className="tl-num">{formatHm(week)}</span></div>
      <div className="tl-bars">
        {days.map(d => (
          <button key={d.key} className={`tl-bar${d.key === selected ? ' on' : ''}${d.key === dayKey(now) ? ' today' : ''}`}
            onClick={() => onSelect(d.key)} aria-label={`${d.label}: ${formatHm(d.totalMs)}`} aria-pressed={d.key === selected}>
            <span className="tl-bar-fill" style={{ height: `${Math.max((d.totalMs / max) * 100, d.totalMs ? 3 : 0)}%` }}/>
            <span className="tl-bar-day">{d.label}</span>
          </button>
        ))}
      </div>
      {tasks.length > 0 && (
        <ul className="tl-tasks">
          {tasks.map(t => (
            <li key={t.key}>
              <span className="tl-tasks-name"><span className="tl-dot" style={{ background: slotVar(t.ref) }}/>{t.ref && <Chip task={t.ref}/>}<span className="tl-label">{t.label}</span></span>
              <span className="tl-num">{formatHm(t.totalMs)}</span>
              <span className="tl-tasks-bar"><i style={{ width: `${(t.totalMs / top) * 100}%`, background: slotVar(t.ref) }}/></span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

/**
 * Time tracking: several timers at once, notes, marks, a day tape and timeline.
 * @param {{ storageKey: string, getTickets?: () => Array<{id: string, title: string, source?: string}> }} props
 */
export function TimeView({ storageKey, getTickets }) {
  const [log, setLog] = useStoredLog(storageKey)
  const running = useMemo(() => runningEntries(log), [log])
  const now = useNow(running.length > 0)
  const [tickets, setTickets] = useState([])
  const [editing, setEditing] = useState(null)
  const [undo, setUndo] = useState(null)
  const [pickedDay, setPickedDay] = useState(null)
  const [tab, setTab] = useState('log')
  const [selected, setSelected] = useState(() => new Set())
  const [bulkPick, setBulkPick] = useState(false)
  const undoTimer = useRef(null)

  useEffect(() => {
    try { setTickets(getTickets ? getTickets() || [] : []) } catch { setTickets([]) }
  }, [getTickets, running.length])
  useEffect(() => () => clearTimeout(undoTimer.current), [])

  const start = useCallback(({ ref, label, note }) => setLog(l => startEntry(l, { ref, label, note }, Date.now())), [setLog])
  const stop = id => setLog(l => stopEntry(l, id, Date.now()))
  const note = (id, text) => setLog(l => addNote(l, id, text, Date.now()))
  const dropNote = (id, noteId) => setLog(l => removeNote(l, id, noteId))
  const assign = (id, ref) => setLog(l => assignRef(l, id, ref))
  const save = (id, label, times, ref) => {
    setLog(l => setTimes(assignRef(updateEntry(l, id, { label }), id, ref), id, times))
    setEditing(null)
  }
  // Changes that are hard to see go wrong in: offer to put the log back for a few seconds.
  const withUndo = (message, change) => {
    setUndo({ log, message }); change(); setEditing(null)
    clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setUndo(null), 8000)
  }
  const del = id => withUndo('Entry deleted.', () => setLog(l => removeEntry(l, id)))
  const split = id => withUndo('Entry split at its marks.', () => setLog(l => splitAtMarks(l, id)))

  const mark = id => setLog(l => addMark(l, id, Date.now(), '', Date.now()))
  const markAt = (id, at, text) => setLog(l => addMark(l, id, at, text, Date.now()))
  const markNote = (id, markId, text) => setLog(l => updateMark(l, id, markId, text))
  const dropMark = (id, markId) => setLog(l => removeMark(l, id, markId))

  const toggleSelected = id => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const clearSelected = () => { setSelected(new Set()); setBulkPick(false) }
  const assignSelected = ref => {
    const ids = [...selected]
    withUndo(`${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} assigned to ${ref.id}.`, () => setLog(l => assignRefMany(l, ids, ref)))
    clearSelected()
  }

  const days = useMemo(() => groupByDay(log.entries, now), [log.entries, now])
  const today = dayKey(now)
  const tapeDay = pickedDay || today
  const recent = useMemo(() => {
    const seen = new Map()
    for (const e of [...log.entries].sort((a, b) => b.start - a.start)) {
      const k = e.ref ? `ref:${e.ref.id}` : `label:${e.label}`
      if (!seen.has(k) && e.end != null) seen.set(k, { key: k, ref: e.ref, label: e.label })
      if (seen.size >= 5) break
    }
    return [...seen.values()]
  }, [log.entries])

  return (
    <div className="tl-page">
      <RunningPanel running={running} now={now} onStop={stop} onNote={note} onRemoveNote={dropNote}
        onMark={mark} onMarkNote={markNote} onRemoveMark={dropMark}/>

      <Starter tickets={tickets} recent={recent} onStart={start}/>

      <DayTape entries={log.entries} dayKeyStr={tapeDay} now={now}/>

      <div className="tl-cols">
        <section className="tl-log" aria-label="Time entries">
          <div className="tl-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Entries</button>
            <button role="tab" aria-selected={tab === 'timeline'} className={tab === 'timeline' ? 'on' : ''} onClick={() => setTab('timeline')}>Timeline</button>
          </div>
          {tab === 'log' && selected.size > 0 && (
            <div className="tl-bulk" role="region" aria-label="Selected entries">
              <span><strong>{selected.size}</strong> selected · <span className="tl-num">{formatHm(log.entries.filter(e => selected.has(e.id)).reduce((a, e) => a + durationMs(e, now), 0))}</span></span>
              {bulkPick
                ? <TicketSelect tickets={tickets} onPick={assignSelected} onCancel={() => setBulkPick(false)}/>
                : <button className="btn sm primary" onClick={() => setBulkPick(true)}><Icon name="link" size={12}/> Assign to ticket</button>}
              <button className="btn sm ghost" onClick={clearSelected}>Clear</button>
            </div>
          )}
          {tab === 'timeline' ? <Timeline entries={log.entries} dayKeyStr={tapeDay} now={now}/>
            : days.length === 0 ? (
              <div className="tl-empty">
                <strong>No time logged yet.</strong>
                <p>Pick a ticket or type what you are doing above, then press Enter. Stopping a timer saves the entry here.</p>
              </div>
            ) : days.map(g => {
              const elapsed = unionMs(g.entries, now)
              return (
                <div key={g.key} className="tl-day">
                  <div className="tl-day-head">
                    <h3>{dayLabel(g.key, now)}</h3>
                    <span className="tl-num">{formatHm(g.totalMs)}{elapsed < g.totalMs - 60000 ? ` · ${formatHm(elapsed)} elapsed` : ''}</span>
                  </div>
                  <ul className="tl-rows">
                    {g.entries.map(e => (
                      <EntryRow key={e.id + (editing === e.id ? ':e' : '')} entry={e} now={now} tickets={tickets} editing={editing === e.id}
                        onEdit={setEditing} onDone={() => setEditing(null)} onSave={save} onDelete={del}
                        selected={selected.has(e.id)} onSelect={toggleSelected}
                        onNote={note} onRemoveNote={dropNote} onAssign={assign}
                        onAddMark={markAt} onMarkNote={markNote} onRemoveMark={dropMark} onSplit={split}
                        onContinue={en => start({ ref: en.ref, label: en.label })}/>
                    ))}
                  </ul>
                </div>
              )
            })}
        </section>
        <WeekPanel entries={log.entries} now={now} selected={tapeDay} onSelect={k => setPickedDay(k === today ? null : k)}/>
      </div>

      {undo && (
        <div className="tl-undo" role="status">
          {undo.message}
          <button className="btn sm" onClick={() => { setLog(undo.log); setUndo(null) }}>Undo</button>
        </div>
      )}
    </div>
  )
}

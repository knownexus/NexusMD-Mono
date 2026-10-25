import React from 'react'
import { conflictSides } from './conflict-sides.js'

const baseName = p => String(p ?? '').split('/').pop()

/**
 * The short pill for the resolve header saying what kind of non-text conflict this is (or null):
 * "deleted upstream" when the incoming side deleted the file, and so on.
 */
export function nonTextPill({ kind, labels, op = null, binary = false, symlink = false, missing = false }) {
  const sides = conflictSides(labels, op)
  if (kind === 'deleted-by-left' || kind === 'deleted-by-right') {
    const gone = sides[kind === 'deleted-by-left' ? 'left' : 'right']
    return { text: gone.role === 'mine' ? 'deleted by you' : 'deleted upstream', tone: 'bad' }
  }
  if (kind === 'both-deleted') return { text: 'deleted on both sides', tone: 'bad' }
  if (binary) return { text: 'binary', tone: 'warn' }
  if (symlink) return { text: 'symbolic link', tone: 'warn' }
  if (missing) return { text: 'missing', tone: 'warn' }
  if (kind === 'added-by-left' || kind === 'added-by-right') return { text: 'added on one side', tone: 'warn' }
  return null
}

/**
 * A conflict that can't be merged line by line: one side deleted the file, both did, or it is binary
 * or a symbolic link, or its working file is missing. Says what happened by meaning, and offers the
 * whole-file choices as big option cards (incoming `--info`, yours `--violet`); choosing one and then
 * Mark resolved calls `onTake` with 'left' | 'right' | 'delete'. `hasNext` says the button goes on to
 * the next conflicted file.
 */
export function NonTextConflict({ kind, labels, op = null, binary = false, symlink = false, missing = false, path = 'This file', onTake, busy = false, hasNext = false }) {
  const sides = conflictSides(labels, op)
  const { left, right } = sides
  const name = baseName(path)
  const short = s => (s.role === 'mine' ? 'Yours' : 'Incoming')
  const [choice, setChoice] = React.useState(null)
  let sentence
  let options
  if (kind === 'deleted-by-left' || kind === 'deleted-by-right') {
    const [gone, kept] = kind === 'deleted-by-left' ? [left, right] : [right, left]
    sentence = `${gone.title} deleted this file; ${kept.title} changed it. There's no text to merge: choose whether the file survives.`
    options = [
      { take: kept.key, role: kept.role, kicker: short(kept), title: 'Keep the file', desc: `Keeps ${kept.role === 'mine' ? `your changed ${name}` : `${kept.version} of ${name}`}.` },
      { take: 'delete', role: gone.role, kicker: short(gone), title: 'Accept the deletion', desc: `Removes ${name}${kept.role === 'mine' ? ' and drops your changes to it' : ''}.` },
    ]
  } else if (kind === 'both-deleted') {
    sentence = 'Both sides deleted this file.'
    options = [{ take: 'delete', role: 'both', kicker: 'Both sides', title: 'Accept the deletion', desc: `Removes ${name}.` }]
  } else {
    sentence = binary ? "This is a binary file, so it can't be merged line by line. Use one version or the other."
      : symlink ? "This is a symbolic link, so it can't be merged line by line. Use one version or the other."
      : missing && (kind === 'both-modified' || kind === 'both-added') ? `${path} is missing from the folder, so there is nothing to merge line by line. Use one version or the other.`
      : kind === 'added-by-left' ? `${left.title} added this file. Use one version or the other.`
      : kind === 'added-by-right' ? `${right.title} added this file. Use one version or the other.`
      : "This file can't be merged line by line. Use one version or the other."
    options = [left, right].map(s => ({ take: s.key, role: s.role, kicker: short(s), title: `Use ${s.version}`, desc: `Keeps ${s.title}'s file as it is.` }))
  }
  const id = React.useId()
  const resolveLabel = hasNext ? 'Mark resolved & next' : 'Mark resolved'
  return (
    <div className="nx-resolve-whole">
      <p className="nx-resolve-explain">{sentence}</p>
      <div className="nx-resolve-options">
        {options.map((o, i) => (
          <button key={o.take} type="button" className="nx-resolve-option" data-role={o.role} aria-pressed={choice === o.take}
            aria-label={o.title} aria-describedby={`${id}-${i}`} disabled={busy} onClick={() => setChoice(o.take)}>
            <span className="kicker" aria-hidden="true">{o.kicker}</span>
            <span className="title" aria-hidden="true">{o.title}</span>
            <span className="desc" id={`${id}-${i}`}>{o.desc}</span>
          </button>
        ))}
      </div>
      <div className="nx-resolve-actions">
        <button className="btn accent" disabled={busy || !choice} title={choice ? undefined : 'Choose what happens to the file first'}
          onClick={() => onTake(choice)}>{resolveLabel}</button>
      </div>
    </div>
  )
}

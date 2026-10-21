import React from 'react'

/**
 * A conflict that can't be merged line by line: one side deleted the file, both did, or it is binary
 * or a symbolic link, or its working file is missing. Says what happened by meaning, and offers the whole-file choices; `onTake` gets
 * 'left' | 'right' | 'delete'.
 */
export function NonTextConflict({ kind, labels, binary = false, symlink = false, missing = false, path = 'This file', onTake, busy = false }) {
  const { left, right } = labels
  let sentence
  let choices
  if (kind === 'deleted-by-left' || kind === 'deleted-by-right') {
    const [gone, kept, side] = kind === 'deleted-by-left' ? [left, right, 'right'] : [right, left, 'left']
    sentence = `${gone.title} deleted this file; ${kept.title} changed it.`
    choices = [[`Keep ${kept.version}`, side], ['Accept the deletion', 'delete']]
  } else if (kind === 'both-deleted') {
    sentence = 'Both sides deleted this file.'
    choices = [['Accept the deletion', 'delete']]
  } else {
    sentence = binary ? "This is a binary file, so it can't be merged line by line. Use one version or the other."
      : symlink ? "This is a symbolic link, so it can't be merged line by line. Use one version or the other."
      : missing && (kind === 'both-modified' || kind === 'both-added') ? `${path} is missing from the folder, so there is nothing to merge line by line. Use one version or the other.`
      : kind === 'added-by-left' ? `${left.title} added this file. Use one version or the other.`
      : kind === 'added-by-right' ? `${right.title} added this file. Use one version or the other.`
      : "This file can't be merged line by line. Use one version or the other."
    choices = [[`Use ${left.version}`, 'left'], [`Use ${right.version}`, 'right']]
  }
  return (
    <div className="nx-resolve-whole">
      <p style={{ margin: 0 }}>{sentence}</p>
      <div className="row" style={{ gap: 8 }}>
        {choices.map(([label, take]) => (
          <button key={take} className={`btn sm${take === 'delete' ? ' danger' : ''}`} disabled={busy} onClick={() => onTake(take)}>{label}</button>
        ))}
      </div>
    </div>
  )
}

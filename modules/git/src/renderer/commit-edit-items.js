import React from 'react'
import { rewordProblem, squashPreviousProblem, squashSelectedProblem, editPlan, squashMessage, parseCommitDetails } from '@nexusmd/core'
import { CommitMessageDialog } from './commit-message-dialog.jsx'
import { ipcMessage } from './use-git-actions.js'

const UNKNOWN = "Can't tell which commits are pushed"

/**
 * The three edit items for the commit at `index` in `commits` (newest first, from HEAD). Each is
 * { label, onSelect, disabled, reason }. `onEdit(edit)` gets an edit without its message. An
 * active search breaks the list's contiguity, so it disables all three.
 */
export function buildEditItems({ commits, index, selected, unpushed, own, source, searching, onEdit }) {
  const commit = commits[index]
  const problems = searching ? ['Clear the search first', 'Clear the search first', 'Clear the search first']
    : !unpushed ? [UNKNOWN, UNKNOWN, UNKNOWN]
      : [
        rewordProblem(commit, unpushed),
        squashPreviousProblem(commits, index, unpushed, own, source),
        squashSelectedProblem(commits, [...selected], unpushed),
      ]
  const edits = [
    { kind: 'reword', oid: commit.oid },
    { kind: 'squash', oids: [commit.oid, commits[index + 1]?.oid] },
    { kind: 'squash', oids: [...selected] },
  ]
  return ['Reword…', 'Squash into previous…', 'Squash selected…'].map((label, i) => ({
    label, onSelect: () => onEdit(edits[i]), disabled: !!problems[i], reason: problems[i] ?? undefined,
  }))
}

/**
 * The reword/squash flow: `start(edit, commits)` loads the message(s), opens the message dialog, and
 * Save hands the plan to `onAction('rebaseInteractive', plan)`. Render `dialog` (null when closed).
 */
export function useCommitEdit({ adapter, repo, cwd, registered, onAction }) {
  const [open, setOpen] = React.useState(null)
  const token = React.useRef(0)
  const close = () => { token.current++; setOpen(null) }

  const start = async (edit, commits) => {
    const id = ++token.current
    const oids = edit.kind === 'squash' ? commits.filter(c => edit.oids.includes(c.oid)).reverse().map(c => c.oid) : [edit.oid]
    const title = edit.kind === 'squash' ? `Squash ${oids.length} commits` : 'Reword commit'
    try {
      const messages = []
      for (const oid of oids) {
        const r = await adapter.commitDetails(repo, cwd, registered, oid)
        if (r?.missing) throw new Error('That commit is no longer there')
        messages.push(parseCommitDetails(r.details).message)
      }
      if (id !== token.current) return
      setOpen({ title, edit, commits, initial: edit.kind === 'squash' ? squashMessage(messages) : messages[0], error: null })
    } catch (e) {
      if (id === token.current) setOpen({ title, edit, commits, initial: '', error: `Couldn't load the message: ${ipcMessage(e)}` })
    }
  }

  const save = message => {
    try {
      const plan = editPlan(open.commits, { ...open.edit, message })
      setOpen(null)
      onAction('rebaseInteractive', plan)
    } catch (e) {
      setOpen({ ...open, error: ipcMessage(e) })
    }
  }

  const dialog = open
    ? React.createElement(CommitMessageDialog, { key: token.current, title: open.title, initial: open.initial, error: open.error, requireChange: open.edit.kind === 'reword', onSave: save, onClose: close })
    : null
  return { start, dialog }
}

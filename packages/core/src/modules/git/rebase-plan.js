// packages/core/src/modules/git/rebase-plan.js
//
// The interactive rebase dialog's model. Rows are oldest first, like git's todo. Messages are keyed
// the way main's editor helper looks them up: a reword by its own commit, a squash group by the
// group's last commit, because git asks for that message once, after the group's last squash line.

export const REBASE_ACTIONS = ['pick', 'reword', 'squash', 'fixup', 'drop']

export function rebasePlan(commits) {
  return commits.map(c => ({ oid: c.oid, subject: c.subject, action: 'pick', message: null }))
}

export function moveRow(rows, oid, delta) {
  const i = rows.findIndex(r => r.oid === oid)
  const j = i + delta
  if (i < 0 || j < 0 || j >= rows.length) return rows
  const next = [...rows]
  const [row] = next.splice(i, 1)
  next.splice(j, 0, row)
  return next
}

export function setRowAction(rows, oid, action) {
  if (!REBASE_ACTIONS.includes(action)) throw new Error(`Unknown rebase action: ${action}`)
  return rows.map(r => (r.oid === oid ? { ...r, action } : r))
}

export function setRowMessage(rows, oid, text) {
  return rows.map(r => (r.oid === oid ? { ...r, message: text } : r))
}

export function rebaseTodo(rows) {
  return rows.map(r => `${r.action} ${r.oid}\n`).join('')
}

// Rows grouped as git applies them: a kept commit followed by the squash/fixup rows folded into it.
export function squashGroups(rows) {
  const groups = []
  for (const r of rows) {
    if (r.action === 'drop') continue
    if ((r.action === 'squash' || r.action === 'fixup') && groups.length) groups[groups.length - 1].push(r)
    else groups.push([r])
  }
  return groups
}

export function rebaseMessages(rows) {
  const out = {}
  for (const group of squashGroups(rows)) {
    const head = group[0]
    // git asks for a reworded commit's message before folding anything into it.
    if (head.action === 'reword' && head.message) out[head.oid] = head.message
    if (group.length === 1) continue
    const last = group[group.length - 1]
    const message = last.message ?? (head.action === 'reword' ? head.message : null)
    if (message) out[last.oid] = message
  }
  return out
}

/** Where the dialog shows a message field: rewords, and the last row of each squash group. */
export function messageRows(rows) {
  const ids = new Set()
  for (const group of squashGroups(rows)) {
    if (group[0].action === 'reword') ids.add(group[0].oid)
    if (group.length > 1) ids.add(group[group.length - 1].oid)
  }
  return ids
}

export function rebaseProblems(rows) {
  const problems = []
  const kept = rows.filter(r => r.action !== 'drop')
  if (!kept.length) problems.push('Keep at least one commit.')
  if (kept.length && (kept[0].action === 'squash' || kept[0].action === 'fixup')) problems.push("The first commit can't be squashed or fixed up.")
  for (const r of rows) {
    if (r.action === 'reword' && !(r.message && r.message.trim())) problems.push(`Give ${r.oid.slice(0, 7)} a message.`)
  }
  // Rebases keep lines starting with '#' (commit.cleanup=whitespace), so git's squash template can't be
  // left as it is. A fixup-only group keeps its first message without asking.
  const messages = rebaseMessages(rows)
  for (const group of squashGroups(rows)) {
    const last = group[group.length - 1]
    if (group.slice(1).some(r => r.action === 'squash') && !(messages[last.oid] && messages[last.oid].trim())) {
      problems.push(`Give ${last.oid.slice(0, 7)} a message for the combined commit.`)
    }
  }
  return problems
}

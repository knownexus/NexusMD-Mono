// pr-actions.js — headless Azure DevOps PR actions (vote, abandon, complete).
// Every function takes an injected `http.fetch(path, options)` adapter, like
// pr-collab.js. Failures throw Error(<ADO message> or 'HTTP <status>').

export const ADO_MERGE_STRATEGIES = [
  { id: 'noFastForward', label: 'Merge' },
  { id: 'squash', label: 'Squash' },
  { id: 'rebase', label: 'Rebase and fast-forward' },
  { id: 'rebaseMerge', label: 'Semi-linear' },
]

function prPath(project, repoId, prId) {
  return `${encodeURIComponent(project)}/_apis/git/repositories/${repoId}/pullRequests/${prId}`
}

async function failure(res) {
  let message = ''
  try {
    const body = JSON.parse(await res.text())
    if (body && typeof body.message === 'string') message = body.message
  } catch { /* non-JSON body */ }
  return new Error(message || `HTTP ${res.status}`)
}

async function send(http, path, method, body) {
  const res = await http.fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await failure(res)
  return res
}

export async function voteAdoPR(http, { project, repoId, prId, reviewerId }, vote) {
  if (!reviewerId) throw new Error('Your Azure DevOps identity is not known yet — refresh and try again')
  await send(http, `${prPath(project, repoId, prId)}/reviewers/${reviewerId}?api-version=7.0`, 'PUT', { vote })
}

export async function abandonAdoPR(http, { project, repoId, prId }) {
  await send(http, `${prPath(project, repoId, prId)}?api-version=7.0`, 'PATCH', { status: 'abandoned' })
}

export async function completeAdoPR(http, { project, repoId, prId }, { mergeStrategy, deleteSourceBranch }) {
  const path = `${prPath(project, repoId, prId)}?api-version=7.0`
  const res = await http.fetch(path)
  if (!res.ok) throw await failure(res)
  const pr = await res.json()
  const reply = await send(http, path, 'PATCH', {
    status: 'completed',
    lastMergeSourceCommit: { commitId: pr.lastMergeSourceCommit?.commitId },
    completionOptions: { mergeStrategy, deleteSourceBranch },
  })
  try { return (await reply.json()) || {} } catch { return {} }
}

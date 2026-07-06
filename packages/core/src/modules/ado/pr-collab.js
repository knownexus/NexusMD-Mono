// pr-collab.js — headless Azure DevOps PR collaboration helpers (threads,
// comments, resolve/reopen, commits, file changes, description edits).
// Every function takes an injected `http.fetch(path, options)` adapter,
// mirroring the pattern in loader.js. Ported from apps/app/src/app.jsx's
// PRDetail/PRCommitsTab/PRFilesTab so both desktop and (eventually) mobile
// can share one implementation; mobile is not migrated to this in this pass.

async function getJson(http, path) {
  const res = await http.fetch(path)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function mutate(http, path, method, body) {
  const res = await http.fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function repoBase(project, repoId, prId) {
  return `${encodeURIComponent(project)}/_apis/git/repositories/${repoId}/pullRequests/${prId}`
}

export async function fetchPRThreads(http, { project, repoId, prId }) {
  const data = await getJson(http, `${repoBase(project, repoId, prId)}/threads?api-version=7.0`)
  return (data.value || []).filter(t =>
    !t.isDeleted && (t.comments || []).some(c => c.commentType === 1 && !c.isDeleted)
  )
}

export async function postPRThread(http, { project, repoId, prId, content }) {
  return mutate(http, `${repoBase(project, repoId, prId)}/threads?api-version=7.0`, 'POST', {
    comments: [{ parentCommentId: 0, content, commentType: 1 }],
    status: 1,
  })
}

export async function postPRReply(http, { project, repoId, prId, threadId, parentCommentId, content }) {
  return mutate(
    http,
    `${repoBase(project, repoId, prId)}/threads/${threadId}/comments?api-version=7.0`,
    'POST',
    { parentCommentId, content, commentType: 1 },
  )
}

export async function setPRThreadStatus(http, { project, repoId, prId, threadId, status }) {
  return mutate(http, `${repoBase(project, repoId, prId)}/threads/${threadId}?api-version=7.0`, 'PATCH', { status })
}

export async function fetchPRCommits(http, { project, repoId, prId }) {
  const data = await getJson(http, `${repoBase(project, repoId, prId)}/commits?api-version=7.0`)
  return data.value || []
}

export async function fetchPRFileChanges(http, { project, repoId, prId }) {
  const base = repoBase(project, repoId, prId)
  const iData = await getJson(http, `${base}/iterations?api-version=7.0`)
  const iterations = iData.value || []
  if (!iterations.length) throw new Error('No PR iterations found.')
  const latest = iterations[iterations.length - 1]
  const srcCommit = latest.sourceRefCommit?.commitId || null
  const baseCommit = latest.targetRefCommit?.commitId || null
  const cData = await getJson(http, `${base}/iterations/${latest.id}/changes?$top=200&api-version=7.0`)
  return { files: cData.changeEntries || [], srcCommit, baseCommit }
}

export async function fetchFileContent(http, { project, repoId, path, commitId }) {
  if (!commitId) return ''
  const res = await http.fetch(
    `${encodeURIComponent(project)}/_apis/git/repositories/${repoId}/items` +
    `?path=${encodeURIComponent(path)}` +
    `&versionDescriptor%5BversionType%5D=commit&versionDescriptor%5Bversion%5D=${commitId}` +
    `&%24format=text&api-version=7.0`
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

export async function updatePRDescription(http, { project, repoId, prId, description }) {
  return mutate(
    http,
    `${encodeURIComponent(project)}/_apis/git/repositories/${repoId}/pullRequests/${prId}?api-version=7.0`,
    'PATCH',
    { description },
  )
}

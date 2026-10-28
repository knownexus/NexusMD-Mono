// packages/core/src/modules/github/pr-collab.js — files, commits and comments of a GitHub
// pull request, for the PR drawer's tabs. Every function takes a client from makeGithubClient.
// Comment text is GitHub markdown, passed through as is.

const pullPath = ({ repo, number }) => `repos/${repo}/pulls/${number}`
const issuePath = ({ repo, number }) => `repos/${repo}/issues/${number}`

const CHANGE_TYPES = { added: 'add', removed: 'delete', renamed: 'rename' }

const mapComment = (c) => ({ id: c.id, author: c.user?.login || '', text: c.body || '', createdDate: c.created_at || '' })

export async function fetchGithubPRFiles(client, pr) {
  const files = await client.getPaged(`${pullPath(pr)}/files`)
  return files.map(f => ({
    path: f.filename,
    changeType: CHANGE_TYPES[f.status] || 'edit',
    additions: f.additions || 0,
    deletions: f.deletions || 0,
    patch: f.patch || '',
  }))
}

export async function fetchGithubPRCommits(client, pr) {
  const commits = await client.getPaged(`${pullPath(pr)}/commits`)
  return commits.map(c => ({
    id: c.sha,
    message: String(c.commit?.message || '').split('\n')[0],
    author: c.author?.login || c.commit?.author?.name || '',
    date: c.commit?.author?.date || '',
  }))
}

// The PR's conversation (issue comments) comes first as one thread, then each review-comment
// thread: a root comment and its replies, linked by in_reply_to_id.
export async function fetchGithubPRThreads(client, pr) {
  const [conversation, review] = await Promise.all([
    client.getPaged(`${issuePath(pr)}/comments`),
    client.getPaged(`${pullPath(pr)}/comments`),
  ])
  const threads = new Map()
  for (const c of review) {
    const rootId = c.in_reply_to_id || c.id
    if (!threads.has(rootId)) threads.set(rootId, { id: rootId, path: c.path || null, line: c.line ?? c.original_line ?? null, comments: [] })
    threads.get(rootId).comments.push(mapComment(c))
  }
  return [
    ...(conversation.length ? [{ id: 'conversation', path: null, line: null, comments: conversation.map(mapComment) }] : []),
    ...threads.values(),
  ]
}

export async function postGithubPRComment(client, pr, text) {
  return mapComment(await client.post(`${issuePath(pr)}/comments`, { body: text }))
}

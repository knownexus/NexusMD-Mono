// pr-actions.js — headless GitHub PR actions (review, close, merge).
// Every function takes a client from makeGithubClient; failures throw the
// client's GithubError (or a plain Error with a friendlier message).

const WAIT_BODY = 'Waiting for author — sent from NexusMD'

const MERGE_METHODS = [
  { flag: 'allow_merge_commit', id: 'merge', label: 'Merge' },
  { flag: 'allow_squash_merge', id: 'squash', label: 'Squash' },
  { flag: 'allow_rebase_merge', id: 'rebase', label: 'Rebase' },
]

const pullPath = (repo, number) => `repos/${repo}/pulls/${number}`

export async function reviewGithubPR(client, { repo, number }, event) {
  const body = event === 'REQUEST_CHANGES' ? { event, body: WAIT_BODY } : { event }
  try {
    await client.post(`${pullPath(repo, number)}/reviews`, body)
  } catch (e) {
    if (e?.status === 422) throw new Error("You can't review your own pull request")
    throw e
  }
}

export async function closeGithubPR(client, { repo, number }) {
  await client.patch(pullPath(repo, number), { state: 'closed' })
}

export async function githubMergeMethods(client, repo) {
  const info = await client.get(`repos/${repo}`)
  return MERGE_METHODS.filter(m => info?.[m.flag]).map(({ id, label }) => ({ id, label }))
}

export async function mergeGithubPR(client, { repo, number, branch, headRepo }, { method, deleteBranch }) {
  await client.put(`${pullPath(repo, number)}/merge`, { merge_method: method })
  const warnings = []
  const sameRepo = !!headRepo && headRepo.toLowerCase() === repo.toLowerCase()
  if (deleteBranch && branch && !sameRepo) {
    warnings.push('Merged, but the branch is in another repository and was not deleted')
  } else if (deleteBranch && branch) {
    const ref = branch.split('/').map(encodeURIComponent).join('/')
    try {
      await client.del(`repos/${repo}/git/refs/heads/${ref}`)
    } catch (e) {
      warnings.push(`Merged, but the branch could not be deleted: ${e.message}`)
    }
  }
  return { warnings }
}

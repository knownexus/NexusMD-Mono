// pr-actions.js — one set of PR actions (approve, wait for author, reject,
// merge) over both providers. Each action resolves { patch, warnings }, where
// `patch` is what the caller merges into its cached PR.
import {
  ADO_MERGE_STRATEGIES, voteAdoPR, abandonAdoPR, completeAdoPR,
} from '../ado/pr-actions.js'
import {
  reviewGithubPR, closeGithubPR, githubMergeMethods, mergeGithubPR,
} from '../github/pr-actions.js'

const result = (patch, warnings = []) => ({ patch, warnings })

export function makePRActions({ adoHttp, adoMeId, githubClient } = {}) {
  const isGithub = pr => pr?.source === 'github'
  const gh = () => {
    if (!githubClient) throw new Error('GitHub is not configured')
    return githubClient
  }
  const adoRef = pr => ({ project: pr.project, repoId: pr.repoId, prId: pr.id })
  const ghRef = pr => ({ repo: pr.repo, number: pr.number, branch: pr.branch, headRepo: pr.headRepo })

  async function vote(pr, adoVote, event) {
    if (isGithub(pr)) await reviewGithubPR(gh(), ghRef(pr), event)
    else await voteAdoPR(adoHttp, { ...adoRef(pr), reviewerId: adoMeId }, adoVote)
    return result({ myVote: adoVote })
  }

  return {
    approve: pr => vote(pr, 10, 'APPROVE'),
    waitForAuthor: pr => vote(pr, -5, 'REQUEST_CHANGES'),
    async reject(pr) {
      if (isGithub(pr)) await closeGithubPR(gh(), ghRef(pr))
      else await abandonAdoPR(adoHttp, adoRef(pr))
      return result({ status: 'abandoned' })
    },
    async merge(pr, { method, deleteBranch } = {}) {
      if (isGithub(pr)) {
        const { warnings } = await mergeGithubPR(gh(), ghRef(pr), { method, deleteBranch })
        return result({ status: 'merged' }, warnings)
      }
      const reply = await completeAdoPR(adoHttp, adoRef(pr), { mergeStrategy: method, deleteSourceBranch: !!deleteBranch })
      if (reply?.status === 'completed') return result({ status: 'merged' })
      return result({}, [`Completion queued — Azure DevOps reports ${reply?.mergeStatus || 'pending'}`])
    },
    async mergeOptions(pr) {
      if (isGithub(pr)) {
        return {
          methods: await githubMergeMethods(gh(), pr.repo),
          rejectConfirm: 'Reject and close this pull request?',
        }
      }
      return { methods: ADO_MERGE_STRATEGIES, rejectConfirm: 'Reject and abandon this pull request?' }
    },
  }
}

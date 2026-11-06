// pr-actions.js — one set of PR actions (approve, wait for author, reject,
// merge) over both providers. Each action resolves { patch, warnings }, where
// `patch` is what the caller merges into its cached PR.
import {
  ADO_MERGE_STRATEGIES, voteAdoPR, abandonAdoPR, completeAdoPR, adoDependentPRs,
} from '../ado/pr-actions.js'
import {
  reviewGithubPR, closeGithubPR, githubMergeMethods, mergeGithubPR, githubDependentPRs,
} from '../github/pr-actions.js'
import { rendererLog, ignore } from '../../log.js'

const log = rendererLog('workitems', 'pr-actions')

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

  async function findDependents(pr) {
    try {
      const list = isGithub(pr)
        ? await githubDependentPRs(gh(), ghRef(pr))
        : await adoDependentPRs(adoHttp, { ...adoRef(pr), branch: pr.sourceBranch })
      return { dependents: list }
    } catch (err) {
      ignore(log, 'could not look for pull requests that target this branch; the merge dialog says it could not check', err, 'warn')
      return { dependents: [], dependentsError: true }
    }
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
    // What the merge dialog needs: the merge methods, and the other open PRs that target this one's source branch (deleting the
    // branch after the merge closes them on GitHub, and strands them on Azure DevOps). If that cannot be looked up the dialog
    // is told, so it can say so rather than assume there are none.
    async mergeOptions(pr) {
      const dependents = await findDependents(pr)
      if (isGithub(pr)) {
        return {
          methods: await githubMergeMethods(gh(), pr.repo),
          rejectConfirm: 'Reject and close this pull request?',
          ...dependents,
        }
      }
      return { methods: ADO_MERGE_STRATEGIES, rejectConfirm: 'Reject and abandon this pull request?', ...dependents }
    },
  }
}

const SHOWN_DEPENDENTS = 5

/**
 * What the merge dialog says about the other open pull requests that target the branch about to be deleted (from mergeOptions),
 * or '' when there is nothing to say. Shared by every merge dialog, so they word it, and default the checkbox, the same way.
 */
export function deleteBranchWarning(options, pr) {
  if (options?.dependentsError) return 'We could not check whether other pull requests target this branch, so it is kept. Tick the box if you are sure.'
  const list = options?.dependents
  if (!Array.isArray(list) || list.length === 0) return ''
  const n = list.length
  const shown = list.slice(0, SHOWN_DEPENDENTS).map(d => `${d.label} ${d.title}`.trim()).join(', ')
  const more = n > SHOWN_DEPENDENTS ? `, and ${n - SHOWN_DEPENDENTS} more` : ''
  const effect = pr?.source === 'github' ? 'Deleting the branch would close them.' : 'Deleting the branch would leave them with no target branch.'
  return `${n} open pull request${n === 1 ? ' targets' : 's target'} this branch: ${shown}${more}. ${effect} Merge or retarget them first, or keep the branch.`
}

/** The branch is deleted after the merge unless something depends on it, or that could not be checked. */
export const deleteBranchByDefault = (options) => !options?.dependentsError && !(options?.dependents?.length > 0)

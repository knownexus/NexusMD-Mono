import { isGithubId, isJiraId } from '../workitems/ids.js'

// Reverse index: work-item id -> PRs that link to it. Pure; built from the
// already-loaded PRS array (each PR carries linkedWorkItems: [{ id }]).
// Numeric ADO ids index as numbers; prefixed string ids (gh:..., jira:...) stay as-is;
// anything else is malformed and skipped.
export function indexPRsByWorkItem(prs) {
  const map = new Map()
  for (const pr of prs || []) {
    for (const w of pr.linkedWorkItems || []) {
      const n = Number(w.id)
      const id = Number.isFinite(n) ? n : isGithubId(w.id) || isJiraId(w.id) ? w.id : null
      if (id === null) continue
      if (!map.has(id)) map.set(id, [])
      map.get(id).push(pr)
    }
  }
  return map
}

import { toGithubId } from '../workitems/ids.js'

// Matches "#123" and "owner/repo#123". Closing keywords (close[sd]?, fix(e[sd])?,
// resolve[sd]?) are followed by the same ref forms, so every ref is picked up whether
// or not a keyword precedes it. "#12abc" and "color #fff" do not match.
const REF_RE = /(?<![\w/.-])(?:([\w.-]+\/[\w.-]+))?#(\d+)(?!\w)/g

export function extractIssueRefs(text, defaultRepo, knownRepos) {
  const known = new Set(knownRepos || [])
  const out = []
  const seen = new Set()
  for (const m of String(text || '').matchAll(REF_RE)) {
    const repo = m[1] || defaultRepo
    if (!repo || !known.has(repo)) continue
    const id = toGithubId(repo, parseInt(m[2], 10))
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

// Jira items carry string ids prefixed "jira:"; GitHub items "gh:owner/name#123"; ADO items keep
// their numeric ids (seen-tracking, acknowledged sets and PR links are keyed by them).

export const JIRA_ID_PREFIX = 'jira:'
export const GITHUB_ID_PREFIX = 'gh:'

export const isJiraId = (id) => typeof id === 'string' && id.startsWith(JIRA_ID_PREFIX)
export const toJiraId = (key) => JIRA_ID_PREFIX + key
export const jiraKeyFromId = (id) => (isJiraId(id) ? id.slice(JIRA_ID_PREFIX.length) : null)

export const isGithubId = (id) => typeof id === 'string' && id.startsWith(GITHUB_ID_PREFIX)
export const toGithubId = (repo, number) => `${GITHUB_ID_PREFIX}${repo}#${number}`
export function parseGithubId(id) {
  if (!isGithubId(id)) return null
  const m = /^([^#]+)#(\d+)$/.exec(id.slice(GITHUB_ID_PREFIX.length))
  return m ? { repo: m[1], number: parseInt(m[2], 10) } : null
}

export const sourceOfId = (id) => (isJiraId(id) ? 'jira' : isGithubId(id) ? 'github' : 'ado')

export function displayIdOf(item) {
  if (!item) return ''
  if (item.displayId) return item.displayId
  if (isJiraId(item.id)) return jiraKeyFromId(item.id)
  if (isGithubId(item.id)) return item.id.slice(GITHUB_ID_PREFIX.length)
  return `#${item.id}`
}

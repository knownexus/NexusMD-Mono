// Jira items carry string ids prefixed "jira:"; ADO items keep their numeric ids
// (seen-tracking, acknowledged sets and PR links are keyed by them).

export const JIRA_ID_PREFIX = 'jira:'

export const isJiraId = (id) => typeof id === 'string' && id.startsWith(JIRA_ID_PREFIX)
export const toJiraId = (key) => JIRA_ID_PREFIX + key
export const jiraKeyFromId = (id) => (isJiraId(id) ? id.slice(JIRA_ID_PREFIX.length) : null)
export const sourceOfId = (id) => (isJiraId(id) ? 'jira' : 'ado')

export function displayIdOf(item) {
  if (!item) return ''
  if (item.displayId) return item.displayId
  return isJiraId(item.id) ? jiraKeyFromId(item.id) : `#${item.id}`
}

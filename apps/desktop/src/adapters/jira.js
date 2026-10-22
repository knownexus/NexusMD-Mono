// Jira REST calls are proxied through the main process (no CORS, token stays out of the page).
const api = () => window.electronAPI

export const jiraAdapter = {
  request(req) { return api().jira.request(req) },
}

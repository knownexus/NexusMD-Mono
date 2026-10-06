// packages/core/src/modules/jira/boards.js — the user's Jira board layout, via
// the Jira Agile REST API: which boards exist, and which statuses sit in each
// column of one board.

export async function fetchJiraBoards(client, projectKeys = []) {
  const byId = new Map()
  await Promise.all(projectKeys.map(async (key) => {
    let res
    try { res = await client.get(`rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(key)}&maxResults=50`) } catch (_) { return }
    for (const b of res?.values || []) {
      const id = String(b.id)
      if (!byId.has(id)) byId.set(id, { id, name: b.name, type: b.type, projectKey: b.location?.projectKey || key })
    }
  }))
  return Array.from(byId.values()).sort((a, b) => Number(a.id) - Number(b.id))
}

export async function fetchJiraBoardColumns(client, boardId, statusNameById = {}) {
  const res = await client.get(`rest/agile/1.0/board/${encodeURIComponent(boardId)}/configuration`)
  return (res?.columnConfig?.columns || []).map(col => ({
    name: col.name,
    statuses: (col.statuses || []).map(s => statusNameById[String(s.id)]).filter(Boolean),
  }))
}

export function jiraColumnForStatus(columns, statusName) {
  if (!Array.isArray(columns) || !statusName) return null
  const s = String(statusName).toLowerCase()
  return columns.find(c => c.statuses.some(x => x.toLowerCase() === s)) || null
}

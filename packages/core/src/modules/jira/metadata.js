// discover a site's real issue types,
// statuses (with categories), priorities, custom field ids and people. Every call
// fails soft, matching ado/process-metadata.js.

export const JIRA_CATEGORY_MAP = { new: 'Proposed', indeterminate: 'InProgress', done: 'Completed' }

export const categoryOfJiraStatus = (status) => JIRA_CATEGORY_MAP[status?.statusCategory?.key] || 'Proposed'

export const toPerson = (u) => ({
  accountId: u.accountId,
  displayName: u.displayName || '',
  avatarUrl: u.avatarUrls?.['48x48'] || '',
})

function idByName(fields, names) {
  for (const n of names) {
    const f = fields.find(x => String(x.name || '').toLowerCase() === n)
    if (f) return f.id
  }
  return null
}

export function discoverFieldIds(fields = []) {
  return {
    storyPoints: idByName(fields, ['story point estimate', 'story points']),
    sprint: fields.find(f => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint')?.id || null,
    acceptanceCriteria: idByName(fields, ['acceptance criteria']),
    reproSteps: idByName(fields, ['steps to reproduce']),
  }
}

export const emptyJiraMeta = () => ({
  types: [], typeStates: {}, stateCategoryByName: {}, states: [], priorities: [],
  fieldIds: { storyPoints: null, sprint: null, acceptanceCriteria: null, reproSteps: null },
  me: null, people: [], statusNameById: {},
})

export async function fetchJiraMetadata(client, projectKeys = []) {
  const meta = emptyJiraMeta()
  const typeNames = new Set()

  await Promise.all(projectKeys.map(async (key) => {
    let types = []
    try { types = await client.get(`rest/api/3/project/${encodeURIComponent(key)}/statuses`) } catch (_) { return }
    for (const t of types || []) {
      typeNames.add(t.name)
      const names = []
      for (const s of t.statuses || []) {
        names.push(s.name)
        if (s.id != null) meta.statusNameById[String(s.id)] = s.name
        if (!meta.stateCategoryByName[s.name]) meta.stateCategoryByName[s.name] = categoryOfJiraStatus(s)
      }
      meta.typeStates[t.name] = Array.from(new Set([...(meta.typeStates[t.name] || []), ...names]))
    }
  }))

  const keysParam = projectKeys.map(encodeURIComponent).join(',')
  const [priorities, fields, me, people] = await Promise.all([
    client.get('rest/api/3/priority').catch(() => null),
    client.get('rest/api/3/field').catch(() => null),
    client.get('rest/api/3/myself').catch(() => null),
    projectKeys.length
      ? client.get(`rest/api/3/user/assignable/multiProjectSearch?projectKeys=${keysParam}&maxResults=1000`).catch(() => null)
      : Promise.resolve(null),
  ])

  const prioList = Array.isArray(priorities) ? priorities : (priorities?.values || [])
  meta.priorities = prioList.map((p, i) => ({ id: String(p.id), name: p.name, rank: i + 1 }))
  meta.fieldIds = discoverFieldIds(Array.isArray(fields) ? fields : [])
  meta.me = me ? { accountId: me.accountId, displayName: me.displayName || '', email: me.emailAddress || '' } : null
  meta.people = (Array.isArray(people) ? people : [])
    .filter(u => u.active !== false && u.accountType !== 'app')
    .map(toPerson)
  meta.types = Array.from(typeNames).sort()
  meta.states = Object.keys(meta.stateCategoryByName).sort()
  return meta
}

// When status metadata failed, derive types/statuses from the issues themselves.
export function fillMetadataFromIssues(meta, issues = []) {
  if (meta.types.length) return meta
  const next = { ...meta, typeStates: {}, stateCategoryByName: { ...meta.stateCategoryByName }, statusNameById: { ...(meta.statusNameById || {}) } }
  const typeNames = new Set()
  for (const issue of issues) {
    const type = issue.fields?.issuetype?.name
    const status = issue.fields?.status
    if (!type || !status?.name) continue
    typeNames.add(type)
    next.typeStates[type] = Array.from(new Set([...(next.typeStates[type] || []), status.name]))
    if (!next.stateCategoryByName[status.name]) next.stateCategoryByName[status.name] = categoryOfJiraStatus(status)
    if (status.id != null) next.statusNameById[String(status.id)] = status.name
  }
  next.types = Array.from(typeNames).sort()
  next.states = Object.keys(next.stateCategoryByName).sort()
  return next
}

export async function discoverGithubRepos(client) {
  const rows = await client.getPaged(
    'user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=full_name',
  )
  const repos = rows.map(r => ({
    fullName: r.full_name,
    owner: r.owner?.login,
    name: r.name,
    private: !!r.private,
    archived: !!r.archived,
    hasIssues: !!r.has_issues,
    org: r.owner?.type === 'Organization' ? r.owner.login : null,
  })).sort((a, b) => a.fullName.toLowerCase().localeCompare(b.fullName.toLowerCase()))

  const ssoOrgs = []
  let orgs = []
  try { orgs = await client.getPaged('user/orgs?per_page=100') } catch { /* org list is best-effort */ }
  for (const o of orgs) {
    try {
      await client.get(`orgs/${encodeURIComponent(o.login)}/repos?per_page=1`)
    } catch (e) {
      if (e?.kind === 'sso') ssoOrgs.push({ login: o.login, url: e.ssoUrl || '' })
    }
  }
  return { repos, ssoOrgs }
}

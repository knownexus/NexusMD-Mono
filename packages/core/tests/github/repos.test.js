import { describe, it, expect } from 'vitest'
import { discoverGithubRepos, GithubError } from '../../src/modules/github/index.js'

describe('discoverGithubRepos', () => {
  it('maps, sorts, and reports SSO orgs without throwing', async () => {
    const calls = []
    const client = {
      getPaged: async (path) => {
        calls.push(path)
        if (path.includes('user/repos')) return [
          { full_name: 'zed/Z', name: 'Z', owner: { login: 'zed', type: 'User' }, private: false, archived: true, has_issues: false },
          { full_name: 'acme/web', name: 'web', owner: { login: 'acme', type: 'Organization' }, private: true, archived: false, has_issues: true },
        ]
        return [{ login: 'acme' }, { login: 'locked' }]
      },
      get: async (path) => {
        if (path.includes('locked')) throw Object.assign(new GithubError('sso', { status: 403, kind: 'sso' }), { ssoUrl: 'https://github.com/orgs/locked/sso' })
        return []
      },
    }
    const out = await discoverGithubRepos(client)
    expect(calls.find(p => p.includes('user/repos'))).toContain('affiliation=owner,collaborator,organization_member')
    expect(out.repos.map(r => r.fullName)).toEqual(['acme/web', 'zed/Z'])
    expect(out.repos[0]).toEqual({ fullName: 'acme/web', owner: 'acme', name: 'web', private: true, archived: false, hasIssues: true, org: 'acme' })
    expect(out.repos[1].org).toBeNull()
    expect(out.ssoOrgs).toEqual([{ login: 'locked', url: 'https://github.com/orgs/locked/sso' }])
  })
})

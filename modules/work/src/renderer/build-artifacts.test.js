import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeBuildArtifacts } from './build-artifacts.js'
import { saveAdoConfig } from './ado-client.js'
import { saveGithubConfig } from './github-client.js'

const ok = (data) => ({ ok: true, status: 200, json: async () => data })

beforeEach(() => {
  localStorage.clear()
  saveAdoConfig({ org: 'acme', pat: 'adopat', projects: ['P'] })
  saveGithubConfig({ pat: 'ghpat' })
})

describe('makeBuildArtifacts', () => {
  it('is null where the shell can\'t save files', () => {
    expect(makeBuildArtifacts(undefined)).toBeNull()
    expect(makeBuildArtifacts({ saveArtifact: vi.fn(), available: () => false })).toBeNull()
  })

  it('lists through Work\'s own clients for the configured org', async () => {
    const ado = { fetch: vi.fn(async () => ok({ value: [{ name: 'drop' }] })) }
    const github = { fetch: vi.fn(async () => ok({ artifacts: [] })) }
    const b = makeBuildArtifacts({ saveArtifact: vi.fn(), available: () => true }, { ado: () => ado, github: () => github })
    const [item] = await b.list({ id: 3, projectName: 'P' })
    expect(item.url).toMatch(/^https:\/\/dev\.azure\.com\/acme\/P\//)
    await b.list({ id: 4, source: 'github', projectName: 'o/r' })
    expect(github.fetch).toHaveBeenCalledWith('repos/o/r/actions/runs/4/artifacts?per_page=100')
  })

  it('saves with only that provider\'s token', async () => {
    const saveArtifact = vi.fn(async () => ({ saved: true, path: 'x' }))
    const b = makeBuildArtifacts({ saveArtifact, available: () => true })
    const adoItem = { provider: 'ado', url: 'https://dev.azure.com/acme/P/x', filename: 'a.zip' }
    const ghItem = { provider: 'github', url: 'https://api.github.com/x', filename: 'b.zip' }
    expect(await b.save(adoItem)).toEqual({ saved: true, path: 'x' })
    expect(saveArtifact).toHaveBeenLastCalledWith(adoItem, { org: 'acme', pat: 'adopat' })
    await b.save(ghItem)
    expect(saveArtifact).toHaveBeenLastCalledWith(ghItem, { pat: 'ghpat' })
  })
})

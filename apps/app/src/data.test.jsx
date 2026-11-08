import { describe, it, expect, vi, beforeEach } from 'vitest'

// Which services are connected; the tests flip these to play a connection being removed.
const on = { ado: false, jira: false, github: false }
vi.mock('./ado-client.js', () => ({
  getAdoConfig: () => ({ org: 'acme' }), isAdoConfigured: () => on.ado,
  usesAdoWorkItems: () => true, createAdoHttpAdapter: () => ({}),
}))
vi.mock('./jira-client.js', () => ({
  getJiraConfig: () => ({}), isJiraActive: () => on.jira, createJiraHttpAdapter: () => ({}),
}))
vi.mock('./github-client.js', () => ({
  getGithubConfig: () => ({}), isGithubConfigured: () => on.github,
  usesGithubWorkItems: () => true, createGithubHttpAdapter: () => ({}),
}))
vi.mock('@nexusmd/core', async importOriginal => ({
  ...(await importOriginal()),
  loadAdoData: vi.fn().mockResolvedValue({}),
}))

const ADO_CACHE = { ORG: 'acme', WORK_ITEMS: [{ id: 1 }], PRS: [{ id: 9, title: 'azure pr' }], BUILDS: [], TEAM: [{ id: 'p1', name: 'Pat' }] }

async function loadData() {
  vi.resetModules()
  return import('./data.jsx')
}

beforeEach(() => {
  localStorage.clear()
  on.ado = on.jira = on.github = false
  localStorage.setItem('nexusmd.ado.cache.v1', JSON.stringify(ADO_CACHE))
})

describe('HelmData after a connection was removed', () => {
  it('does not show the cached Azure DevOps data at start when nothing is connected', async () => {
    const { HelmData } = await loadData()
    expect(HelmData.PRS).toEqual([])
    expect(HelmData.WORK_ITEMS).toEqual([])
    expect(HelmData.configured).toBe(false)
  })

  it('shows the cached data at start while Azure DevOps is connected', async () => {
    on.ado = true
    const { HelmData } = await loadData()
    expect(HelmData.PRS).toEqual([{ id: 9, title: 'azure pr' }])
    expect(HelmData.configured).toBe(true)
  })

  it('empties what is on screen when a reload finds nothing connected any more', async () => {
    on.ado = true
    const { HelmData, HelmApi } = await loadData()
    await vi.waitFor(() => expect(HelmData.PRS.length).toBe(1))
    on.ado = false
    await HelmApi.load()
    expect(HelmData.PRS).toEqual([])
    expect(HelmData.WORK_ITEMS).toEqual([])
    expect(HelmData.TEAM.map(m => m.id)).not.toContain('p1')
    expect(HelmData.configured).toBe(false)
    expect(HelmData.loaded).toBe(true)
  })
})

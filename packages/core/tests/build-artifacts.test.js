import { describe, it, expect, vi } from 'vitest'
import { mapAdoArtifacts, mapGithubArtifacts, listArtifacts, authHeaders, isArtifactApiUrl, formatSize } from '../src/index.js'

const ok = (data) => ({ ok: true, status: 200, json: async () => data })

describe('build artifacts', () => {
  it('builds Azure DevOps zip URLs for the configured org', () => {
    const [a] = mapAdoArtifacts({ value: [{ name: 'drop apk', resource: { properties: { artifactsize: '2048' } } }] },
      { id: 42, projectName: 'My Proj' }, 'acme')
    expect(a.url).toBe('https://dev.azure.com/acme/My%20Proj/_apis/build/builds/42/artifacts?artifactName=drop%20apk&api-version=7.0&%24format=zip')
    expect(a).toMatchObject({ provider: 'ado', size: 2048, filename: 'drop apk.zip' })
  })

  it('maps GitHub run artifacts and flags expired ones', () => {
    const items = mapGithubArtifacts({ artifacts: [
      { name: 'web/build', size_in_bytes: 5, archive_download_url: 'https://api.github.com/x/zip', expired: false },
      { name: 'old', size_in_bytes: 1, archive_download_url: 'https://api.github.com/y/zip', expired: true },
    ] })
    expect(items.map(i => i.expired)).toEqual([false, true])
    expect(items[0].filename).toBe('web_build.zip')
  })

  it('lists from the right provider', async () => {
    const github = { fetch: vi.fn(async () => ok({ artifacts: [] })) }
    const ado = { fetch: vi.fn(async () => ok({ value: [] })) }
    await listArtifacts({ id: 7, source: 'github', projectName: 'o/r' }, { github, ado, org: 'acme' })
    expect(github.fetch).toHaveBeenCalledWith('repos/o/r/actions/runs/7/artifacts?per_page=100')
    await listArtifacts({ id: 8, projectName: 'P' }, { github, ado, org: 'acme' })
    expect(ado.fetch).toHaveBeenCalledWith('P/_apis/build/builds/8/artifacts?api-version=7.0')
  })

  it('reports a failed listing', async () => {
    const ado = { fetch: async () => ({ ok: false, status: 403 }) }
    await expect(listArtifacts({ id: 1, projectName: 'P' }, { ado, github: {}, org: 'a' })).rejects.toThrow('403')
  })

  it('authenticates per provider', () => {
    expect(authHeaders('ado', { ado: { pat: 'x' }, github: {} }).Authorization).toBe('Basic ' + btoa(':x'))
    expect(authHeaders('github', { ado: {}, github: { pat: 'g' } }).Authorization).toBe('Bearer g')
  })

  it('sends the auth headers only to the provider\'s own API host', () => {
    const configs = { ado: { org: 'acme', pat: 'x' }, github: { pat: 'g' } }
    expect(authHeaders('ado', { ...configs, url: 'https://dev.azure.com/acme/P/_apis/build/builds/1/artifacts' }).Authorization).toBeTruthy()
    expect(authHeaders('github', { ...configs, url: 'https://api.github.com/repos/o/r/actions/artifacts/1/zip' }).Authorization).toBeTruthy()
    // A cross-origin URL (a storage host, another org, the other provider's host, plain http) gets nothing.
    expect(authHeaders('github', { ...configs, url: 'https://pipelines.actions.githubusercontent.com/blob' })).toEqual({})
    expect(authHeaders('ado', { ...configs, url: 'https://evil.example/acme/x' })).toEqual({})
    expect(authHeaders('ado', { ...configs, url: 'https://dev.azure.com/other-org/P/x' })).toEqual({})
    expect(authHeaders('ado', { ...configs, url: 'https://api.github.com/x' })).toEqual({})
    expect(authHeaders('github', { ...configs, url: 'http://api.github.com/x' })).toEqual({})
    expect(authHeaders('github', { ...configs, url: 'not a url' })).toEqual({})
  })

  it('tells the provider\'s API URLs apart from anything else', () => {
    expect(isArtifactApiUrl('github', 'https://api.github.com/a')).toBe(true)
    expect(isArtifactApiUrl('ado', 'https://dev.azure.com/acme/a', { org: 'acme' })).toBe(true)
    expect(isArtifactApiUrl('ado', 'https://dev.azure.com.evil.example/acme/a', { org: 'acme' })).toBe(false)
    expect(isArtifactApiUrl('ado', 'https://dev.azure.com:8443/acme/a', { org: 'acme' })).toBe(false)
    expect(isArtifactApiUrl('jira', 'https://api.github.com/a')).toBe(false)
  })

  it('formats sizes', () => {
    expect(formatSize(0)).toBe('')
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

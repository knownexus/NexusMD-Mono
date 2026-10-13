import { describe, it, expect } from 'vitest'
import { normaliseTestRuns, normaliseTestCollection, buildTestUpArgv, buildTestRunArgv, topLevelPaths } from './tests.js'

describe('normaliseTestRuns', () => {
  it('keeps runs and reports with safe types', () => {
    const r = normaliseTestRuns({ kind: 'test-runs', runs: [
      { id: '20261013-120000-api-tests', label: 'api-tests', at: '2026-10-13T12:00:00+01:00', env: 'docker', collection: 'C:\\c', paths: ['smoke'], services: ['orders'], exit: 1, passed: false, requests: { total: 2, passed: 1, failed: 1 }, traceHtml: 'C:\\r\\trace.html', brunoHtml: null },
      { id: 'x', label: 'x', passed: null, requests: 'junk', paths: 'smoke' },
      null,
    ], reports: [{ name: 'trace-1.html', at: null, path: 'C:\\r\\trace-1.html' }, { name: 'no-path' }] })
    expect(r.runs).toHaveLength(2)
    expect(r.runs[0]).toMatchObject({ passed: false, exit: 1, requests: { total: 2, passed: 1, failed: 1 }, traceHtml: 'C:\\r\\trace.html', brunoHtml: null, paths: ['smoke'] })
    expect(r.runs[1]).toMatchObject({ passed: null, requests: null, paths: [], exit: null })
    expect(r.reports).toEqual([{ name: 'trace-1.html', at: null, path: 'C:\\r\\trace-1.html' }])
  })
  it('rejects other results', () => { expect(() => normaliseTestRuns({ kind: 'builds' })).toThrow('Not a devenv test-runs result') })
})

describe('normaliseTestCollection', () => {
  it('adds the display name and drops unknown kinds', () => {
    const c = normaliseTestCollection({ kind: 'test-collection', root: 'C:\\c', isDefault: true, error: null, items: [
      { path: 'smoke', kind: 'folder', depth: 0 }, { path: 'smoke/orders.bru', kind: 'request', depth: 1 }, { path: 'x', kind: 'weird', depth: 0 },
    ] })
    expect(c).toEqual({ root: 'C:\\c', isDefault: true, error: null, items: [
      { path: 'smoke', name: 'smoke', kind: 'folder', depth: 0 },
      { path: 'smoke/orders.bru', name: 'orders.bru', kind: 'request', depth: 1 },
    ] })
  })
  it('carries the error', () => {
    expect(normaliseTestCollection({ kind: 'test-collection', root: 'C:\\x', error: 'Not a Bruno collection', items: [] }).error).toBe('Not a Bruno collection')
  })
})

describe('buildTestUpArgv', () => {
  it('builds up with APIs and --no-build', () => {
    expect(buildTestUpArgv({})).toEqual(['test', 'up'])
    expect(buildTestUpArgv({ apis: ['orders', 'billing'], noBuild: true })).toEqual(['test', 'up', 'orders', 'billing', '--no-build'])
  })
  it('refuses option-like API keys', () => { expect(() => buildTestUpArgv({ apis: ['--x'] })).toThrow() })
})

describe('buildTestRunArgv and topLevelPaths', () => {
  it('builds run with every option', () => {
    expect(buildTestRunArgv({})).toEqual(['test', 'run'])
    expect(buildTestRunArgv({ paths: ['smoke', 'top.bru'], collection: 'C:\\c', env: ' docker ', tags: 'smoke', allApis: true, name: 'nightly' }))
      .toEqual(['test', 'run', 'smoke', 'top.bru', '--collection', 'C:\\c', '--env', 'docker', '--tags', 'smoke', '--all-apis', '--name', 'nightly'])
  })
  it('refuses absolute or parent paths and option-like values', () => {
    expect(() => buildTestRunArgv({ paths: ['../x'] })).toThrow()
    expect(() => buildTestRunArgv({ paths: ['C:\\x'] })).toThrow()
    expect(() => buildTestRunArgv({ paths: ['/x'] })).toThrow()
    expect(() => buildTestRunArgv({ env: '-x' })).toThrow()
    expect(() => buildTestRunArgv({ name: '--all-apis' })).toThrow()
    expect(() => buildTestRunArgv({ collection: 'relative' })).toThrow()
  })
  it('keeps only paths not inside another selected folder', () => {
    expect(topLevelPaths(['smoke', 'smoke/orders.bru', 'smokey.bru', 'a/b', 'a'])).toEqual(['smoke', 'smokey.bru', 'a'])
  })
})

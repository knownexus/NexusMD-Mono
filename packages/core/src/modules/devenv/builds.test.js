import { describe, it, expect } from 'vitest'
import { normaliseBuilds, buildBuildArgv } from './builds.js'

const raw = {
  type: 'result', kind: 'builds', at: '2026-10-13T09:00:00Z',
  items: [
    { key: 'orders', label: 'Orders', kind: 'api', source: { branch: 'main', commit: 'abc', dirty: false }, built: { commit: 'abc', dirty: false, at: '2026-10-13T08:00:00Z' }, upToDate: true, error: null, log: 'C:\\d\\orders.log', mode: null, ios: null },
    { key: 'gone', label: 'Gone', kind: 'api', source: null, built: null, upToDate: false, error: 'Source worktree missing: C:\\x', log: null, mode: null, ios: null },
    { key: 'mobile', label: 'Mobile', kind: 'mobile', source: { branch: 'dev', commit: 'm1', dirty: true }, built: null, upToDate: false, error: null, log: null, mode: { deploy: 'full', abi: 'android-arm64' }, ios: { commit: 'm0', dirty: false, at: '2026-10-12T08:00:00Z' } },
  ],
}

describe('normaliseBuilds', () => {
  it('splits APIs from the mobile app and keeps every field', () => {
    const b = normaliseBuilds(raw)
    expect(b.at).toBe('2026-10-13T09:00:00Z')
    expect(b.apis.map(a => a.key)).toEqual(['orders', 'gone'])
    expect(b.apis[0]).toMatchObject({ upToDate: true, built: { commit: 'abc', at: '2026-10-13T08:00:00Z' }, log: 'C:\\d\\orders.log' })
    expect(b.apis[1]).toMatchObject({ source: null, built: null, upToDate: false, error: 'Source worktree missing: C:\\x' })
    expect(b.mobile).toMatchObject({ key: 'mobile', mode: { deploy: 'full', abi: 'android-arm64' }, ios: { commit: 'm0' } })
  })
  it('has no mobile without a mobile item, and survives junk', () => {
    const b = normaliseBuilds({ kind: 'builds', items: [null, { key: 'x', kind: 'web' }, { key: 'y', kind: 'api', upToDate: 'yes' }] })
    expect(b.mobile).toBeNull()
    expect(b.apis.map(a => a.key)).toEqual(['y'])
    expect(b.apis[0].upToDate).toBe(false)
  })
  it('rejects other results', () => {
    expect(() => normaliseBuilds({ kind: 'status' })).toThrow('Not a devenv builds result')
  })
})

describe('buildBuildArgv', () => {
  it('builds every build action', () => {
    expect(buildBuildArgv({ kind: 'api', key: 'orders' })).toEqual(['build', 'orders'])
    expect(buildBuildArgv({ kind: 'api', key: 'orders', clean: true })).toEqual(['build', 'orders', '--clean'])
    expect(buildBuildArgv({ kind: 'apis', clean: true })).toEqual(['build', 'apis', '--clean'])
    expect(buildBuildArgv({ kind: 'mobile' })).toEqual(['build', 'mobile', '--abi', 'x64', '--deploy', 'fast'])
    expect(buildBuildArgv({ kind: 'mobile', abi: 'arm64', deploy: 'full', install: true })).toEqual(['build', 'mobile', '--abi', 'arm64', '--deploy', 'full', '--install'])
    expect(buildBuildArgv({ kind: 'ios' })).toEqual(['build', 'ios'])
    expect(buildBuildArgv({ kind: 'ios', device: ' iPhone 16 ', noRun: true })).toEqual(['build', 'ios', '--device', 'iPhone 16', '--no-run'])
    expect(buildBuildArgv({ kind: 'app-install' })).toEqual(['app', 'install'])
  })
  it('refuses bad keys, ABIs, deploy modes and option-like device names', () => {
    expect(() => buildBuildArgv({ kind: 'api', key: '--clean' })).toThrow()
    expect(() => buildBuildArgv({ kind: 'api', key: 'status' })).toThrow()
    expect(() => buildBuildArgv({ kind: 'mobile', abi: 'mips' })).toThrow()
    expect(() => buildBuildArgv({ kind: 'mobile', deploy: 'slow' })).toThrow()
    expect(() => buildBuildArgv({ kind: 'ios', device: '-x' })).toThrow()
    expect(() => buildBuildArgv({ kind: 'nope' })).toThrow()
  })
})

import { describe, it, expect } from 'vitest'
import { normaliseLogTargets, classifyLogLevel, filterLogLines, captureFolder } from './logs.js'

describe('normaliseLogTargets', () => {
  it('groups targets in a fixed order with readable group labels', () => {
    const r = normaliseLogTargets({ kind: 'log-targets', targets: [
      { group: 'backend', key: 'orders', label: 'Orders', argv: ['backend', 'logs', 'orders'], follow: true },
      { group: 'build', key: 'orders', label: 'Orders build log', argv: ['logs', 'show', 'orders'], follow: false },
      { group: 'test', key: 'tracer', label: 'tracer', argv: ['test', 'logs', 'tracer'], follow: true },
      { group: 'emulator', key: 'emulator', label: 'Emulator', argv: ['logs', 'show', 'emulator'], follow: false },
    ] })
    expect(r.groups.map(g => g.label)).toEqual(['Build logs', 'Emulator', 'Backend containers', 'Test stack'])
    expect(r.groups[0].targets[0]).toEqual({ id: 'build:orders', group: 'build', key: 'orders', label: 'Orders build log', argv: ['logs', 'show', 'orders'], follow: false })
  })
  it('drops targets without a string argv and empty groups', () => {
    const r = normaliseLogTargets({ kind: 'log-targets', targets: [{ group: 'build', key: 'x', argv: [1] }, { group: 'backend', key: 'y', label: 'Y', argv: ['backend', 'logs', 'y'], follow: true }, null] })
    expect(r.groups.map(g => g.id)).toEqual(['backend'])
  })
  it('rejects other results', () => { expect(() => normaliseLogTargets({ kind: 'builds' })).toThrow('Not a devenv log-targets result') })
})

describe('classifyLogLevel', () => {
  it('spots errors and warnings in common log formats, ignoring ANSI', () => {
    expect(classifyLogLevel('fail: Microsoft.AspNetCore[1] boom')).toBe('error')
    expect(classifyLogLevel('2026-10-13 ERROR something')).toBe('error')
    expect(classifyLogLevel('Unhandled exception. System.Exception')).toBe('error')
    expect(classifyLogLevel('\u001b[33mwarn\u001b[39m: retrying')).toBe('warn')
    expect(classifyLogLevel('info: started')).toBeNull()
    expect(classifyLogLevel('terrorist')).toBeNull()
  })
})

describe('filterLogLines', () => {
  const lines = [{ text: 'GET /orders 200' }, { text: '\u001b[31m[error]\u001b[0m (db) timeout' }, { text: 'a.b' }]
  it('keeps everything for an empty query, with original indexes', () => {
    expect(filterLogLines(lines, '  ').map(r => r.index)).toEqual([0, 1, 2])
  })
  it('matches literally and case-insensitively, never inside ANSI codes', () => {
    expect(filterLogLines(lines, '[ERROR]').map(r => r.index)).toEqual([1])
    expect(filterLogLines(lines, '(db)').map(r => r.index)).toEqual([1])
    expect(filterLogLines(lines, '.').map(r => r.index)).toEqual([2])
    expect(filterLogLines(lines, '31m')).toEqual([])
  })
})

describe('captureFolder', () => {
  it('returns the last capture path', () => {
    expect(captureFolder([{ kind: 'capture', path: 'C:\\a' }, { kind: 'capture', path: 'C:\\b' }])).toBe('C:\\b')
    expect(captureFolder([{ kind: 'capture' }, { kind: 'other', path: 'C:\\c' }])).toBeNull()
  })
})

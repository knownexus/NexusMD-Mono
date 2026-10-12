import { describe, it, expect } from 'vitest'
import { normaliseCatalog, isCompatibleCatalog, buildDevenvArgv, takesArgs, takesManyArgs } from './catalog.js'

const raw = {
  type: 'result', kind: 'catalog', protocol: 1, profileError: null,
  groups: [{ id: '', title: 'Everyday' }, { id: 'emulator', title: 'Emulator' }, { id: 'test', title: 'API test stack' }],
  commands: [
    { group: '', verb: 'status', args: '', summary: 'At a glance', switches: [], values: [], mut: false, pathValues: {}, pathArgs: null, hidden: false },
    { group: 'emulator', verb: 'push', args: '<file> [<file>...]', summary: 'Copy files', switches: [], values: ['to'], mut: true, pathValues: {}, pathArgs: 'file', hidden: false },
    { group: 'test', verb: 'run', args: '[<folder or .bru>...]', summary: 'Run Bruno', switches: ['no-open', 'all-apis'], values: ['collection', 'env'], mut: true, pathValues: { collection: 'folder' }, pathArgs: 'any', hidden: false },
    { group: 'orders', verb: 'seed', args: '', summary: 'Profile command', switches: [], values: ['count'] },
    { group: 'setup', verb: 'shell', args: '', summary: 'x', switches: [], values: [], hidden: true },
  ],
}

describe('normaliseCatalog', () => {
  const c = normaliseCatalog(raw)
  it('keys commands by "group verb"', () => {
    expect(c.commands.map(x => x.key)).toEqual(['status', 'emulator push', 'test run', 'orders seed', 'setup shell'])
  })
  it('treats a command without mut as mutating (profile commands)', () => {
    expect(c.commands.find(x => x.key === 'orders seed').mut).toBe(true)
    expect(c.commands.find(x => x.key === 'status').mut).toBe(false)
  })
  it('keeps group order from the catalog and adds groups it did not title', () => {
    expect(c.groups.map(g => g.id)).toEqual(['', 'emulator', 'test', 'orders', 'setup'])
    expect(c.groups.find(g => g.id === 'orders').title).toBe('orders')
  })
  it('defaults missing fields safely', () => {
    const seed = c.commands.find(x => x.key === 'orders seed')
    expect(seed.pathValues).toEqual({})
    expect(seed.pathArgs).toBeNull()
    expect(seed.hidden).toBe(false)
  })
  it('rejects something that is not a catalog', () => {
    expect(() => normaliseCatalog({ kind: 'summary' })).toThrow(/catalog/)
  })
})

describe('isCompatibleCatalog', () => {
  it('needs protocol 1', () => {
    expect(isCompatibleCatalog(normaliseCatalog(raw))).toBe(true)
    expect(isCompatibleCatalog(normaliseCatalog({ ...raw, protocol: 2 }))).toBe(false)
  })
})

describe('buildDevenvArgv', () => {
  const c = normaliseCatalog(raw)
  const cmd = key => c.commands.find(x => x.key === key)
  it('top-level shortcuts are just the verb', () => {
    expect(buildDevenvArgv(cmd('status'))).toEqual(['status'])
  })
  it('adds trimmed non-empty positionals, ticked switches and filled values in catalog order', () => {
    expect(buildDevenvArgv(cmd('test run'), {
      positional: [' smoke ', '', 'orders/get.bru'],
      switches: { 'all-apis': true, 'no-open': false },
      values: { env: 'docker', collection: 'C:\My Tests\coll' },
    })).toEqual(['test', 'run', 'smoke', 'orders/get.bru', '--all-apis', '--collection', 'C:\My Tests\coll', '--env', 'docker'])
  })
  it('ignores switches and values the command does not declare', () => {
    expect(buildDevenvArgv(cmd('status'), { switches: { evil: true }, values: { x: '1' } })).toEqual(['status'])
  })
})

describe('takesArgs / takesManyArgs', () => {
  const c = normaliseCatalog(raw)
  it('reads the args text', () => {
    expect(takesArgs(c.commands[0])).toBe(false)
    expect(takesArgs(c.commands[1])).toBe(true)
    expect(takesManyArgs(c.commands[1])).toBe(true)
  })
})

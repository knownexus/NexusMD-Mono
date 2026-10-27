// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import manifest from '../../app.manifest.json'
import { validateManifest } from '@nexusmd/shell-sdk'

const require = createRequire(import.meta.url)
const { register } = require('./index.cjs')

describe('work app manifest', () => {
  it('is a valid app manifest', () => {
    expect(validateManifest(manifest)).toEqual([])
    expect(manifest.id).toBe('work')
  })

  it('owns the seven screens it always had, in the sidebar order users know', () => {
    expect(manifest.nav.map(n => n.id)).toEqual(['dashboard', 'work', 'prs', 'builds', 'tests', 'team', 'triage'])
  })

  it('has a handler for every channel it exposes, and nothing else under jira:', () => {
    const handlers = {}
    register({ ipcMain: { handle: (channel, fn) => { handlers[channel] = fn } } })
    const exposed = Object.values(manifest.ipc.preload).flatMap(ns => Object.values(ns)).map(m => m.invoke)
    expect(exposed.filter(c => !handlers[c])).toEqual([])
    expect(Object.keys(handlers).filter(c => c.startsWith('jira:') && !exposed.includes(c))).toEqual([])
  })
})

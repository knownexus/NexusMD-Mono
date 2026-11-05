// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { traceCalls } from './vite-plugin.mjs'

const root = 'C:/repo'
const plugin = () => traceCalls({ root })
const run = (id, code = 'function f() { return 1 }') => plugin().transform(code, id)

describe('traceCalls', () => {
  it('is a pre-stage plugin with a name', () => {
    const p = plugin()
    expect(p.name).toBe('nexusmd-trace-calls')
    expect(p.enforce).toBe('pre')
  })

  it('transforms a repo file and returns a source map', () => {
    const out = run('C:/repo/packages/core/src/a.js')
    expect(out.code).toContain('__nxt.enter(')
    expect(out.map).toBeTruthy()
  })

  it('also transforms .jsx and .mjs, and ignores a query string on the id', () => {
    expect(run('C:/repo/apps/desktop/src/x.jsx?foo=1', 'export function f() { return 1 }').code).toContain('__nxt.enter(')
    expect(run('C:/repo/apps/desktop/src/x.mjs')).toBeTruthy()
  })

  it('skips node_modules, files outside the repo, other file types, virtual modules and the trace package itself', () => {
    expect(run('C:/repo/node_modules/react/index.js')).toBeNull()
    expect(run('C:/elsewhere/a.js')).toBeNull()
    expect(run('C:/repo/src/a.css', 'a { color: red }')).toBeNull()
    expect(run('\0virtual:thing')).toBeNull()
    expect(run('C:/repo/packages/trace/src/runtime.js')).toBeNull()
  })

  it('adds nothing when NEXUSMD_TRACE=0 (a build made to measure what the reports cost)', () => {
    vi.stubEnv('NEXUSMD_TRACE', '0')
    expect(run('C:/repo/packages/core/src/a.js')).toBeNull()
  })

  it('leaves a file with nothing to trace alone', () => {
    expect(run('C:/repo/src/data.js', 'export const x = 1')).toBeNull()
  })
})

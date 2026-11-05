// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createLoggedIpc, argShape } = require('./ipc.cjs')
const { currentCorrelation, runWithCorrelation } = require('./context.cjs')
const { withLogging } = require('../withLogging.cjs')

// A hub that only records what was logged: { mod, scope, level, args }, and (in `corr`, same order) the
// correlation the call was made in.
function fakeHub() {
  const entries = []
  const corr = []
  const make = (mod, scope = null) => {
    const at = level => (...args) => { corr.push(currentCorrelation()); entries.push({ mod, scope, level, args }) }
    return { error: at('error'), warn: at('warn'), info: at('info'), debug: at('debug'), scope: name => make(mod, name) }
  }
  return { entries, corr, logger: mod => make(mod) }
}

function fakeIpc() {
  const handlers = new Map()
  const listeners = []
  return {
    handlers, listeners,
    handle: (ch, fn) => handlers.set(ch, fn),
    handleOnce: (ch, fn) => handlers.set(ch, fn),
    removeHandler: ch => handlers.delete(ch),
    on(ch, fn) { listeners.push([ch, fn]); return this },
    once(ch, fn) { listeners.push([ch, fn]); return this },
    removeListener(ch, fn) { const i = listeners.findIndex(l => l[0] === ch && l[1] === fn); if (i >= 0) listeners.splice(i, 1); return this },
    listenerCount: () => listeners.length,
  }
}

const event = {}
let t = 0
const setup = (moduleId = 'git') => {
  const hub = fakeHub()
  const ipc = fakeIpc()
  const logged = createLoggedIpc(ipc, { hub, moduleId, now: () => t })
  return { hub, ipc, logged }
}

describe('createLoggedIpc', () => {
  it('passes results through untouched', async () => {
    const { ipc, logged } = setup()
    logged.handle('git:status', async (_e, a, b) => `${a}-${b}`)
    logged.handle('git:sync', () => 42)
    expect(await ipc.handlers.get('git:status')(event, 'x', 'y')).toBe('x-y')
    expect(ipc.handlers.get('git:sync')(event)).toBe(42)
  })

  it('logs a rejected handler under its module with the channel and argument shape, then rethrows', async () => {
    const { hub, ipc, logged } = setup('git')
    const err = new Error('rejected')
    logged.handle('git:push', async () => { t += 30; throw err })
    t = 100
    await expect(ipc.handlers.get('git:push')(event, 'origin', { token: 'secret', branch: 'main' }, [1, 2, 3])).rejects.toBe(err)
    expect(hub.entries).toHaveLength(1)
    const [e] = hub.entries
    expect(e).toMatchObject({ mod: 'git', scope: 'ipc:git:push', level: 'error' })
    expect(e.args[0]).toBe('git:push failed')
    expect(e.args[1]).toBe(err)
    expect(e.args[2]).toEqual({ channel: 'git:push', ms: 30, args: ['string', 'object(2)', 'array(3)'] })
    // the content of the arguments is never logged
    expect(JSON.stringify(hub.entries)).not.toContain('secret')
  })

  it('logs a handler that throws synchronously, and sendSync-style listeners too', () => {
    const { hub, ipc, logged } = setup('work')
    logged.handle('work:a', () => { throw new Error('sync boom') })
    logged.on('registry:get', () => { throw new Error('listener boom') })
    expect(() => ipc.handlers.get('work:a')(event)).toThrow('sync boom')
    expect(() => ipc.listeners[0][1](event)).toThrow('listener boom')
    expect(hub.entries.map(e => [e.mod, e.scope, e.level])).toEqual([['work', 'ipc:work:a', 'error'], ['work', 'ipc:registry:get', 'error']])
  })

  it('reports an expected failure as a warning', async () => {
    const { hub, ipc, logged } = setup()
    logged.handle('git:x', async () => { throw Object.assign(new Error('not a repository'), { expected: true }) })
    await ipc.handlers.get('git:x')(event).catch(() => {})
    expect(hub.entries[0].level).toBe('warn')
  })

  it('logs an error once when it passes back through another wrapped handler', async () => {
    const { hub, ipc, logged } = setup('git')
    const outer = createLoggedIpc(ipc, { hub, moduleId: 'core', now: () => t })
    // a module's wrapped handler registered through the shell's wrapped ipcMain
    const inner = createLoggedIpc(outer, { hub, moduleId: 'git', now: () => t })
    inner.handle('git:run', async () => { throw new Error('once only') })
    await expect(ipc.handlers.get('git:run')(event)).rejects.toThrow('once only')
    expect(hub.entries).toHaveLength(1)
    expect(logged).toBeDefined()
  })

  it('runs a handler inside a correlation that names its module, shared with what it calls', async () => {
    const { ipc, logged } = setup('git')
    const seen = []
    logged.handle('git:outer', async () => {
      seen.push(currentCorrelation())
      // later, another module's handler runs inside the same call chain
      const devenv = createLoggedIpc(fakeIpc(), { hub: fakeHub(), moduleId: 'devenv' })
      devenv.handle('devenv:x', async () => { seen.push(currentCorrelation()) })
      await runWithCorrelation(() => seen.push(currentCorrelation()), { mod: 'devenv' })
    })
    await ipc.handlers.get('git:outer')(event)
    expect(seen[0]).toMatchObject({ mod: 'git', path: ['git'] })
    expect(seen[1].cid).toBe(seen[0].cid)
    expect(seen[1].path).toEqual(['git', 'devenv'])
    expect(currentCorrelation()).toBeUndefined()
  })

  it('notes slow calls: a debug line from a second, a warning from ten', async () => {
    const { hub, ipc, logged } = setup()
    logged.handle('git:fast', () => { t += 10 })
    logged.handle('git:slow', async () => { t += 2000 })
    logged.handle('git:stuck', async () => { t += 15000 })
    for (const ch of ['git:fast', 'git:slow', 'git:stuck']) await ipc.handlers.get(ch)(event)
    expect(hub.entries.map(e => [e.args[1]?.channel ?? e.args[0], e.level])).toEqual([['git:slow', 'debug'], ['git:stuck', 'warn']])
  })

  // The point of a correlation id is to follow a call. The failure (and slow-call) lines are logged after the
  // handler has finished, so they must be logged back inside its correlation, or they cannot be followed.
  it('logs a failure under the id of the call that failed, as the first hop, not as one that went through its callees', async () => {
    const { hub, ipc, logged } = setup('core')
    logged.handle('x:run', async () => {
      await runWithCorrelation(async () => { hub.logger('git').error('spawn failed') }, { mod: 'git' })
      throw new Error('boom')
    })
    await expect(ipc.handlers.get('x:run')(event)).rejects.toThrow('boom')
    const inner = hub.entries.findIndex(e => e.mod === 'git')
    const failure = hub.entries.findIndex(e => e.scope === 'ipc:x:run')
    expect(hub.corr[failure]?.cid).toBeTruthy()
    expect(hub.corr[failure].cid).toBe(hub.corr[inner].cid)
    expect(hub.corr[inner].path).toEqual(['core', 'git'])
    expect(hub.corr[failure].path).toEqual(['core'])   // it is core's own line: not "via git"
    expect(currentCorrelation()).toBeUndefined()        // and nothing leaks out of the call
  })

  it('does the same for a handler that throws synchronously', () => {
    const { hub, ipc, logged } = setup('core')
    let inside
    logged.handle('x:sync', () => { inside = currentCorrelation().cid; throw new Error('sync boom') })
    expect(() => ipc.handlers.get('x:sync')(event)).toThrow('sync boom')
    const failure = hub.entries.findIndex(e => e.scope === 'ipc:x:sync')
    expect(hub.corr[failure]?.cid).toBe(inside)
  })

  it('and for the slow-call note', async () => {
    t = 0
    const { hub, ipc, logged } = setup('core')
    let inside
    logged.handle('x:slow', async () => { inside = currentCorrelation().cid; t += 11000; return 1 })
    await ipc.handlers.get('x:slow')(event)
    const slow = hub.entries.findIndex(e => e.level === 'warn' && e.scope === 'ipc:x:slow')
    expect(hub.corr[slow]?.cid).toBe(inside)
    t = 0
  })

  it('removes a listener by the function the app registered', () => {
    const { ipc, logged } = setup()
    const fn = () => {}
    logged.on('x:changed', fn)
    expect(ipc.listeners).toHaveLength(1)
    logged.removeListener('x:changed', fn)
    expect(ipc.listeners).toHaveLength(0)
  })

  it('hands everything else to the real ipcMain, and says it logs', () => {
    const { ipc, logged } = setup()
    logged.handle('a', () => {})
    expect(logged.__logged).toBe(true)
    expect(logged.listenerCount()).toBe(0)
    logged.removeHandler('a')
    expect(ipc.handlers.has('a')).toBe(false)
  })

  it('describes arguments without their content', () => {
    expect(argShape(['s', 1, null, undefined, [1, 2], { a: 1 }, new Uint8Array(4), true])).toEqual(['string', 'number', 'null', 'undefined', 'array(2)', 'object(1)', 'binary(4)', 'boolean'])
  })
})

describe('withLogging on an ipcMain that already logs', () => {
  it('does not wrap again, so an error is not logged twice', async () => {
    const { hub, ipc, logged } = setup('editor')
    const logger = { scope: () => ({ error: () => { throw new Error('should not be used') } }) }
    withLogging(logged, logger)('editor:save', async () => { throw new Error('disk full') })
    await expect(ipc.handlers.get('editor:save')(event)).rejects.toThrow('disk full')
    expect(hub.entries).toHaveLength(1)
  })

  it('still logs for a plain ipcMain', async () => {
    const ipc = fakeIpc()
    const calls = []
    const logger = { scope: ch => ({ error: err => calls.push([ch, err.message]) }) }
    withLogging(ipc, logger)('x:y', async () => { throw new Error('plain') })
    await expect(ipc.handlers.get('x:y')(event)).rejects.toThrow('plain')
    expect(calls).toEqual([['x:y', 'plain']])
  })
})

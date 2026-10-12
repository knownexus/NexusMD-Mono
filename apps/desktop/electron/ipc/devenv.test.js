// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { register, buildInvocation, lineSplitter } from './devenv.cjs'

const CONFIG = { root: 'C:\\Program Files\\dev env', pwsh: 'pwsh', profile: '' }

function fakeChild(pid = 4242) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() }
  child.pid = pid
  child.finish = code => { child.stdout.end(); child.stderr.end(); setImmediate(() => child.emit('close', code)) }
  return child
}

function setup(extra = {}) {
  const handlers = {}
  const children = []
  const sent = []
  const logged = []
  const deps = {
    spawn: vi.fn(() => { const c = fakeChild(4242 + children.length); children.push(c); return c }),
    kill: vi.fn(async () => {}),
    send: (channel, msg) => sent.push({ channel, msg }),
    shell: { openExternal: vi.fn(async () => {}), openPath: vi.fn(async () => '') },
    fileExists: () => true,
    logger: { scope: () => ({ error: (...a) => logged.push(a), info: () => {} }) },
    ...extra,
  }
  const api = register({ handle: (c, fn) => { handlers[c] = fn } }, deps)
  return { handlers, children, sent, logged, deps, api }
}

const tick = () => new Promise(r => setImmediate(r))

describe('buildInvocation', () => {
  it('runs devenv.ps1 hidden, non-interactive, with argv as separate args (spaces safe)', () => {
    const inv = buildInvocation(CONFIG, ['test', 'run', 'C:\\My Tests\\a b'], () => true)
    expect(inv.command).toBe('pwsh')
    expect(inv.args).toEqual(['-NoProfile', '-NonInteractive', '-File', 'C:\\Program Files\\dev env\\devenv.ps1', 'test', 'run', 'C:\\My Tests\\a b'])
    expect(inv.options.windowsHide).toBe(true)
    expect(inv.options.shell).toBeUndefined()
    expect(inv.options.env.DEVENV_HOST).toBe('nexusmd')
    expect(inv.options.env.DEVENV_PROFILE).toBeUndefined()
  })
  it('passes the profile folder through DEVENV_PROFILE', () => {
    expect(buildInvocation({ ...CONFIG, profile: 'D:\\prof' }, [], () => true).options.env.DEVENV_PROFILE).toBe('D:\\prof')
  })
  it('refuses a relative or missing devenv folder and non-string args', () => {
    expect(() => buildInvocation({ root: 'dev' }, [], () => true)).toThrow(/absolute/)
    expect(() => buildInvocation(CONFIG, [], () => false)).toThrow(/No devenv\.ps1/)
    expect(() => buildInvocation(CONFIG, [1], () => true)).toThrow(/strings/)
  })
})

describe('lineSplitter', () => {
  it('reassembles lines split across chunks, strips CR, flushes the tail', () => {
    const lines = []
    const s = lineSplitter(l => lines.push(l))
    s.push(Buffer.from('one\r\ntw'))
    s.push(Buffer.from('o\nthree'))
    s.end()
    expect(lines).toEqual(['one', 'two', 'three'])
  })
  it('keeps multi-byte characters split across chunks intact', () => {
    const lines = []
    const s = lineSplitter(l => lines.push(l))
    const bytes = Buffer.from('── [1/3] Build —\n')
    s.push(bytes.subarray(0, 2))
    s.push(bytes.subarray(2))
    s.end()
    expect(lines).toEqual(['── [1/3] Build —'])
  })
})

describe('devenv ipc', () => {
  let t
  beforeEach(() => { t = setup() })

  it('streams lines and the exit code for a run', async () => {
    const { runId } = await t.handlers['devenv:run'](null, CONFIG, ['status'], { exclusive: false })
    const c = t.children[0]
    c.stdout.write('hello\n')
    c.stderr.write('warn\n')
    c.finish(0)
    await tick(); await tick()
    expect(t.sent).toEqual([
      { channel: 'devenv:line', msg: { runId, stream: 'stdout', line: 'hello' } },
      { channel: 'devenv:line', msg: { runId, stream: 'stderr', line: 'warn' } },
      { channel: 'devenv:exit', msg: { runId, code: 0, cancelled: false } },
    ])
  })

  it('refuses a second exclusive run but allows read-only ones alongside', async () => {
    await t.handlers['devenv:run'](null, CONFIG, ['start'], { exclusive: true, label: 'start' })
    await expect(t.handlers['devenv:run'](null, CONFIG, ['stop'], { exclusive: true })).rejects.toThrow(/still running "start"/)
    await expect(t.handlers['devenv:run'](null, CONFIG, ['status'], { exclusive: false })).resolves.toHaveProperty('runId')
  })

  it('active lists runs still alive, so a reloaded window can find them', async () => {
    expect(await t.handlers['devenv:active'](null)).toEqual([])
    const a = await t.handlers['devenv:run'](null, CONFIG, ['start'], { exclusive: true, label: 'devenv start' })
    const b = await t.handlers['devenv:run'](null, CONFIG, ['status'], { exclusive: false })
    expect(await t.handlers['devenv:active'](null)).toEqual([
      { runId: a.runId, label: 'devenv start', exclusive: true },
      { runId: b.runId, label: 'status', exclusive: false },
    ])
    t.children[0].finish(0)
    await tick(); await tick()
    expect(await t.handlers['devenv:active'](null)).toEqual([{ runId: b.runId, label: 'status', exclusive: false }])
  })

  it('frees the exclusive slot when the run exits', async () => {
    await t.handlers['devenv:run'](null, CONFIG, ['start'], { exclusive: true })
    t.children[0].finish(1)
    await tick(); await tick()
    await expect(t.handlers['devenv:run'](null, CONFIG, ['stop'], { exclusive: true })).resolves.toHaveProperty('runId')
  })

  it('writes answers as one JSON line and never logs them', async () => {
    const { runId } = await t.handlers['devenv:run'](null, CONFIG, ['build', 'ios', '--password'], {})
    await t.handlers['devenv:answer'](null, runId, { id: 'p1', value: 'hunter22' })
    expect(t.children[0].stdin.write).toHaveBeenCalledWith('{"id":"p1","value":"hunter22"}\n')
    await t.handlers['devenv:answer'](null, runId, { id: 'p2', cancel: true })
    expect(t.children[0].stdin.write).toHaveBeenLastCalledWith('{"id":"p2","cancel":true}\n')
    expect(JSON.stringify(t.logged)).not.toContain('hunter22')
  })

  it('cancel kills the process tree and the exit is marked cancelled', async () => {
    const { runId } = await t.handlers['devenv:run'](null, CONFIG, ['start'], {})
    await t.handlers['devenv:cancel'](null, runId)
    expect(t.deps.kill).toHaveBeenCalledWith(4242)
    t.children[0].finish(1)
    await tick(); await tick()
    expect(t.sent.at(-1)).toEqual({ channel: 'devenv:exit', msg: { runId, code: 1, cancelled: true } })
  })

  it('reports a pwsh that cannot start as a stderr line and exit -1', async () => {
    const { runId } = await t.handlers['devenv:run'](null, { ...CONFIG, pwsh: 'C:\\nope\\pwsh.exe' }, ['status'], {})
    t.children[0].emit('error', new Error('spawn ENOENT'))
    expect(t.sent).toEqual([
      { channel: 'devenv:line', msg: { runId, stream: 'stderr', line: "Couldn't start C:\\nope\\pwsh.exe: spawn ENOENT" } },
      { channel: 'devenv:exit', msg: { runId, code: -1, cancelled: false } },
    ])
  })

  it('catalog runs help --json privately and returns the catalog message', async () => {
    const p = t.handlers['devenv:catalog'](null, CONFIG)
    await tick()
    expect(t.deps.spawn.mock.calls[0][1].slice(-2)).toEqual(['help', '--json'])
    t.children[0].stdout.write('@@devenv {"type":"result","kind":"catalog","protocol":1,"commands":[]}\n')
    t.children[0].finish(0)
    await expect(p).resolves.toEqual({ type: 'result', kind: 'catalog', protocol: 1, commands: [] })
    expect(t.sent).toEqual([])
  })

  it('catalog explains a devenv without help --json', async () => {
    const p = t.handlers['devenv:catalog'](null, CONFIG)
    await tick()
    t.children[0].stdout.write('devenv - local environment\n')
    t.children[0].finish(0)
    await expect(p).rejects.toThrow(/didn't return its command list/)
  })

  it('opens only http(s) URLs and existing absolute paths', async () => {
    await t.handlers['devenv:open'](null, { url: 'http://127.0.0.1:5280/?token=x' })
    expect(t.deps.shell.openExternal).toHaveBeenCalledWith('http://127.0.0.1:5280/?token=x')
    await expect(t.handlers['devenv:open'](null, { url: 'file:///C:/x' })).rejects.toThrow(/http/)
    await t.handlers['devenv:open'](null, { path: 'C:\\r\\trace.html' })
    expect(t.deps.shell.openPath).toHaveBeenCalledWith('C:\\r\\trace.html')
    await expect(t.handlers['devenv:open'](null, { path: 'rel\\x.html' })).rejects.toThrow(/Not found/)
  })

  it('refuses to open executables and scripts, but opens folders and reports', async () => {
    const t2 = setup({ isDirectory: p => p === 'C:\\r\\folder' })
    await t2.handlers['devenv:open'](null, { path: 'C:\\r\\TRACE.HTML' })
    expect(t2.deps.shell.openPath).toHaveBeenCalledWith('C:\\r\\TRACE.HTML')
    await t2.handlers['devenv:open'](null, { path: 'C:\\r\\folder' })
    expect(t2.deps.shell.openPath).toHaveBeenCalledWith('C:\\r\\folder')
    await expect(t2.handlers['devenv:open'](null, { path: 'C:\\tools\\evil.exe' })).rejects.toThrow(/Refusing to open/)
    await expect(t2.handlers['devenv:open'](null, { path: 'C:\\tools\\x.ps1' })).rejects.toThrow(/Refusing to open/)
    expect(t2.deps.shell.openPath).toHaveBeenCalledTimes(2)
  })

  it('catalog times out, kills the process and rejects', async () => {
    const t2 = setup({ catalogTimeoutMs: 10 })
    await expect(t2.handlers['devenv:catalog'](null, CONFIG)).rejects.toThrow(/took too long to list its commands/)
    expect(t2.deps.kill).toHaveBeenCalledWith(4242)
  })

  it('disposeAll also kills a pending catalog process', async () => {
    const p = t.handlers['devenv:catalog'](null, CONFIG).catch(() => {})
    await tick()
    await t.api.disposeAll()
    expect(t.deps.kill).toHaveBeenCalledWith(4242)
    t.children[0].finish(0)
    await p
  })

  it('finishes a run after exit even if close never fires', async () => {
    const t2 = setup({ exitGraceMs: 10 })
    const { runId } = await t2.handlers['devenv:run'](null, CONFIG, ['start'], { exclusive: true })
    t2.children[0].emit('exit', 3)
    expect(t2.sent).toEqual([])
    await new Promise(r => setTimeout(r, 40))
    expect(t2.sent).toEqual([{ channel: 'devenv:exit', msg: { runId, code: 3, cancelled: false } }])
    await expect(t2.handlers['devenv:run'](null, CONFIG, ['stop'], { exclusive: true })).resolves.toHaveProperty('runId')
  })

  it('does not log answer secrets when an answer is rejected', async () => {
    const { runId } = await t.handlers['devenv:run'](null, CONFIG, ['start'], {})
    t.children[0].finish(0)
    await tick(); await tick()
    await expect(t.handlers['devenv:answer'](null, runId, { id: 'p1', value: 'hunter22' })).rejects.toThrow(/already finished/)
    expect(t.logged.length).toBeGreaterThan(0)
    expect(JSON.stringify(t.logged)).not.toContain('hunter22')
  })

  it('tolerates missing run options', async () => {
    await expect(t.handlers['devenv:run'](null, CONFIG, ['status'])).resolves.toHaveProperty('runId')
  })

  it('disposeAll kills every running process', async () => {
    await t.handlers['devenv:run'](null, CONFIG, ['start'], { exclusive: true })
    await t.handlers['devenv:run'](null, CONFIG, ['status'], { exclusive: false })
    await t.api.disposeAll()
    expect(t.deps.kill).toHaveBeenCalledTimes(2)
  })

  it('query runs status --json privately and returns its result messages', async () => {
    const p = t.handlers['devenv:query'](null, CONFIG, ['status', '--json'])
    await tick()
    expect(t.deps.spawn.mock.calls[0][1].slice(-2)).toEqual(['status', '--json'])
    t.children[0].stdout.write('@@devenv {"type":"result","kind":"status","docker":{"ok":true}}\nplain\n')
    t.children[0].finish(0)
    await expect(p).resolves.toEqual({ code: 0, results: [{ type: 'result', kind: 'status', docker: { ok: true } }], stderr: '' })
    expect(t.sent).toEqual([])
  })

  it('query is allowed while an exclusive run holds the slot', async () => {
    await t.handlers['devenv:run'](null, CONFIG, ['start'], { exclusive: true, label: 'start' })
    const p = t.handlers['devenv:query'](null, CONFIG, ['status', '--json'])
    await tick()
    t.children[1].finish(0)
    await expect(p).resolves.toHaveProperty('code', 0)
  })

  it('query refuses anything but status --json', async () => {
    await expect(t.handlers['devenv:query'](null, CONFIG, ['stop'])).rejects.toThrow(/Not a devenv query/)
    await expect(t.handlers['devenv:query'](null, CONFIG, ['status'])).rejects.toThrow(/Not a devenv query/)
    expect(t.deps.spawn).not.toHaveBeenCalled()
  })
})

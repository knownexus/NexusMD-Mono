import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createVirtualFs } from './api-file.js'
import { runScriptSource, createScriptRunner } from './api-script-runner.js'
import { createApiHttpAdapter } from './api-http.js'
import { createCollection, loadCollection, writeRequest, appendHistoryEntry, readHistory } from '@nexusmd/core'

describe('virtual file system', () => {
  let fs
  beforeEach(() => { localStorage.clear(); fs = createVirtualFs(localStorage) })

  it('reads back what it writes and lists direct children only', async () => {
    await fs.write('col/requests/a.json', '{}')
    await fs.write('col/requests/b.json', '{}')
    await fs.write('col/collection.json', '{}')
    expect(await fs.read('col/requests/a.json')).toBe('{}')
    expect(await fs.list('col/requests')).toEqual(['a.json', 'b.json'])
    expect(await fs.list('col')).toEqual(['collection.json', 'requests'])
    expect(await fs.exists('col/requests')).toBe(true)
    expect(await fs.exists('col/nope.json')).toBe(false)
  })

  it('deletes a file or a whole directory', async () => {
    await fs.write('col/requests/a.json', '1')
    await fs.write('col/requests/b.json', '2')
    await fs.delete('col/requests/a.json')
    expect(await fs.list('col/requests')).toEqual(['b.json'])
    await fs.delete('col')
    expect(await fs.exists('col')).toBe(false)
  })

  it('errors on a missing file or directory', async () => {
    await expect(fs.read('x/y.json')).rejects.toThrow(/ENOENT/)
    await expect(fs.list('x')).rejects.toThrow(/ENOENT/)
  })

  it('is enough for the core collection store', async () => {
    await createCollection(fs, 'My API', { name: 'My API' })
    await writeRequest(fs, 'My API', 'r1', { method: 'GET', url: 'https://x.test' })
    const col = await loadCollection(fs, 'My API')
    expect(Object.keys(col.requests)).toEqual(['r1'])
    await appendHistoryEntry(fs, 'My API', 'r1', { status: 200 })
    expect(await readHistory(fs, 'My API', 'r1')).toHaveLength(1)
  })
})

describe('script runner', () => {
  const run = (script, ctx = {}) => runScriptSource(script, JSON.stringify(ctx))

  it('lets a script mutate the context', () => {
    const r = run('context.vars.token = context.response.body + "!"', { vars: {}, response: { body: 'hi' } })
    expect(r.error).toBeNull()
    expect(r.context.vars.token).toBe('hi!')
  })

  it('reports script errors', () => {
    expect(run('throw new Error("boom")').error).toBe('boom')
  })

  it('removes network globals', () => {
    expect(run('context.f = typeof fetch', {}).context.f).toBe('undefined')
  })

  it('times out a worker that never answers and disposes it', async () => {
    const dispose = vi.fn()
    const runner = createScriptRunner({
      timeoutMs: 20,
      createWorker: () => ({ worker: { postMessage() {}, set onmessage(_) {}, set onerror(_) {} }, dispose }),
    })
    expect((await runner.run('while(true){}', {})).error).toBe('Script timed out')
    expect(dispose).toHaveBeenCalled()
  })

  it('returns the worker result', async () => {
    const runner = createScriptRunner({
      createWorker: () => {
        const worker = { postMessage: (m) => queueMicrotask(() => worker.onmessage({ data: runScriptSource(m.script, m.contextJson) })) }
        return { worker, dispose() {} }
      },
    })
    const r = await runner.run('context.n = 2', { n: 1 })
    expect(r.context.n).toBe(2)
  })
})

describe('api http adapter', () => {
  it('sends the request as given and exposes the body as text', async () => {
    const request = vi.fn().mockResolvedValue({ status: 201, data: '{"ok":true}', headers: { 'content-type': 'application/json' } })
    const r = await createApiHttpAdapter({ request }).fetch('https://x.test/a', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}',
    })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://x.test/a', method: 'POST', data: { a: 1 }, responseType: 'text' }))
    expect(r.status).toBe(201)
    expect(await r.text()).toBe('{"ok":true}')
  })

  it('sends non-JSON bodies untouched', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, data: '', headers: {} })
    await createApiHttpAdapter({ request }).fetch('https://x.test', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'a=1' })
    expect(request.mock.calls[0][0].data).toBe('a=1')
  })
})

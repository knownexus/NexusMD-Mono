import { describe, it, expect, vi } from 'vitest'
import { createOpenHandler } from './open-files.js'

// Files the desktop app is opened with, routed as on Android: Markdown and JSON become documents in the Documents app, anything
// else opens in the Editor. Documents is a separate app that may not be installed, so it is used only when it offers documents.openFile.
function setup({ documents = true, files = {}, take } = {}) {
  const calls = []
  const capabilities = {
    has: name => documents && name === 'documents.openFile',
    call: vi.fn(async (name, file) => { calls.push(file); if (take) return take(file); return { tool: 'markdown', created: true } }),
  }
  const store = { openPath: vi.fn(async () => true) }
  const api = {
    stat: vi.fn(async p => (p in files ? { exists: true, kind: files[p].kind ?? 'file' } : { exists: false })),
    read: vi.fn(async p => ({ path: p, text: files[p].text })),
  }
  const host = { capabilities, navigate: vi.fn() }
  const notify = vi.fn()
  return { open: createOpenHandler({ store, api, host, notify }), store, api, host, notify, capabilities, calls }
}
const settled = () => new Promise(r => setTimeout(r, 0))

describe('routing the files the desktop app is opened with', () => {
  it('sends a Markdown file to Documents as a copy, not to the Editor', async () => {
    const t = setup({ files: { 'C:\\n\\plan.md': { text: '# Plan' } } })
    t.open(['C:\\n\\plan.md'])
    await settled()
    expect(t.calls).toEqual([{ name: 'plan.md', text: '# Plan' }])
    expect(t.store.openPath).not.toHaveBeenCalled()
    expect(t.host.navigate).not.toHaveBeenCalledWith('editor')
    expect(t.notify).toHaveBeenCalledWith('Opened plan.md', 'success')
  })

  it('sends a JSON file to Documents too, whether or not it parses', async () => {
    const t = setup({ files: { '/n/a.json': { text: '{"broken":' } } })
    t.open(['/n/a.json'])
    await settled()
    expect(t.calls).toEqual([{ name: 'a.json', text: '{"broken":' }])
    expect(t.store.openPath).not.toHaveBeenCalled()
  })

  it('opens every other file in the Editor and shows it, straight away', () => {
    const t = setup()
    t.open(['/n/a.ts', '/n/b.txt', '/n/c.md.bak', '/n/d.jsonc'])
    expect(t.store.openPath.mock.calls.map(c => c[0])).toEqual(['/n/a.ts', '/n/b.txt', '/n/c.md.bak', '/n/d.jsonc'])
    expect(t.host.navigate).toHaveBeenCalledWith('editor')
    expect(t.capabilities.call).not.toHaveBeenCalled()
  })

  it('routes each file of a mixed set on its own', async () => {
    const t = setup({ files: { '/n/a.md': { text: 'a' }, '/n/b.json': { text: '{}' } } })
    t.open(['/n/a.md', '/n/x.js', '/n/b.json'])
    await settled()
    expect(t.calls.map(c => c.name)).toEqual(['a.md', 'b.json'])
    expect(t.store.openPath.mock.calls.map(c => c[0])).toEqual(['/n/x.js'])
    expect(t.host.navigate).toHaveBeenCalledWith('editor')
  })

  it('falls back to the Editor when the Documents app is not installed', () => {
    const t = setup({ documents: false })
    t.open(['/n/a.md', '/n/b.json'])
    expect(t.store.openPath.mock.calls.map(c => c[0])).toEqual(['/n/a.md', '/n/b.json'])
    expect(t.host.navigate).toHaveBeenCalledWith('editor')
  })

  it('opens a folder whose name ends in .md or .json in the Editor, not as a document', async () => {
    const t = setup({ files: { '/n/docs.md': { kind: 'dir' } } })
    t.open(['/n/docs.md'])
    await settled()
    expect(t.store.openPath).toHaveBeenCalledWith('/n/docs.md')
    expect(t.capabilities.call).not.toHaveBeenCalled()
    expect(t.host.navigate).toHaveBeenCalledWith('editor')
  })

  it('says why when a file could not be taken, and does not open it in the Editor', async () => {
    const t = setup({ files: { '/n/big.md': { text: 'x' } }, take: () => { throw new Error('That file is too large to open here (the limit is 2 MB).') } })
    t.open(['/n/big.md'])
    await settled()
    expect(t.notify).toHaveBeenCalledWith('That file is too large to open here (the limit is 2 MB).', 'error')
    expect(t.store.openPath).not.toHaveBeenCalled()
  })

  it('says so when the file cannot be read', async () => {
    const t = setup({ files: { '/n/a.md': { text: 'x' } } })
    t.api.read.mockRejectedValue(new Error('EACCES: permission denied'))
    t.open(['/n/a.md'])
    await settled()
    expect(t.notify).toHaveBeenCalledWith(expect.stringContaining('a.md'), 'error')
    expect(t.notify.mock.calls[0][0]).toMatch(/permission denied/)
  })
})

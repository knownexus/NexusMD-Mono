// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import Module from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { saveArtifact, sanitizeFilename, register, netRequest } = require('./artifacts.cjs')

const ADO_URL = 'https://dev.azure.com/acme/P/_apis/build/builds/1/artifacts?artifactName=drop&api-version=7.0&%24format=zip'
const GH_URL = 'https://api.github.com/repos/o/r/actions/artifacts/9/zip'
const ado = { item: { provider: 'ado', url: ADO_URL, filename: 'drop.zip' }, credentials: { org: 'acme', pat: 'adopat' } }
const gh = { item: { provider: 'github', url: GH_URL, filename: 'web.zip' }, credentials: { pat: 'ghpat' } }

const body = (text) => Readable.from([Buffer.from(text)])
const reply = (status, { text = '', location } = {}) => ({ status, location, body: body(text) })

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-artifacts-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

function deps({ request, canceled = false, file = 'out.zip' } = {}) {
  const target = path.join(dir, file)
  return {
    target,
    dialog: { showSaveDialog: vi.fn(async () => (canceled ? { canceled: true, filePath: '' } : { canceled: false, filePath: target })) },
    request: request || vi.fn(async () => reply(200, { text: 'ZIP' })),
    getWin: () => null,
  }
}

describe('artifacts:save', () => {
  it('saveArtifact sends the Authorization header for ADO and GitHub items and returns { saved:false } when the dialog is cancelled', async () => {
    const a = deps()
    expect(await saveArtifact(ado, a)).toEqual({ saved: true, path: a.target, bytes: 3 })
    expect(a.request).toHaveBeenCalledWith(ADO_URL, expect.objectContaining({ Authorization: 'Basic ' + btoa(':adopat') }))
    expect(fs.readFileSync(a.target, 'utf8')).toBe('ZIP')

    const g = deps({ file: 'gh.zip' })
    expect(await saveArtifact(gh, g)).toEqual({ saved: true, path: g.target, bytes: 3 })
    expect(g.request).toHaveBeenCalledWith(GH_URL, expect.objectContaining({
      Authorization: 'Bearer ghpat', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
    }))

    const c = deps({ canceled: true })
    expect(await saveArtifact(gh, c)).toEqual({ saved: false })
    expect(c.request).not.toHaveBeenCalled()
  })

  it('drops the Authorization header when the provider redirects to another host', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(reply(302, { location: 'https://pipelines.actions.githubusercontent.com/blob?sig=x' }))
      .mockResolvedValueOnce(reply(200, { text: 'BLOB' }))
    const d = deps({ request })
    expect(await saveArtifact(gh, d)).toMatchObject({ saved: true, bytes: 4 })
    expect(request.mock.calls[0][1].Authorization).toBe('Bearer ghpat')
    expect(request.mock.calls[1]).toEqual(['https://pipelines.actions.githubusercontent.com/blob?sig=x', {}])
  })

  it('refuses a redirect to plain http', async () => {
    const request = vi.fn().mockResolvedValueOnce(reply(302, { location: 'http://example.com/x' }))
    const d = deps({ request })
    await expect(saveArtifact(gh, d)).rejects.toThrow(/https/)
    expect(request).toHaveBeenCalledTimes(1)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('throws on a non-2xx answer and writes nothing', async () => {
    const d = deps({ request: vi.fn(async () => reply(404, { text: '<html>Not found</html>' })) })
    await expect(saveArtifact(ado, d)).rejects.toThrow('HTTP 404')
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('keeps an existing file when the download fails part-way', async () => {
    const broken = new Readable({ read() { this.push('par'); this.destroy(new Error('reset')) } })
    const d = deps({ request: vi.fn(async () => ({ status: 200, body: broken })) })
    fs.writeFileSync(d.target, 'OLD')
    await expect(saveArtifact(ado, d)).rejects.toThrow('reset')
    expect(fs.readdirSync(dir)).toEqual(['out.zip'])
    expect(fs.readFileSync(d.target, 'utf8')).toBe('OLD')
  })

  it('offers a sanitised file name in the save dialog', async () => {
    const d = deps()
    await saveArtifact({ ...ado, item: { ...ado.item, filename: '..\\..\\evil/na\u0000me\u001f.zip' } }, d)
    const opts = d.dialog.showSaveDialog.mock.calls[0].at(-1)
    expect(path.basename(opts.defaultPath)).toBe(opts.defaultPath)
    expect(opts.defaultPath).toBe('evil_name.zip')
    expect(sanitizeFilename('a/b\\c:d.zip')).toBe('a_b_c_d.zip')
    expect(sanitizeFilename('')).toBe('artifact.zip')
    expect(sanitizeFilename('...')).toBe('artifact.zip')
    expect(sanitizeFilename('x'.repeat(300) + '.zip')).toMatch(/^x+\.zip$/)
    expect(sanitizeFilename('x'.repeat(300) + '.zip').length).toBeLessThanOrEqual(120)
  })

  it('only sends a token to the provider\'s own https API host, and asks nothing otherwise', async () => {
    for (const url of [
      'https://evil.example/acme/x',               // another host
      'https://dev.azure.com/other-org/P/x',       // another ADO org
      'http://dev.azure.com/acme/P/x',             // not https
      'https://dev.azure.com.evil.example/acme/x', // look-alike host
    ]) {
      const d = deps()
      await expect(saveArtifact({ ...ado, item: { ...ado.item, url } }, d)).rejects.toThrow(/Not a build artifact URL/)
      expect(d.dialog.showSaveDialog).not.toHaveBeenCalled()
      expect(d.request).not.toHaveBeenCalled()
    }
    // The ADO token can't be pointed at GitHub (or the other way round).
    const d = deps()
    await expect(saveArtifact({ ...ado, item: { ...ado.item, url: GH_URL } }, d)).rejects.toThrow(/Not a build artifact URL/)
    await expect(saveArtifact({ item: { provider: 'jira', url: GH_URL, filename: 'x.zip' }, credentials: { pat: 'p' } }, d)).rejects.toThrow()
  })

  it('takes only the item and the provider\'s token from the renderer, never headers', async () => {
    const d = deps()
    await saveArtifact({ ...gh, headers: { Cookie: 'x' }, item: { ...gh.item, headers: { 'X-Evil': '1' } } }, d)
    const sent = d.request.mock.calls[0][1]
    expect(Object.keys(sent).sort()).toEqual(['Accept', 'Authorization', 'X-GitHub-Api-Version'])
  })

  it('asks electron\'s net not to follow redirects or send cookies, and answers a redirect with its address', async () => {
    const reqs = []
    const fakeNet = {
      request: vi.fn((opts) => {
        const r = new EventEmitter()
        r.opts = opts; r.headers = {}
        r.setHeader = (k, v) => { r.headers[k] = v }
        r.abort = vi.fn()
        r.end = () => setImmediate(() => r.emit('redirect', 302, 'GET', 'https://blob.example/x', {}))
        reqs.push(r)
        return r
      }),
    }
    const origRequire = Module.prototype.require
    Module.prototype.require = function (id) {
      if (id === 'electron') return { net: fakeNet }
      return origRequire.apply(this, arguments)
    }
    try {
      expect(await netRequest(GH_URL, { Authorization: 'Bearer t' })).toEqual({ status: 302, location: 'https://blob.example/x' })
    } finally { Module.prototype.require = origRequire }
    expect(reqs[0].opts).toMatchObject({ url: GH_URL, method: 'GET', redirect: 'manual', credentials: 'omit', useSessionCookies: false })
    expect(reqs[0].headers).toEqual({ Authorization: 'Bearer t' })
    expect(reqs[0].abort).toHaveBeenCalled()
  })

  it('registers the artifacts:save channel', async () => {
    const handlers = {}
    const d = deps()
    register({ handle: (channel, fn) => { handlers[channel] = fn } }, () => null, d)
    expect(await handlers['artifacts:save']({}, ado)).toMatchObject({ saved: true })
  })
})

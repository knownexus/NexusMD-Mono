// The production bundle is what the WebView loads from the app's assets. If it points at a file
// that is not there, or at a dev server, the app opens to a blank page on a phone while every
// other test (which runs from source) stays green. So build it for real and check it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { build } from 'vite'
import { workerSource } from './adapters/api-script-runner.js'

const APP = path.resolve(import.meta.dirname, '..')
let out
let html
const files = dir => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter(e => e.isFile()).map(e => path.join(e.parentPath ?? e.path, e.name))

describe('production bundle', () => {
  beforeAll(async () => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-app-build-'))
    await build({ root: APP, logLevel: 'silent', build: { outDir: out, emptyOutDir: true } })
    html = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
  }, 120000)

  afterAll(() => { if (out) fs.rmSync(out, { recursive: true, force: true }) })

  it('has an index.html with the root element and an entry script', () => {
    expect(html).toContain('id="root"')
    expect(html).toMatch(/<script type="module"[^>]*src="[^"]+\.js"/)
  })

  it('loads every asset index.html names', () => {
    const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map(m => m[1]).filter(r => !r.startsWith('//'))
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) expect([ref, fs.existsSync(path.join(out, ref))]).toEqual([ref, true])
  })

  it('has every chunk the code imports', () => {
    const missing = []
    for (const file of files(out).filter(f => f.endsWith('.js'))) {
      const code = fs.readFileSync(file, 'utf8')
      for (const m of code.matchAll(/(?:from\s*|import\s*\(\s*)["'](\.{1,2}\/[^"']+\.(?:js|css))["']/g)) {
        const target = path.resolve(path.dirname(file), m[1])
        if (!fs.existsSync(target)) missing.push(`${path.relative(out, file)} -> ${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('does not point at a dev server', () => {
    const hits = []
    for (const file of files(out).filter(f => /\.(js|html|css)$/.test(f))) {
      const code = fs.readFileSync(file, 'utf8')
      if (/(?:https?:)?\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)[:/]/.test(code)) hits.push(path.relative(out, file))
    }
    expect(hits).toEqual([])
  })

  it('does not rely on the Vite dev client', () => {
    for (const file of files(out).filter(f => f.endsWith('.js'))) {
      expect(fs.readFileSync(file, 'utf8')).not.toContain('/@vite/client')
    }
  })
})

describe('script runner worker', () => {
  // The worker is a text program built from a function's source, so anything that function reaches
  // outside itself (a helper, an import) would be missing there. Run the real text in an isolated
  // context standing in for the worker scope.
  const runInWorker = (script, context) => {
    const posted = []
    const sandbox = vm.createContext({ self: { postMessage: m => posted.push(m) } })
    vm.runInContext(workerSource(), sandbox)
    sandbox.self.onmessage({ data: { script, contextJson: JSON.stringify(context) } })
    return posted[0]
  }

  it('runs a script and returns the context', () => {
    expect(runInWorker('context.vars.n = context.vars.n + 1', { vars: { n: 1 } })).toMatchObject({ context: { vars: { n: 2 } }, error: null })
  })

  it('reports a script error instead of throwing', () => {
    expect(runInWorker('throw new Error("nope")', {})).toMatchObject({ context: null, error: 'nope' })
  })

  it('does not depend on anything outside its own source', () => {
    // Free variables would only fail inside a real worker; here they would throw a ReferenceError.
    expect(runInWorker('context.ok = true', {}).error).toBeNull()
    expect(workerSource()).not.toMatch(/\bimport\b|\brequire\(/)
  })
})

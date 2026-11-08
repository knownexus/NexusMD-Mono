// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { build } from 'vite'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// `npm run build:renderer`, which the Mac and Linux releases and the end-to-end tests start from, builds the whole desktop as one
// page. Vite reads every chunk that holds an import() with a WebAssembly lexer (es-module-lexer) that stops at about 4 million
// characters ("WebAssembly.Memory.grow(): Maximum memory size exceeded"). The page's one chunk was 4.4 million, which only
// mattered once the Editor's Prettify code added import() calls, so the build broke on Node 20, 22 and 26 alike.
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'nexusmd-renderer-'))
afterAll(() => rmSync(out, { recursive: true, force: true }))

describe('the desktop renderer build', () => {
  it('builds, keeps every chunk well under the size Vite can read, and keeps the formatters out of the first load', async () => {
    await build({ root: desktop, configFile: join(desktop, 'vite.config.js'), logLevel: 'silent', build: { outDir: out, emptyOutDir: true } })
    const assets = join(out, 'assets')
    const chunks = readdirSync(assets).filter(f => f.endsWith('.js'))
    const chars = Object.fromEntries(chunks.map(f => [f, readFileSync(join(assets, f), 'utf8').length]))

    // The limit is about 4.2 million characters; staying under 3 million leaves room to grow before it bites again.
    expect(Math.max(...Object.values(chars)), JSON.stringify(chars)).toBeLessThan(3_000_000)

    // Prettier's TypeScript plugin is the largest formatter. It loads when someone first taps Prettify on a .ts file, so it
    // must be a chunk of its own and not part of what the window loads at start.
    const typescript = chunks.find(f => /^typescript-/.test(f))
    expect(typescript, 'a chunk of its own for the Prettier TypeScript plugin').toBeTruthy()
    expect(readFileSync(join(out, 'index.html'), 'utf8')).not.toContain(typescript)
  }, 180_000)
})

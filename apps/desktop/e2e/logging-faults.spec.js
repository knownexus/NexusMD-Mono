// Fault injection: break things in the real app on purpose and check each one leaves a line in the log. This is what turns
// "no error goes unlogged" from a claim about the code into something that is tested. It covers what the code handles as well as
// what it does not: a request that fails and is shown as "cannot reach the server" must still be in the log with its reason.
import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from './launch.js'

// Every entry written so far, from logs/<module>/*.jsonl.
function entries(userData) {
  const root = join(userData, 'logs')
  if (!existsSync(root)) return []
  const out = []
  for (const mod of readdirSync(root, { withFileTypes: true })) {
    if (!mod.isDirectory() || mod.name.startsWith('_')) continue
    for (const file of readdirSync(join(root, mod.name))) {
      if (!file.endsWith('.jsonl')) continue
      for (const line of readFileSync(join(root, mod.name, file), 'utf8').split('\n')) {
        if (!line.trim()) continue
        try { out.push(JSON.parse(line)) } catch { /* a line still being written */ }
      }
    }
  }
  return out
}

let launched, userData, server, base
test.beforeEach(async () => {
  server = createServer((req, res) => {
    if (req.url.startsWith('/boom')) { res.writeHead(503); res.end('down') }
    else if (req.url.startsWith('/missing')) { res.writeHead(404); res.end('no') }
    else { res.writeHead(200, { 'access-control-allow-origin': '*' }); res.end('ok') }
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
  launched = await launchApp()
  userData = await launched.app.evaluate(({ app }) => app.getPath('userData'))
})
test.afterEach(async () => {
  await launched?.close()
  await new Promise(r => server?.close(r))
})

const find = (pred) => () => entries(userData).find(pred)

test.describe('a failure that is handled still leaves a line in the log', () => {
  test('a request that cannot be made (nothing is listening) is logged with its reason, and its query string is not', async () => {
    const win = launched.win
    // Handled in the page, exactly as the sign-in screen handles it: caught, and shown as a message.
    const shown = await win.evaluate(() => fetch('http://127.0.0.1:1/api/account/login?token=SECRET-TOKEN', { method: 'POST' }).then(() => 'reached', () => 'Cannot reach the server'))
    expect(shown).toBe('Cannot reach the server')
    await expect.poll(find(e => e.lvl === 'warn' && /request failed: POST 127\.0\.0\.1:1\/api\/account\/login/.test(e.msg || '')), { timeout: 10000 }).toBeTruthy()
    const entry = find(e => /request failed: POST 127\.0\.0\.1:1/.test(e.msg || ''))()
    expect(entry.err?.message).toBeTruthy()                       // the real reason, not just "offline"
    expect(JSON.stringify(entries(userData))).not.toContain('SECRET-TOKEN')
  })

  test('a server error is a warning, a refusal is info, a success is nothing', async () => {
    const win = launched.win
    await win.evaluate(async (b) => { await fetch(`${b}/boom?x=1`); await fetch(`${b}/missing`); await fetch(`${b}/fine`) }, base)
    await expect.poll(find(e => e.lvl === 'warn' && /request failed: GET .*\/boom \(503\)/.test(e.msg || '')), { timeout: 10000 }).toBeTruthy()
    await expect.poll(find(e => e.lvl === 'info' && /request was refused: GET .*\/missing \(404\)/.test(e.msg || '')), { timeout: 10000 }).toBeTruthy()
    expect(entries(userData).some(e => /\/fine/.test(e.msg || ''))).toBe(false)
  })

  test('a request the page cancels is not a warning', async () => {
    const win = launched.win
    await win.evaluate(async (b) => { const c = new AbortController(); const p = fetch(`${b}/slow`, { signal: c.signal }).catch(() => {}); c.abort(); await p }, base)
    await new Promise(r => setTimeout(r, 1500))
    expect(entries(userData).filter(e => e.lvl === 'warn' && /request failed: GET .*\/slow/.test(e.msg || ''))).toEqual([])
  })
})

test.describe('a failure nothing handles is logged too', () => {
  test('an uncaught error in the window', async () => {
    await launched.win.evaluate(() => { setTimeout(() => { throw new Error('e2e-uncaught-fault') }, 0) })
    await expect.poll(find(e => e.lvl === 'error' && /e2e-uncaught-fault/.test(JSON.stringify(e))), { timeout: 10000 }).toBeTruthy()
  })

  test('an unhandled promise rejection in the window', async () => {
    await launched.win.evaluate(() => { Promise.reject(new Error('e2e-rejected-fault')) })
    await expect.poll(find(e => e.lvl === 'error' && /e2e-rejected-fault/.test(JSON.stringify(e))), { timeout: 10000 }).toBeTruthy()
  })
})

import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'

// A small Bruno collection on disk: a root request, a folder with a request,
// and an environment with a secret var.
function writeBrunoFixture(dir) {
  mkdirSync(join(dir, 'orders'), { recursive: true })
  mkdirSync(join(dir, 'environments'), { recursive: true })
  writeFileSync(join(dir, 'bruno.json'), JSON.stringify({ version: '1', name: 'Bruno Demo', type: 'collection' }))
  writeFileSync(join(dir, 'List users.bru'), 'meta {\n  name: List users\n  type: http\n  seq: 1\n}\n\nget {\n  url: {{baseUrl}}/users\n  body: none\n  auth: none\n}\n')
  writeFileSync(join(dir, 'orders', 'folder.bru'), 'meta {\n  name: Orders\n}\n')
  writeFileSync(join(dir, 'orders', 'Create order.bru'), 'meta {\n  name: Create order\n  type: http\n  seq: 1\n}\n\npost {\n  url: {{baseUrl}}/orders\n  body: json\n  auth: none\n}\n\nbody:json {\n  {\n    "sku": "abc"\n  }\n}\n')
  writeFileSync(join(dir, 'environments', 'Local.bru'), 'vars {\n  baseUrl: http://localhost:3000\n}\nvars:secret [\n  token\n]\n')
}

test('imports a Bruno collection folder into an API Client collection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nexusmd-bruno-'))
  const brunoDir = join(root, 'bruno')
  const targetDir = join(root, 'target')
  writeBrunoFixture(brunoDir)

  const { app, win, close } = await launchApp()
  try {
    // Stand in for the native folder dialog.
    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('picker:pickDirectory')
      ipcMain.handle('picker:pickDirectory', () => dir)
    }, brunoDir)

    await win.getByText('API Client').first().click()
    const pathInput = win.getByPlaceholder('Collection folder path')
    await pathInput.fill(targetDir)
    await pathInput.press('Enter')

    await win.getByRole('button', { name: 'Import Bruno collection' }).click()

    await expect(win.locator('.ac-tree-folder', { hasText: 'Bruno Demo' })).toBeVisible({ timeout: 10_000 })
    await expect(win.locator('.ac-tree-folder', { hasText: 'Orders' })).toBeVisible()
    await expect(win.locator('.ac-tree-item', { hasText: 'Create order' })).toBeVisible()
    await expect(win.locator('.ac-tree-item', { hasText: 'List users' })).toBeVisible()
    await expect(win.locator('select.ac-select option', { hasText: 'Local' })).toHaveCount(1)

    // Selecting the imported POST shows its JSON body.
    await win.locator('.ac-tree-item', { hasText: 'Create order' }).click()
    await expect(win.locator('.ac-method-tag[data-method="POST"]').first()).toBeVisible()

    // And it all landed on disk in our collection format.
    expect(readdirSync(join(targetDir, 'requests'))).toHaveLength(2)
    expect(JSON.parse(readFileSync(join(targetDir, 'environments', 'Local.json'), 'utf8'))).toEqual({
      variables: { baseUrl: { value: 'http://localhost:3000' }, token: { secret: true } },
    })
  } finally {
    await close()
    rmSync(root, { recursive: true, force: true })
  }
})

// A collection shaped like a real Bruno test suite: collection-level bearer
// auth, a setup request whose post-response script stores the token, a request
// that fetches the token with bru.runRequest when it has none, and enough
// filler requests that the sidebar has to scroll.
function writeScriptedFixture(dir) {
  const write = (rel, text) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text) }
  write('bruno.json', JSON.stringify({ version: '1', name: 'Scripted API', type: 'collection' }))
  write('collection.bru', 'auth {\n  mode: bearer\n}\n\nauth:bearer {\n  token: {{token}}\n}\n')
  write('environments/Local.bru', 'vars {\n  baseUrl: http://127.0.0.1:1\n}\nvars:secret [\n  token\n]\n')
  write('00-setup/authenticate.bru', `meta {\n  name: Authenticate\n  seq: 1\n}\n\npost {\n  url: {{baseUrl}}/api/Authenticate\n  body: none\n  auth: none\n}\n
script:post-response {\n  if (res.getStatus() === 200) {\n    bru.setVar("token", res.getBody().token);\n  }\n}\n
tests {\n  test("mints a token", function () {\n    expect(res.getStatus()).to.equal(200);\n  });\n}\n`)
  write('10-items/list-items.bru', `meta {\n  name: List items\n  seq: 1\n}\n\nget {\n  url: {{baseUrl}}/api/items\n  body: none\n  auth: inherit\n}\n
script:pre-request {\n  if (!bru.getVar("token")) {\n    await bru.runRequest("00-setup/authenticate.bru");\n  }\n}\n
tests {\n  test("is authorised", function () {\n    expect(res.getStatus()).to.equal(200);\n  });\n\n  test("returns items", function () {\n    expect(res.getBody()).to.be.an("array").that.is.not.empty;\n  });\n}\n`)
  for (let i = 1; i <= 40; i++) {
    const n = String(i).padStart(2, '0')
    write(`20-filler/filler-${n}.bru`, `meta {\n  name: Filler ${n}\n  seq: ${i}\n}\n\nget {\n  url: {{baseUrl}}/api/filler/${n}\n  body: none\n  auth: none\n}\n`)
  }
}

// The API the collection tests: /api/items needs the token /api/Authenticate mints.
function startApi() {
  const calls = []
  const server = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`)
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/Authenticate') return res.end(JSON.stringify({ token: 'tok-123' }))
    if (req.url === '/api/items') {
      if (req.headers.authorization !== 'Bearer tok-123') { res.statusCode = 401; return res.end('{}') }
      return res.end(JSON.stringify([{ id: 1 }, { id: 2 }]))
    }
    res.end('{}')
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })))
}

// Screenshots for review: SHOTS_DIR=<dir> saves them, THEME=dark launches in the dark theme.
const THEME = process.env.THEME === 'dark' ? 'dark' : 'light'
const shot = (win, name) => process.env.SHOTS_DIR && win.screenshot({ path: join(process.env.SHOTS_DIR, `${name}-${THEME}.png`) })

test('runs imported Bruno scripts and tests, edits an environment, and scrolls a long sidebar', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nexusmd-bruno-scripts-'))
  const brunoDir = join(root, 'bruno')
  const targetDir = join(root, 'target')
  writeScriptedFixture(brunoDir)
  const api = await startApi()

  const { app, win, close } = await launchApp({ seed: THEME === 'dark' ? { 'nexusmd.tweaks': { theme: 'dark' } } : {} })
  try {
    await win.setViewportSize({ width: 1400, height: 900 })
    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('picker:pickDirectory')
      ipcMain.handle('picker:pickDirectory', () => dir)
    }, brunoDir)

    await win.getByText('API Client').first().click()
    const pathInput = win.getByPlaceholder('Collection folder path')
    await pathInput.fill(targetDir)
    await pathInput.press('Enter')

    await win.getByLabel(/Include scripts and tests/).check()
    await win.getByRole('button', { name: 'Import Bruno collection' }).click()
    await expect(win.locator('.ac-tree-item', { hasText: 'List items' })).toBeVisible({ timeout: 10_000 })

    // The sidebar list scrolls all the way to the last request.
    const list = win.locator('.ac-collections')
    expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
    await list.evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect(win.locator('.ac-tree-item', { hasText: 'Filler 40' })).toBeInViewport()
    await list.evaluate(el => { el.scrollTop = 0 })

    // Point the environment at the test API through the environment editor.
    await win.getByLabel('Environment').selectOption('Local')
    await win.getByRole('button', { name: 'Edit', exact: true }).click()
    await win.getByLabel('Value of baseUrl').fill(api.url)
    await shot(win, 'env-editor')
    await win.getByRole('button', { name: 'Save' }).click()
    await expect(win.getByLabel('Value of baseUrl')).toHaveCount(0)
    expect(JSON.parse(readFileSync(join(targetDir, 'environments', 'Local.json'), 'utf8')).variables.baseUrl).toEqual({ value: api.url })

    // Sending List items fetches the token through bru.runRequest, then its Bruno tests pass.
    await win.locator('.ac-tree-item', { hasText: 'List items' }).click()
    await win.getByRole('button', { name: 'Tests', exact: true }).click()
    await expect(win.locator('.ac-script-hint').first()).toBeVisible()
    await win.getByRole('button', { name: 'Send' }).click()
    await expect(win.locator('.ac-test-row.pass', { hasText: 'returns items' })).toBeVisible({ timeout: 10_000 })
    await expect(win.locator('.ac-test-row.pass', { hasText: 'is authorised' })).toBeVisible()
    await expect(win.locator('.ac-session-vars')).toContainText('token')
    expect(api.calls).toEqual(['POST /api/Authenticate', 'GET /api/items'])
    await shot(win, 'tests')

    // A second send reuses the session token instead of authenticating again.
    await win.getByRole('button', { name: 'Send' }).click()
    await expect.poll(() => api.calls.length).toBe(3)
    expect(api.calls[2]).toBe('GET /api/items')
  } finally {
    await close()
    api.server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

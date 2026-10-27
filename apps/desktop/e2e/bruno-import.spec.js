import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

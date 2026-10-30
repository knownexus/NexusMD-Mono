import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch.js'

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { cwd, stdio: 'pipe' }).toString()

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}
// A solid-colour PNG of the given size.
function png(w, h, [r, g, b]) {
  const head = Buffer.alloc(13)
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))])
}

test('images render in the diff and in the editor window', async () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'nexusmd-image-')))
  writeFileSync(join(dir, 'logo.png'), png(8, 4, [255, 0, 0]))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'logo.png'), png(16, 12, [0, 0, 255]))
  writeFileSync(join(dir, 'fresh.png'), png(5, 5, [0, 255, 0]))
  const { app, win, close } = await launchApp({
    seed: { 'profile:git.config': { version: 1, repos: [{ name: 'Work', path: dir }], groups: [], roots: null, dotfiles: null, view: { group: 'All projects', collapsed: [], selected: dir.replace(/\\/g, '/'), split: 0.45, panel: 'changes', list: 'shown' } } },
  })
  const size = img => img.evaluate(i => [i.naturalWidth, i.naturalHeight])
  try {
    await win.locator('button.nav-item', { hasText: 'Git Workspace' }).evaluate(b => b.click())
    const row = name => win.locator('.nx-gw-file', { hasText: name })
    await expect(row('logo.png')).toBeVisible({ timeout: 30_000 })

    // A modified image: HEAD/index before, working tree after.
    await row('logo.png').dispatchEvent('click')
    const diff = win.getByLabel('Image diff')
    await expect(diff).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => size(diff.getByAltText('logo.png (old)'))).toEqual([8, 4])
    await expect.poll(() => size(diff.getByAltText('logo.png (new)'))).toEqual([16, 12])

    // A new image has only the new side.
    await row('fresh.png').dispatchEvent('click')
    await expect(win.getByLabel('Image diff').getByAltText('fresh.png (new)')).toBeVisible({ timeout: 20_000 })
    await expect(win.getByLabel('Old image')).toHaveCount(0)

    // The editor window shows the picture instead of "isn't a text file".
    const known = new Set(app.windows())
    await row('logo.png').dispatchEvent('contextmenu', { clientX: 60, clientY: 60 })
    await win.getByRole('menuitem', { name: 'Edit in new window' }).evaluate(b => b.click())
    await expect.poll(() => app.windows().filter(w => !known.has(w)).length, { timeout: 20_000 }).toBe(1)
    const editor = app.windows().find(w => !known.has(w))
    await editor.waitForLoadState('domcontentloaded')
    await expect.poll(() => size(editor.getByAltText('logo.png'))).toEqual([16, 12])
    await expect(editor.getByText(/isn't a text file/)).toHaveCount(0)
  } finally {
    await close()
    rmSync(dir, { recursive: true, force: true })
  }
})

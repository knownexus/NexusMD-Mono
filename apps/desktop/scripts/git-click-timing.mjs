// Times the Git Workspace in the real app: open a repo's changes, click a changed file.
// Usage: node scripts/git-click-timing.mjs <repo folder name under C:/repos> <changed file name>
// Read-only. Needs the renderer built (npx vite build).
import { launchApp } from '../e2e/launch.js'
const [name, file] = process.argv.slice(2)
const repos = [{ name, path: 'C:/repos/' + name }]
const { app, win, close } = await launchApp({ seed: { 'profile:git.config': { version: 1, repos, groups: [], roots: [], dotfiles: '' } } })
await app.evaluate(({ ipcMain }) => {
  globalThis.__log = []
  for (const [ch, fn] of ipcMain._invokeHandlers) {
    if (!ch.startsWith('git:')) continue
    ipcMain._invokeHandlers.set(ch, async (...a) => { const s = Date.now(); try { return await fn(...a) } finally { globalThis.__log.push(`${ch.slice(4)} ${Date.now() - s}ms`) } })
  }
})
await win.getByText('Git Workspace').first().click()
await win.getByRole('button', { name: /Review & commit/ }).first().waitFor({ timeout: 60000 })
await win.waitForTimeout(1500)
const mark = async () => { await app.evaluate(() => { globalThis.__log.length = 0 }) }
const step = async (label, fn, ready) => {
  await mark(); const t = Date.now(); await fn(); await ready(); const ms = Date.now() - t
  console.log(label.padEnd(30), String(ms).padStart(5), 'ms   git:', (await app.evaluate(() => globalThis.__log.join(', '))) || '-')
}
await step('open Review & commit', () => win.getByRole('button', { name: /Review & commit/ }).first().click(), () => win.getByText(file).first().waitFor({ timeout: 60000 }))
await step('click a changed file', () => win.getByText(file).first().click(), () => win.locator('text=/^@@|diff|Binary|No changes/').first().waitFor({ timeout: 60000 }).catch(() => {}))
await win.waitForTimeout(500)
await win.screenshot({ path: '' + (process.env.TEMP || '.') + '/git-click.png' })
await close()

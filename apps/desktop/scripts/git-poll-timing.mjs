// Records every git IPC call for 14s after opening the Git Workspace: how many, how long, and when polls run.
// Usage: node scripts/git-poll-timing.mjs <repo folder name> [more repo names...]  (names under C:/repos)
// Read-only. Needs the renderer built (npx vite build).
import { launchApp } from '../e2e/launch.js'
const names = process.argv.slice(2)
const repos = names.map(n => ({ name: n, path: 'C:/repos/' + n }))
const { app, win, close } = await launchApp({ seed: { 'profile:git.config': { version: 1, repos, groups: [], roots: [], dotfiles: '' } } })
await app.evaluate(({ ipcMain }) => {
  globalThis.__log = []
  const t0 = Date.now()
  for (const [ch, fn] of ipcMain._invokeHandlers) {
    if (!ch.startsWith('git:')) continue
    ipcMain._invokeHandlers.set(ch, async (...a) => {
      const s = Date.now() - t0
      try { return await fn(...a) } finally { globalThis.__log.push({ ch, s, ms: Date.now() - t0 - s }) }
    })
  }
})
await win.getByText('Git Workspace').first().click()
await win.waitForTimeout(14000)
const log = await app.evaluate(() => globalThis.__log)
const by = {}
for (const l of log) { const b = by[l.ch] ||= { n: 0, total: 0, max: 0 }; b.n++; b.total += l.ms; b.max = Math.max(b.max, l.ms) }
console.log('IPC calls in 14s after opening the page:', log.length)
for (const [ch, b] of Object.entries(by).sort((a, b) => b[1].total - a[1].total)) console.log(' ', ch.padEnd(16), 'n', String(b.n).padStart(3), 'total', String(b.total).padStart(6), 'ms  max', b.max, 'ms')
const polls = log.filter(l => l.ch === 'git:branches').map(l => (l.s / 1000).toFixed(1))
console.log('branch reads (one per repo per poll) at s:', polls.join(' '))
await close()

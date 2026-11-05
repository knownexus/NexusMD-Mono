// Measures what the call reports cost the real app, with nothing recording.
//
//   node apps/desktop/scripts/trace-cost.mjs [rounds]      (default 6)
//
// The window code is built twice, without the reports (NEXUSMD_TRACE=0) and with them, and both are kept. The app is then launched
// `rounds` times in each of three configurations, in turn and in a rotating order (so anything that drifts while it runs, such as
// the machine getting busy, lands on every configuration alike), and the folder the app loads is copied from the right build
// before every launch (so every run starts from the same files):
//   plain    no reports anywhere
//   window   reports in the window code; the main process, run from source, is left as it is
//   full     reports in both; run from source that also means the main process's files are changed as they load
// Each launch times (1) start-up to the first screen and (2) clicking through the main screens. Prints medians and ratios.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchApp } from '../e2e/launch.js'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(desktop, '..', '..')
const dist = join(repo, 'dist', 'desktop')
const rounds = Number(process.argv[2]) || 6
const SCREENS = ['Pull Requests', 'Planner', 'Work Items', 'Calendar', 'Dashboard']
const REPEATS = 4

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const build = (trace, outDir) => {
  const r = spawnSync(process.execPath, [join(repo, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'error', '--outDir', outDir, '--emptyOutDir'], { cwd: desktop, env: { ...process.env, NEXUSMD_TRACE: trace }, stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`the build with NEXUSMD_TRACE=${trace} failed`)
}
const bytes = (dir) => readdirSync(join(dir, 'assets')).filter(n => n.endsWith('.js')).reduce((n, f) => n + statSync(join(dir, 'assets', f)).size, 0)

const CONFIGS = [
  { label: 'plain', renderer: join(dist, 'renderer-plain'), env: { NEXUSMD_TRACE: '0' } },
  { label: 'window', renderer: join(dist, 'renderer-traced'), env: { NEXUSMD_TRACE: '1', NEXUSMD_TRACE_HOOK: '0' } },
  { label: 'full', renderer: join(dist, 'renderer-traced'), env: { NEXUSMD_TRACE: '1' } },
]
build('0', CONFIGS[0].renderer)
build('1', CONFIGS[1].renderer)

async function once(config) {
  rmSync(join(dist, 'renderer'), { recursive: true, force: true })
  mkdirSync(join(dist, 'renderer'), { recursive: true })
  cpSync(config.renderer, join(dist, 'renderer'), { recursive: true })
  delete process.env.NEXUSMD_TRACE_HOOK
  Object.assign(process.env, config.env)
  const t0 = performance.now()
  const { win, close } = await launchApp()
  await win.getByText('Dashboard').first().waitFor({ timeout: 30000 })
  const startup = performance.now() - t0
  await win.waitForTimeout(1500) // let first-load work settle
  const t1 = performance.now()
  for (let r = 0; r < REPEATS; r++) {
    for (const name of SCREENS) {
      await win.getByText(name).first().click()
      await win.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
    }
  }
  const interaction = performance.now() - t1
  await close()
  return { startup, interaction }
}

const samples = Object.fromEntries(CONFIGS.map(c => [c.label, []]))
for (let round = 0; round < rounds; round++) {
  for (let i = 0; i < CONFIGS.length; i++) {
    const config = CONFIGS[(i + round) % CONFIGS.length]
    samples[config.label].push(await once(config))
  }
}

const summary = {}
for (const { label, renderer } of CONFIGS) {
  summary[label] = { bytes: bytes(renderer), startup: median(samples[label].map(s => s.startup)), interaction: median(samples[label].map(s => s.interaction)) }
  console.log(`${label.padEnd(7)} bundle ${(summary[label].bytes / 1e6).toFixed(2)} MB   start-up ${summary[label].startup.toFixed(0)} ms   ${SCREENS.length * REPEATS} screen changes ${summary[label].interaction.toFixed(0)} ms`)
}
for (const label of ['window', 'full']) {
  const r = summary[label], p = summary.plain
  console.log(`${label} / plain:  bundle x${(r.bytes / p.bytes).toFixed(2)}   start-up x${(r.startup / p.startup).toFixed(2)}   screen changes x${(r.interaction / p.interaction).toFixed(2)}`)
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, { startup: v.map(s => Math.round(s.startup)), interaction: v.map(s => Math.round(s.interaction)) }]))))
// leave dist/desktop/renderer as the build with the reports, as a normal build makes it
rmSync(join(dist, 'renderer'), { recursive: true, force: true })
cpSync(CONFIGS[1].renderer, join(dist, 'renderer'), { recursive: true })

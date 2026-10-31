#!/usr/bin/env node
// Runs only the Vitest tests a change can affect, chosen by path rather than by import graph.
// The import graph cannot narrow anything here: every consumer imports the @nexusmd/core barrel
// (the desktop shell shares one copy of it with every app through an import map), so to Vitest a
// change to one core module touches every test.
//
//   node scripts/test-scope.mjs git          one feature: its core logic + its module
//   node scripts/test-scope.mjs git --full   ...plus the slow integration project, where it has one
//   node scripts/test-scope.mjs              whatever the working tree changed (vs HEAD, plus untracked)
//   node scripts/test-scope.mjs --base master   whatever changed since master
//   node scripts/test-scope.mjs --dry           print the vitest command instead of running it
//
// A change to a shared package (core outside its modules, ui, shell-sdk, editor-kit, main-kit,
// web-adapters) or to root config runs the whole suite: everything depends on those.
import { execFileSync, spawnSync } from 'node:child_process'

// Each feature: the Vitest projects it lives in and the path fragments that pick its files.
// Filters apply across every selected project, so each fragment must only match this feature.
const FEATURES = {
  git: { projects: ['core', 'git'], full: ['git-integration'], paths: ['packages/core/src/modules/git/', 'modules/git/'] },
  devenv: { projects: ['core', 'devenv'], paths: ['packages/core/src/modules/devenv/', 'modules/devenv/'] },
  database: { projects: ['core', 'database'], paths: ['packages/core/src/modules/db-manager/', 'modules/database/'] },
  'api-client': { projects: ['core', 'api-client'], paths: ['packages/core/tests/api-client/', 'modules/api-client/'] },
  work: {
    projects: ['core', 'work'],
    paths: [
      'packages/core/tests/workitems/', 'packages/core/tests/ado', 'packages/core/tests/jira/',
      'packages/core/tests/github/', 'packages/core/tests/work-item', 'modules/work/',
    ],
  },
  calendar: { projects: ['core', 'calendar'], paths: ['packages/core/tests/calendar', 'modules/calendar/'] },
  planner: { projects: ['core', 'planner'], paths: ['packages/core/tests/planner', 'modules/planner/'] },
  editor: { projects: ['editor'], paths: ['modules/editor/'] },
  notes: { projects: ['notes'], paths: ['modules/notes/'] },
  time: { projects: ['time', 'ui', 'app'], paths: ['modules/time/', 'packages/ui/src/views/view-time', 'packages/ui/src/views/time-log', 'packages/ui/src/styles/time.css'] },
  documents: { projects: ['documents'], paths: ['modules/documents/'] },
}

// packages/core/src/modules/<dir> -> the features whose tests cover it.
const CORE_MODULES = {
  git: ['git'], devenv: ['devenv'], 'db-manager': ['database'], 'api-client': ['api-client'],
  ado: ['work'], workitems: ['work'], jira: ['work'], pr: ['work'], team: ['work'], triage: ['work'],
  github: ['work', 'git'], calendar: ['calendar'], planner: ['planner'],
}

// What a changed path needs: { features: [...] }, { full: true }, or {} for nothing.
function scopeOf(path) {
  if (!/\.(c|m)?jsx?$|\.json$|vitest\.config|\.css$/.test(path)) return {}
  let m
  if ((m = path.match(/^modules\/([^/]+)\//))) {
    if (!FEATURES[m[1]]) return { full: true }
    // Git's main-process code is what the integration tests drive.
    return { features: [m[1]], integration: m[1] === 'git' && path.includes('/src/main/') }
  }
  if ((m = path.match(/^packages\/core\/src\/modules\/([^/]+)\//))) {
    return CORE_MODULES[m[1]] ? { features: CORE_MODULES[m[1]] } : { full: true }
  }
  if ((m = path.match(/^(packages\/core\/tests\/.*\.test\.jsx?)$/))) return { projects: ['core'], paths: [m[1]] }
  if ((m = path.match(/^apps\/([^/]+)\//))) return { projects: [m[1]], paths: [`apps/${m[1]}/`] }
  if (/^(packages|vitest\.config|package(-lock)?\.json)/.test(path)) return { full: true }
  return {}
}

function changedFiles(base) {
  const git = args => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean)
  return [...git(['diff', '--name-only', base]), ...git(['ls-files', '--others', '--exclude-standard'])]
}

function plan(argv) {
  const baseAt = argv.indexOf('--base')
  const named = argv.filter((a, i) => !a.startsWith('--') && !(baseAt >= 0 && i === baseAt + 1))
  const fullFlag = argv.includes('--full')
  if (named.length) {
    const unknown = named.filter(n => !FEATURES[n])
    if (unknown.length) throw new Error(`Unknown feature: ${unknown.join(', ')}. Known: ${Object.keys(FEATURES).join(', ')}`)
    return collect(named.map(n => ({ features: [n], integration: fullFlag })))
  }
  const base = baseAt >= 0 ? argv[baseAt + 1] : 'HEAD'
  const files = changedFiles(base)
  return collect(files.map(f => ({ ...scopeOf(f), file: f })))
}

function collect(scopes) {
  const projects = new Set()
  const paths = new Set()
  const reasons = []
  for (const s of scopes) {
    if (s.full) return { full: true, reasons: [`${s.file} is shared`] }
    for (const f of s.features ?? []) {
      FEATURES[f].projects.forEach(p => projects.add(p))
      FEATURES[f].paths.forEach(p => paths.add(p))
      if (s.integration) (FEATURES[f].full ?? []).forEach(p => projects.add(p))
    }
    s.projects?.forEach(p => projects.add(p))
    s.paths?.forEach(p => paths.add(p))
  }
  return { projects: [...projects], paths: [...paths], reasons }
}

const argv = process.argv.slice(2)
const p = plan(argv)
let args
if (p.full) {
  console.log(`Running the whole suite: ${p.reasons[0]}.`)
  args = ['run']
} else if (!p.projects.length) {
  console.log('No tests cover the changed files.')
  process.exit(0)
} else {
  args = ['run', ...p.projects.flatMap(n => ['--project', n]), ...p.paths]
}
if (argv.includes('--dry')) {
  console.log(`vitest ${args.join(' ')}`)
  process.exit(0)
}
const r = spawnSync('npx', ['vitest', ...args], { stdio: 'inherit', shell: process.platform === 'win32' })
process.exit(r.status ?? 1)

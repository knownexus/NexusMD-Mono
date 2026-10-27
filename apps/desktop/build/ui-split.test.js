// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  analyzeUi, sharedFiles, ownedFiles, ownedNames, specifiersOf, exportedNames, exportCollisions,
  sharedUiEntrySource, appUiBarrelSource, relativeToUi,
} from './ui-split.mjs'

const analysis = analyzeUi()
const rel = files => files.map(f => relativeToUi(analysis, f))
describe('who owns the screens in @nexusmd/ui', () => {
  it('gives each app its own screens', () => {
    expect(rel(ownedFiles(analysis, 'planner'))).toContain('views/view-planner.jsx')
    expect(rel(ownedFiles(analysis, 'calendar'))).toEqual(['views/view-calendar.jsx'])
    expect(rel(ownedFiles(analysis, 'database'))).toEqual([
      'views/ViewDbManager.jsx', 'views/db-grid-menus.js', 'views/db-menu.jsx', 'views/db-min-cols.js', 'views/db-nav.js', 'views/db-structure-panel.jsx',
    ])
    expect(rel(ownedFiles(analysis, 'api-client'))).toContain('views/view-api-client.jsx')
    expect(rel(ownedFiles(analysis, 'documents'))).toContain('views/view-documents.jsx')
    for (const f of ['views/view-workitems.jsx', 'views/view-dashboard.jsx', 'views/view-prs.jsx', 'views/work-item-detail.jsx']) {
      expect(rel(ownedFiles(analysis, 'work')), f).toContain(f)
    }
  })

  it('keeps what several apps use in the shell', () => {
    const shared = rel(sharedFiles(analysis))
    for (const f of ['icons.jsx', 'data-context.jsx', 'toast.jsx', 'profile-context.jsx', 'views/view-settings.jsx', 'planner/planner-notes.jsx']) {
      expect(shared, f).toContain(f)
    }
    // Settings only needs this constant from the work items screen, so it must not drag the screen along.
    expect(shared).not.toContain('views/view-workitems.jsx')
  })

  it('leaves out what the desktop app does not use (web and mobile only)', () => {
    const used = new Set(rel([...analysis.owners.keys()]))
    expect(used.has('views/work-item-shell.jsx')).toBe(false)
    expect(used.has('timer-widget.jsx')).toBe(false)
  })

  it('has no file that is both shared and an app\'s', () => {
    const shared = new Set(sharedFiles(analysis))
    for (const id of analysis.appIds) for (const f of ownedFiles(analysis, id)) expect(shared.has(f)).toBe(false)
  })
})

describe('the two sides of @nexusmd/ui', () => {
  it('has the shell expose every shared file and none of the apps\' screens', () => {
    const entry = sharedUiEntrySource(analysis)
    expect(entry).toContain('icons.jsx')
    expect(entry).toContain('view-settings.jsx')
    for (const id of analysis.appIds) for (const f of rel(ownedFiles(analysis, id))) expect(entry, f).not.toContain(`/${f}"`)
  })

  it('has each app build in its own screens and take the rest from the shell', () => {
    const barrel = appUiBarrelSource(analysis, 'calendar')
    expect(barrel.split('\n')[0]).toBe("export * from '@nexusmd/ui'")
    expect(barrel).toMatch(/export \{ EventDetailModal \} from ".*view-calendar\.jsx"/)
    expect(barrel).not.toContain('view-planner')
    expect(ownedNames(analysis, 'calendar').map(n => n.name)).toContain('WeekGrid')
  })

  it('has no two shared files exporting the same name (export * would drop both)', () => {
    expect(exportCollisions(sharedFiles(analysis))).toEqual([])
  })
})

describe('reading source', () => {
  it('finds static and dynamic imports and re-exports', () => {
    const found = specifiersOf(`import a from './a.js'\nimport { b } from "./b.js"\nexport { c } from './c.js'\nimport './d.css'\nconst x = import('./e.js')`)
    expect(found).toEqual(['./a.js', './b.js', './c.js', './d.css', './e.js'])
  })

  it('lists exported names', () => {
    const names = exportedNames(`export const A = 1\nexport function B() {}\nexport class C {}\nexport { D, e as F }\nexport default G`)
    expect([...names].sort()).toEqual(['A', 'B', 'C', 'D', 'F'])
  })


  it('catches a name exported twice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ui-split-'))
    try {
      writeFileSync(join(dir, 'a.js'), 'export const Same = 1\n')
      writeFileSync(join(dir, 'b.js'), 'export { Same }\nconst Same = 2\n')
      expect(exportCollisions([join(dir, 'a.js'), join(dir, 'b.js')])).toHaveLength(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

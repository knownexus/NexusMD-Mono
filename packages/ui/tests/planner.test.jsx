import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import {
  NexusDataProvider, GlanceView, ColInput,
  loadGlobalNotes, saveGlobalNotes,
  loadVersions, saveVersions, describeSnapshot,
  WeekCalendarPicker, DeleteWeekModal,
  loadWeekPlanner, saveWeekPlanner, deleteWeekPlanner, getWeeksWithData,
  isLegacyMigrationDone, markLegacyMigrationDone, checkConfidentialReminders,
} from '../src/index.js'

afterEach(cleanup)

function withProvider(ui, value = {}) {
  return render(
    <NexusDataProvider value={{ data: {}, namespace: 'nexusmd', getProfileKey: (k) => k, ...value }}>
      {ui}
    </NexusDataProvider>,
  )
}

describe('planner subsystem (shared web + app)', () => {
  it('global notes persist under the namespaced key resolved by the planner runtime', () => {
    const store = {}
    const storage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v) },
      removeItem: (k) => { delete store[k] },
    }
    // Rendering the provider mirrors {namespace, getProfileKey, storage} into the
    // planner runtime that loadGlobalNotes/saveGlobalNotes (plain fns) read.
    withProvider(<div />, { storage, getProfileKey: (k) => `p.${k}`, namespace: 'helm' })

    saveGlobalNotes([{ id: 'n1', title: 'Hi', body: 'hello' }])
    // key = getProfileKey(`${namespace}.planner.globalNotes`) = "p.helm.planner.globalNotes"
    expect(Object.keys(store)).toContain('p.helm.planner.globalNotes')
    expect(loadGlobalNotes()[0].body).toBe('hello')
  })

  it('ColInput renders a status chip for a status column', () => {
    const { container } = withProvider(
      <ColInput col={{ t: 'status' }} value="Blocked" onChange={() => {}} />,
    )
    expect(container.querySelector('.stchip')?.getAttribute('data-s')).toBe('Blocked')
  })

  it('GlanceView renders its stats grid from section data', () => {
    const sections = [{ id: 'tasks', type: 'table', title: 'Tasks', cols: [{ k: 't', main: true }] }]
    const data = { tasks: [{ id: 'r1', t: 'Do thing', status: 'To Do' }] }
    const { container } = withProvider(
      <GlanceView data={data} themes={{}} sections={sections} groups={[]}
        onOpenGroup={() => {}} onOpenSection={() => {}} carryCount={0} onOpenCarry={() => {}} />,
    )
    expect(container.querySelector('.glance-grid')).toBeTruthy()
    expect(container.textContent).toContain('Open tasks')
  })
})

describe('promoted planner modals (shared web + app)', () => {
  it('version snapshots persist under the namespaced key resolved by the planner runtime', () => {
    const store = {}
    const storage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v) },
      removeItem: (k) => { delete store[k] },
    }
    withProvider(<div />, { storage, getProfileKey: (k) => `p.${k}`, namespace: 'helm' })

    saveVersions([{ id: 'v1', label: 'Snap', data: {}, themes: {} }])
    // key = getProfileKey(`${namespace}.planner.versions`) = "p.helm.planner.versions"
    expect(Object.keys(store)).toContain('p.helm.planner.versions')
    expect(loadVersions()[0].label).toBe('Snap')
  })

  it('describeSnapshot summarises counts (pure)', () => {
    expect(describeSnapshot({ tasks: [1, 2], meetSched: [1] })).toBe('2 tasks, 1 meeting')
    expect(describeSnapshot({})).toBe('empty planner')
  })

  it('WeekCalendarPicker renders real (non-NaN) ISO week numbers', () => {
    // Regression guard: the picker must use getIsoYearWeek(monday), not
    // getYearWeekForOffset(monday) — the latter took a Date where an offset
    // number was expected and produced NaN week numbers + dead data dots.
    const { container } = withProvider(
      <WeekCalendarPicker weekOffset={0} onSelectOffset={() => {}}
        weeksWithData={new Set()} onClose={() => {}} />,
    )
    expect(container.textContent).not.toContain('NaN')
    // At least one week row carries a 1-2 digit week number in its "Wk" column.
    const wkCells = [...container.querySelectorAll('span')].map(s => s.textContent)
    expect(wkCells.some(t => /^\d{1,2}$/.test(t || ''))).toBe(true)
  })

  it('DeleteWeekModal shows the permanent-delete warning when open', () => {
    const { container } = withProvider(
      <DeleteWeekModal open weekLabel={{ short: 'W26', full: 'Week 26' }}
        onClose={() => {}} onConfirm={() => {}} />,
    )
    expect(container.textContent).toContain('permanently delete')
    expect(container.textContent).toContain('W26')
  })
})

// Enumerable storage (real localStorage has length/key(i); the runtime fallback
// Map does not — getWeeksWithData/checkConfidentialReminders need enumeration).
function makeEnumerableStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
  }
}

describe('promoted planner storage helpers (shared web + app)', () => {
  it('per-week save/load/delete round-trips under the namespaced+scoped key and fires onWeekSaved', () => {
    const storage = makeEnumerableStorage()
    const onWeekSaved = vi.fn()
    withProvider(<div />, {
      storage, getProfileKey: (k) => `p.${k}`, namespace: 'helm', plannerOnWeekSaved: onWeekSaved,
    })

    saveWeekPlanner(2026, 26, { tasks: [{ id: 'r1' }] }, {})
    // storage key = getProfileKey(`${namespace}.planner.week.2026-W26`)
    expect(storage.getItem('p.helm.planner.week.2026-W26')).toBeTruthy()
    // web-only sync hook fires with (year, week)
    expect(onWeekSaved).toHaveBeenCalledWith(2026, 26)
    expect(loadWeekPlanner(2026, 26).data.tasks[0].id).toBe('r1')
    expect(getWeeksWithData().has('2026-W26')).toBe(true)

    deleteWeekPlanner(2026, 26)
    expect(getWeeksWithData().size).toBe(0)
  })

  it('legacy-migration flag round-trips under the namespaced key', () => {
    const storage = makeEnumerableStorage()
    withProvider(<div />, { storage, getProfileKey: (k) => `p.${k}`, namespace: 'helm' })
    expect(isLegacyMigrationDone()).toBe(false)
    markLegacyMigrationDone()
    expect(storage.getItem('p.helm.planner.legacyMigrated')).toBe('1')
    expect(isLegacyMigrationDone()).toBe(true)
  })

  it('checkConfidentialReminders surfaces an overdue confidential row', () => {
    const storage = makeEnumerableStorage()
    withProvider(<div />, { storage, getProfileKey: (k) => `p.${k}`, namespace: 'helm' })
    saveWeekPlanner(2026, 26, { tasks: [{ id: 'r1', _reminderDate: '2020-01-01' }] }, {})
    const due = checkConfidentialReminders()
    expect(due.length).toBeGreaterThanOrEqual(1)
    expect(due[0]).toMatchObject({ rowId: 'r1', sectionId: 'tasks', reminderDate: '2020-01-01' })
  })
})

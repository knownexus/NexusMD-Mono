import { describe, it, expect } from 'vitest'
import { createPlanForm, validatePlanForm, buildPlanAnswer, normaliseRefPrompt } from './plan.js'

const plan = {
  locked: true, lockError: null, database: 'asis', baseline: null, rememberedBaseline: 'b2',
  emulator: false, ios: 'off', macHost: null, macError: 'no mac.json', dockerApis: 'Orders API',
  test: 'off', testError: null, testServices: ['orders'],
  backups: [{ id: 'b1', size: 10, isLatest: true }, { id: 'b2', size: 20, isLatest: false }],
  testApis: [{ key: 'orders', label: 'Orders API', port: 5201 }],
  services: [
    { key: 'orders', label: 'Orders API', ref: 'main', branch: 'main', sha: 'abc12345', dirty: false, action: 'skip', built: true, remembered: false },
    { key: 'mobile', label: 'Mobile app', ref: 'main', branch: 'feature/x', sha: 'def67890', dirty: true, action: 'build', built: false, remembered: false },
  ],
}

describe('createPlanForm', () => {
  it('starts from the plan, preferring the remembered baseline', () => {
    expect(createPlanForm(plan)).toEqual({
      services: { orders: 'skip', mobile: 'build' }, database: 'asis', baseline: 'b2', wipeConfirm: '',
      emulator: false, ios: 'off', test: 'off', testServices: ['orders'],
    })
  })
  it('falls back to the latest backup, then none', () => {
    expect(createPlanForm({ ...plan, rememberedBaseline: 'gone' }).baseline).toBe('b1')
    expect(createPlanForm({ ...plan, rememberedBaseline: null, backups: [] }).baseline).toBeNull()
  })
})

describe('validatePlanForm', () => {
  const form = createPlanForm(plan)
  it('accepts the default plan', () => { expect(validatePlanForm(plan, form)).toBeNull() })
  it('blocks an unlocked plan with its reason', () => {
    expect(validatePlanForm({ ...plan, locked: false, lockError: 'ref nope not found' }, form)).toBe('Pick a branch that exists for every source first: ref nope not found')
  })
  it('needs a baseline to restore or wipe', () => {
    expect(validatePlanForm({ ...plan, backups: [] }, { ...form, database: 'restore', baseline: null })).toMatch(/No saved baseline/)
  })
  it('needs YES typed to wipe', () => {
    expect(validatePlanForm(plan, { ...form, database: 'wipe' })).toBe('Type YES to wipe the local database')
    expect(validatePlanForm(plan, { ...form, database: 'wipe', wipeConfirm: 'yes' })).toBe('Type YES to wipe the local database')
    expect(validatePlanForm(plan, { ...form, database: 'wipe', wipeConfirm: 'YES' })).toBeNull()
  })
  it('needs an API when the test stack is on', () => {
    expect(validatePlanForm(plan, { ...form, test: 'up', testServices: [] })).toBe('Pick at least one API for the test stack')
  })
})

describe('buildPlanAnswer', () => {
  it('builds devplan\'s result and drops the baseline unless restoring', () => {
    const form = { ...createPlanForm(plan), services: { orders: 'clean', mobile: 'skip' }, emulator: true, test: 'up' }
    expect(buildPlanAnswer(form, 'start')).toEqual({
      action: 'start', services: { orders: 'clean', mobile: 'skip' }, database: 'asis', baseline: null,
      emulator: true, ios: 'off', test: 'up', testServices: ['orders'],
    })
    expect(buildPlanAnswer({ ...form, database: 'restore' }, 'change-ref:orders')).toMatchObject({ action: 'change-ref:orders', database: 'restore', baseline: 'b2' })
  })
})

describe('normaliseRefPrompt', () => {
  it('reads the ref block with defaults', () => {
    const r = normaliseRefPrompt({ kind: 'ref', ref: { name: 'orders', current: 'main', worktrees: [{ path: 'C:\\w\\main', ref: 'main', display: 'main', folder: 'main', current: true }], remotes: ['origin/feature-x'] } })
    expect(r.name).toBe('orders')
    expect(r.worktrees[0].path).toBe('C:\\w\\main')
    expect(r.remotes).toEqual(['origin/feature-x'])
    expect(normaliseRefPrompt({ kind: 'ref' })).toEqual({ name: '', current: '', worktrees: [], remotes: [] })
  })
})

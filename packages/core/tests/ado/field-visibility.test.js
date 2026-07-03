import { describe, it, expect } from 'vitest'
import {
  WI_CARD_FIELDS, WI_TABLE_COLUMNS, PR_CARD_FIELDS,
  BUILDS_TABLE_COLUMNS, TESTS_TABLE_COLUMNS,
  defaultConfig, resolveFields, reorderField, toggleField,
} from '../../src/modules/ado/field-visibility.js'

const CATALOG = [
  { key: 'title', label: 'Title', locked: true },
  { key: 'assignee', label: 'Assignee' },
  { key: 'tags', label: 'Tags' },
]

describe('catalogs', () => {
  it('every catalog entry has a key and label', () => {
    for (const cat of [WI_CARD_FIELDS, WI_TABLE_COLUMNS, PR_CARD_FIELDS, BUILDS_TABLE_COLUMNS, TESTS_TABLE_COLUMNS]) {
      expect(cat.length).toBeGreaterThan(0)
      for (const f of cat) { expect(typeof f.key).toBe('string'); expect(typeof f.label).toBe('string') }
    }
  })
})

describe('defaultConfig', () => {
  it('lists every catalog key visible, in order', () => {
    expect(defaultConfig(CATALOG)).toEqual([
      { key: 'title', visible: true },
      { key: 'assignee', visible: true },
      { key: 'tags', visible: true },
    ])
  })
})

describe('resolveFields', () => {
  it('returns catalog defaults (all visible) for empty config', () => {
    const r = resolveFields(CATALOG, [])
    expect(r.map(f => f.key)).toEqual(['title', 'assignee', 'tags'])
    expect(r.every(f => f.visible)).toBe(true)
    expect(r[0].locked).toBe(true)
  })
  it('applies saved order and visibility', () => {
    const cfg = [{ key: 'tags', visible: false }, { key: 'assignee', visible: true }, { key: 'title', visible: true }]
    const r = resolveFields(CATALOG, cfg)
    expect(r.map(f => f.key)).toEqual(['tags', 'assignee', 'title'])
    expect(r.find(f => f.key === 'tags').visible).toBe(false)
  })
  it('forces locked fields visible even if stored hidden', () => {
    const r = resolveFields(CATALOG, [{ key: 'title', visible: false }])
    expect(r.find(f => f.key === 'title').visible).toBe(true)
  })
  it('drops config keys not in the catalog', () => {
    const r = resolveFields(CATALOG, [{ key: 'ghost', visible: true }, { key: 'title', visible: true }])
    expect(r.map(f => f.key)).not.toContain('ghost')
  })
  it('appends catalog fields missing from config, visible, in catalog order', () => {
    const r = resolveFields(CATALOG, [{ key: 'tags', visible: false }])
    expect(r.map(f => f.key)).toEqual(['tags', 'title', 'assignee'])
    expect(r.find(f => f.key === 'assignee').visible).toBe(true)
  })
})

describe('reorderField', () => {
  it('moves a field to the target slot', () => {
    const cfg = defaultConfig(CATALOG)
    const next = reorderField(cfg, CATALOG, 'tags', 'title')
    expect(next.map(f => f.key)).toEqual(['tags', 'title', 'assignee'])
  })
})

describe('toggleField', () => {
  it('flips visibility of a normal field', () => {
    const next = toggleField(defaultConfig(CATALOG), CATALOG, 'assignee')
    expect(next.find(f => f.key === 'assignee').visible).toBe(false)
  })
  it('is a no-op on a locked field', () => {
    const next = toggleField(defaultConfig(CATALOG), CATALOG, 'title')
    expect(next.find(f => f.key === 'title').visible).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { newWidgetsAfterSave, WIDGET_PAGES, pageLabel, WIDGET_CONFIG_TYPES, widgetPage } from '../src/index.js'

describe('widgetPage', () => {
  it('is the type page, or for a link the page its target lives on', () => {
    expect(widgetPage({ type: 'pr' })).toBe('pr')
    expect(widgetPage({ type: 'shortcut', config: { to: 'git' } })).toBeUndefined()
    expect(widgetPage({ type: 'link', config: { target: 'doc', tool: 'json', docId: 'a' } })).toBe('markdown')
    expect(widgetPage({ type: 'link', config: { target: 'git', path: '/a', repo: { name: 'r' } } })).toBe('git')
    expect(widgetPage({ type: 'link', config: {} })).toBeUndefined()
    expect(widgetPage(null)).toBeUndefined()
  })
})

describe('newWidgetsAfterSave', () => {
  it('replaces a widget with the same id', () => {
    const list = [{ id: 'a', type: 'pr' }, { id: 'b', type: 'time' }]
    expect(newWidgetsAfterSave(list, { id: 'a', type: 'builds' })).toEqual([{ id: 'a', type: 'builds' }, { id: 'b', type: 'time' }])
  })
  it('appends a widget with a new id', () => {
    expect(newWidgetsAfterSave([{ id: 'a' }], { id: 'c' })).toEqual([{ id: 'a' }, { id: 'c' }])
  })
})

describe('pageLabel', () => {
  it('labels known pages and falls back to the id', () => {
    expect(pageLabel('markdown')).toBe('Documents')
    expect(pageLabel('zzz')).toBe('zzz')
    expect(WIDGET_PAGES.find(p => p[0] === 'dashboard')[1]).toBe('Home')
  })
})

describe('WIDGET_CONFIG_TYPES', () => {
  it('every entry has label, page (except shortcut), defaults and fields', () => {
    for (const [k, t] of Object.entries(WIDGET_CONFIG_TYPES)) {
      expect(t.label, k).toBeTruthy()
      expect(typeof t.defaults, k).toBe('object')
      expect(Array.isArray(t.fields), k).toBe(true)
      expect(t.render, k).toBeUndefined()
      if (k !== 'shortcut' && k !== 'link') expect(t.page, k).toBeTruthy()
    }
  })
  it('titles derive from config', () => {
    expect(WIDGET_CONFIG_TYPES.pr.title({ filter: 'drafts' })).toBe('Draft PRs')
    expect(WIDGET_CONFIG_TYPES.shortcut.title({ to: 'git' })).toBe('Repos')
    expect(WIDGET_CONFIG_TYPES.link.title({ target: 'doc', tool: 'json', docId: 'd1', name: 'Config' })).toBe('Config')
  })
})

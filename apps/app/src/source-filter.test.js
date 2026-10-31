import { describe, it, expect } from 'vitest'
import { itemSource, sourcesIn, pickSource, filterBySource } from './source-filter.js'

const ado = { id: 42 }, jira = { id: 'jira:ABC-1', source: 'jira' }, gh = { id: 'gh:a/b#1', source: 'github' }

describe('source filter', () => {
  it('tells the provider of an item', () => {
    expect(itemSource(ado)).toBe('ado')
    expect(itemSource(gh)).toBe('github')
    expect(itemSource(jira)).toBe('jira')
    expect(itemSource({ id: 'jira:X-2' })).toBe('jira')
  })
  it('lists the providers present in a fixed order', () => {
    expect(sourcesIn([gh, ado, jira])).toEqual(['ado', 'jira', 'github'])
    expect(sourcesIn([gh])).toEqual(['github'])
    expect(sourcesIn(undefined)).toEqual([])
  })
  it('keeps a saved choice only while it has items', () => {
    expect(pickSource('github', ['ado', 'github'])).toBe('github')
    expect(pickSource('jira', ['ado', 'github'])).toBe('ado')
    expect(pickSource(null, [])).toBeNull()
  })
  it('filters to one provider, but leaves a single-provider list alone', () => {
    const all = [ado, jira, gh, { id: 7 }]
    expect(filterBySource(all, sourcesIn(all), 'ado')).toEqual([ado, { id: 7 }])
    expect(filterBySource(all, sourcesIn(all), 'github')).toEqual([gh])
    expect(filterBySource([ado], ['ado'], 'ado')).toEqual([ado])
    expect(filterBySource([gh], ['github'], null)).toEqual([gh])
  })
})

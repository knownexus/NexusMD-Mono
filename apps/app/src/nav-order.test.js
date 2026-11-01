import { describe, it, expect } from 'vitest'
import { orderTabs, moveTab, placeTabs } from './nav-order.js'

const tabs = ['a', 'b', 'c', 'd'].map(id => ({ id, label: id.toUpperCase() }))
const ids = (list) => list.map(t => t.id)

describe('orderTabs', () => {
  it('keeps the default order with nothing saved', () => {
    expect(orderTabs(tabs, undefined)).toBe(tabs)
    expect(orderTabs(tabs, [])).toBe(tabs)
  })

  it('follows the saved order, ignoring unknown and repeated ids', () => {
    expect(ids(orderTabs(tabs, ['c', 'zzz', 'a', 'c']))).toEqual(['c', 'a', 'b', 'd'])
  })

  it('puts a screen the list does not mention after the listed ones, in default order', () => {
    expect(ids(orderTabs(tabs, ['d', 'b']))).toEqual(['d', 'b', 'a', 'c'])
  })
})

describe('moveTab', () => {
  it('moves one place up or down', () => {
    expect(moveTab([], tabs, 'c', -1).slice(0, 4)).toEqual(['a', 'c', 'b', 'd'])
    expect(moveTab([], tabs, 'a', +1).slice(0, 4)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('does nothing past either end', () => {
    expect(moveTab(['a', 'b', 'c', 'd'], tabs, 'a', -1)).toEqual(['a', 'b', 'c', 'd'])
    expect(moveTab(['a', 'b', 'c', 'd'], tabs, 'd', +1)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('moves from the current order, not the default one', () => {
    const order = ['d', 'c', 'b', 'a']
    expect(ids(orderTabs(tabs, moveTab(order, tabs, 'b', -1)))).toEqual(['d', 'b', 'c', 'a'])
  })

  it('keeps the other group\'s saved order', () => {
    const other = [{ id: 'x' }, { id: 'y' }]
    const afterOther = moveTab([], other, 'y', -1)               // x,y -> y,x
    const both = moveTab(afterOther, tabs, 'b', -1)              // then move in the first group
    expect(ids(orderTabs(other, both))).toEqual(['y', 'x'])
    expect(ids(orderTabs(tabs, both))).toEqual(['b', 'a', 'c', 'd'])
  })
})

describe('placeTabs', () => {
  const primary = [{ id: 'home' }, { id: 'work' }]
  const secondary = [{ id: 'builds' }, { id: 'notes' }]
  const opts = { tablet: true, defaultFooter: ['builds'] }
  const idsOf = (r) => [ids(r.primary), ids(r.footer), ids(r.secondary)]
  it('starts as the defaults, with the footer only on a tablet', () => {
    expect(idsOf(placeTabs(primary, secondary, {}, opts))).toEqual([['home', 'work'], ['builds'], ['notes']])
    expect(idsOf(placeTabs(primary, secondary, {}, { tablet: false, defaultFooter: ['builds'] }))).toEqual([['home', 'work'], [], ['builds', 'notes']])
  })
  it('moves a screen to the bar, the footer or More', () => {
    expect(idsOf(placeTabs(primary, secondary, { notes: 'footer', builds: 'main', work: 'more' }, opts))).toEqual([['home', 'builds'], ['notes'], ['work']])
  })
  it('puts a footer choice in More on a phone', () => {
    expect(idsOf(placeTabs(primary, secondary, { notes: 'footer' }, { tablet: false }))[2]).toContain('notes')
  })
})

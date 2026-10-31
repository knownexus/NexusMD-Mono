import { describe, it, expect } from 'vitest'
import { resolveNav, fromResolved, move, setPinned, moveInBar, moveInMore, parsePref, PHONE_BAR_MAX } from './nav-config.js'

const T = (...ids) => ids.map(id => ({ id, label: id }))
const all = T('home', 'work', 'plan', 'pr', 'builds', 'tests', 'repos', 'settings')
const names = (l) => l.map(t => t.id)

describe('resolving the navigation', () => {
  it('uses the defaults when nothing is saved, with the rest in More in their own order', () => {
    const r = resolveNav(all, null, ['home', 'work', 'plan', 'pr'])
    expect(names(r.bar)).toEqual(['home', 'work', 'plan', 'pr'])
    expect(names(r.more)).toEqual(['builds', 'tests', 'repos', 'settings'])
  })
  it('follows a saved order and puts new screens at the end of More', () => {
    const r = resolveNav(all, { bar: ['pr', 'home'], more: ['repos', 'settings'] }, [])
    expect(names(r.bar)).toEqual(['pr', 'home'])
    expect(names(r.more)).toEqual(['repos', 'settings', 'work', 'plan', 'builds', 'tests'])
  })
  it('skips screens that are not available and never lists one twice', () => {
    const r = resolveNav(T('home', 'work'), { bar: ['gone', 'home', 'home'], more: ['work', 'home', 'ghost'] }, [])
    expect(names(r.bar)).toEqual(['home'])
    expect(names(r.more)).toEqual(['work'])
  })
  it('caps the bar and spills the extras to the front of More', () => {
    const r = resolveNav(all, { bar: ['home', 'work', 'plan', 'pr', 'builds', 'tests', 'repos'], more: ['settings'] }, [], { max: PHONE_BAR_MAX })
    expect(names(r.bar)).toHaveLength(5)
    expect(names(r.more).slice(0, 2)).toEqual(['tests', 'repos'])
  })
})

describe('changing it', () => {
  const pref = { bar: ['home', 'work'], more: ['plan', 'pr'] }
  it('moves an entry within its list and stops at the ends', () => {
    expect(move(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(move(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(move(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
    expect(moveInBar(pref, 'work', -1).bar).toEqual(['work', 'home'])
    expect(moveInMore(pref, 'plan', 1).more).toEqual(['pr', 'plan'])
  })
  it('pins to the end of the bar and unpins to the front of More', () => {
    expect(setPinned(pref, 'plan', true).pref).toEqual({ bar: ['home', 'work', 'plan'], more: ['pr'] })
    expect(setPinned(pref, 'work', false).pref).toEqual({ bar: ['home'], more: ['work', 'plan', 'pr'] })
  })
  it('refuses a sixth pin and an empty bar, saying why', () => {
    const full = { bar: ['a', 'b', 'c', 'd', 'e'], more: ['f'] }
    expect(setPinned(full, 'f', true).error).toMatch(/holds 5/)
    expect(setPinned(full, 'f', true).pref).toBe(full)
    expect(setPinned({ bar: ['a'], more: [] }, 'a', false).error).toMatch(/at least one/)
  })
  it('saves and reads back, ignoring junk', () => {
    const r = resolveNav(all, { bar: ['pr'], more: [] }, [])
    expect(parsePref(JSON.stringify(fromResolved(r)))).toEqual({ bar: ['pr'], more: names(r.more) })
    expect(parsePref('nope')).toBeNull()
    expect(parsePref('{"bar":1}')).toBeNull()
    expect(parsePref(null)).toBeNull()
  })
})

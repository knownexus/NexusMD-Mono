import { describe, it, expect } from 'vitest'
import { reconcileItem, mergeKeyVal } from '../src/index.js'

const merge = (b, l, r) => mergeKeyVal(b, l, r, { prefer: 'local' })

describe('reconcileItem', () => {
  it('noop when nothing changed', () => {
    const v = { a: 1 }
    expect(reconcileItem({ base: v, local: v, remote: v, merge }).action).toBe('noop')
  })
  it('push when only local changed', () => {
    const res = reconcileItem({ base: { a: 1 }, local: { a: 2 }, remote: { a: 1 }, merge })
    expect(res.action).toBe('push'); expect(res.value).toEqual({ a: 2 })
  })
  it('pull when only remote changed', () => {
    const res = reconcileItem({ base: { a: 1 }, local: { a: 1 }, remote: { a: 9 }, merge })
    expect(res.action).toBe('pull'); expect(res.value).toEqual({ a: 9 })
  })
  it('merge when both changed', () => {
    const res = reconcileItem({ base: { a: 1 }, local: { a: 1, b: 2 }, remote: { a: 1, c: 3 }, merge })
    expect(res.action).toBe('merge'); expect(res.value).toEqual({ a: 1, b: 2, c: 3 })
  })
  it('push for a brand-new local item', () => {
    const res = reconcileItem({ base: null, local: { a: 1 }, remote: null, merge })
    expect(res.action).toBe('push')
  })
  it('pull for a brand-new remote item', () => {
    const res = reconcileItem({ base: null, local: null, remote: { a: 1 }, merge })
    expect(res.action).toBe('pull')
  })
  it('delete-local when remote tombstoned an unchanged local', () => {
    const res = reconcileItem({ base: { a: 1 }, local: { a: 1 }, remote: null, merge })
    expect(res.action).toBe('delete-local')
  })
  it('tombstone when local deleted an unchanged remote', () => {
    const res = reconcileItem({ base: { a: 1 }, local: null, remote: { a: 1 }, merge })
    expect(res.action).toBe('tombstone')
  })
  it('keeps the edit when delete races edit', () => {
    const res = reconcileItem({ base: { a: 1 }, local: null, remote: { a: 2 }, merge })
    expect(res.action).toBe('pull'); expect(res.value).toEqual({ a: 2 })
  })
})

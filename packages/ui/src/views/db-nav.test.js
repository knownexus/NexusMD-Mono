// packages/ui/src/views/db-nav.test.js
import { describe, it, expect } from 'vitest'
import { pushNav, popNav } from './db-nav.js'

describe('back history', () => {
  it('pops what was pushed last, without changing the stack it was given', () => {
    const one = pushNav([], { table: 'a' })
    const two = pushNav(one, { table: 'b' })
    expect(one).toEqual([{ table: 'a' }])
    const [entry, rest] = popNav(two)
    expect(entry).toEqual({ table: 'b' })
    expect(rest).toEqual([{ table: 'a' }])
    expect(two).toHaveLength(2)
  })

  it('keeps the newest 50, dropping the oldest', () => {
    let stack = []
    for (let i = 0; i < 52; i++) stack = pushNav(stack, { table: `t${i}` })
    expect(stack).toHaveLength(50)
    expect(stack[0]).toEqual({ table: 't2' })
    expect(stack[49]).toEqual({ table: 't51' })
  })

  it('gives null and an empty stack when there is nothing to pop', () => {
    expect(popNav([])).toEqual([null, []])
  })
})

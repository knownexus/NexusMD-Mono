// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createTraceLink } = require('./link.cjs')

describe('createTraceLink: which window call an IPC call came from', () => {
  it('hands back the window frame noted for that window and channel, once, oldest first', () => {
    const link = createTraceLink()
    link.note(1, 'git:push', 'r1-5')
    link.note(1, 'git:push', 'r1-9')
    expect(link.take(1, 'git:push')).toBe('r1-5')
    expect(link.take(1, 'git:push')).toBe('r1-9')
    expect(link.take(1, 'git:push')).toBeNull()
  })

  it('keeps windows and channels apart', () => {
    const link = createTraceLink()
    link.note(1, 'a:x', 'r1-1'); link.note(2, 'a:x', 'r2-1'); link.note(1, 'b:y', 'r1-2')
    expect(link.take(2, 'a:x')).toBe('r2-1')
    expect(link.take(1, 'b:y')).toBe('r1-2')
    expect(link.take(1, 'a:x')).toBe('r1-1')
  })

  it('returns null for a call nobody noted, and for an unknown sender', () => {
    const link = createTraceLink()
    expect(link.take(1, 'git:push')).toBeNull()
    expect(link.take(undefined, 'git:push')).toBeNull()
  })

  it('keeps only the newest few per channel, so a channel nobody takes from cannot grow without bound', () => {
    const link = createTraceLink({ max: 3 })
    for (let i = 1; i <= 10; i++) link.note(1, 'x:y', `r1-${i}`)
    expect([link.take(1, 'x:y'), link.take(1, 'x:y'), link.take(1, 'x:y'), link.take(1, 'x:y')]).toEqual(['r1-8', 'r1-9', 'r1-10', null])
  })

  it('ignores a call id that is not a frame id, and clear() forgets everything', () => {
    const link = createTraceLink()
    link.note(1, 'x:y', '../../etc'); link.note(1, 'x:y', 42); link.note(1, 'x:y', 'r1-1')
    expect(link.take(1, 'x:y')).toBe('r1-1')
    link.note(1, 'x:y', 'r1-2'); link.clear()
    expect(link.take(1, 'x:y')).toBeNull()
  })
})

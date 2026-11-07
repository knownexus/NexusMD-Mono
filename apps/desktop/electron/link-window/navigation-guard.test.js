import { describe, it, expect, vi } from 'vitest'
import { createNavigationGuard } from './navigation-guard.cjs'

const run = (current, target) => {
  const event = { preventDefault: vi.fn() }
  createNavigationGuard(() => current)(event, target)
  return event.preventDefault.mock.calls.length > 0
}

describe('createNavigationGuard', () => {
  it('lets the app move within itself: the same page, a #hash, the dev server', () => {
    expect(run('file:///app/index.html#/git', 'file:///app/index.html#/work')).toBe(false)
    expect(run('http://localhost:5173/#a', 'http://localhost:5173/#b')).toBe(false)
    expect(run('http://localhost:5173/', 'http://localhost:5173/?x=1')).toBe(false)
  })

  it('stops the window going to another site, another file, or a script', () => {
    expect(run('file:///app/index.html', 'https://evil.example/')).toBe(true)
    expect(run('http://localhost:5173/', 'http://evil.example:5173/')).toBe(true)
    expect(run('file:///app/index.html', 'file:///etc/passwd')).toBe(true)
    expect(run('file:///app/index.html', 'javascript:alert(1)')).toBe(true)
    expect(run('file:///app/index.html', 'data:text/html,<script>1</script>')).toBe(true)
  })

  it('stops anything it cannot read as a address', () => {
    expect(run('file:///app/index.html', 'not a url')).toBe(true)
    expect(run('', 'https://evil.example/')).toBe(true)
  })
})

import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'

const { createOpenFileQueue } = createRequire(import.meta.url)('./open-file-queue.cjs')

// macOS tells a running or starting app about a file opened with it through the 'open-file' event, not on the command line
// (Windows and Linux put it in argv, which the apps already read). The queue turns those events into the same thing: paths
// added to the launch command line when they arrive before the apps are ready, and "launched again" calls after.
describe('files macOS opens the app with', () => {
  it('keeps files that arrive before the app is ready, to be added to the command line it started with', () => {
    const q = createOpenFileQueue()
    q.add('/Users/a/one.md')
    q.add('/Users/a/two.json')
    expect(q.take()).toEqual(['/Users/a/one.md', '/Users/a/two.json'])
    expect(q.take()).toEqual([])
  })

  it('hands files that arrive once the app is running to the listener, as a command line, in order', () => {
    const q = createOpenFileQueue()
    const heard = vi.fn()
    q.listen(heard, '/Applications/NexusMD.app/Contents/MacOS/NexusMD')
    q.add('/Users/a/three.ts')
    expect(heard).toHaveBeenCalledWith(['/Applications/NexusMD.app/Contents/MacOS/NexusMD', '/Users/a/three.ts'])
  })

  it('does not hand over files twice: those taken at startup are not sent again when the listener attaches', () => {
    const q = createOpenFileQueue()
    const heard = vi.fn()
    q.add('/Users/a/early.md')
    q.take()
    q.listen(heard, 'exe')
    expect(heard).not.toHaveBeenCalled()
  })

  it('ignores anything that is not a path', () => {
    const q = createOpenFileQueue()
    q.add(undefined); q.add(''); q.add(42)
    expect(q.take()).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import {
  createTimer, elapsedMs, start, pause, resume, stop, reset,
} from './index.js'

describe('timer engine — stopwatch', () => {
  it('createTimer returns an idle stopwatch with zero elapsed', () => {
    const t = createTimer()
    expect(t.mode).toBe('stopwatch')
    expect(t.status).toBe('idle')
    expect(elapsedMs(t, 1000)).toBe(0)
  })

  it('start begins running and elapsed grows with now', () => {
    const t = start(createTimer(), 1000)
    expect(t.status).toBe('running')
    expect(elapsedMs(t, 1000)).toBe(0)
    expect(elapsedMs(t, 4000)).toBe(3000)
  })

  it('pause folds elapsed into accumulatedMs and freezes it', () => {
    let t = start(createTimer(), 1000)
    t = pause(t, 4000)
    expect(t.status).toBe('paused')
    expect(t.accumulatedMs).toBe(3000)
    expect(elapsedMs(t, 9999)).toBe(3000)
  })

  it('resume continues from accumulated elapsed', () => {
    let t = start(createTimer(), 1000)
    t = pause(t, 4000)      // 3000 accumulated
    t = resume(t, 10000)
    expect(t.status).toBe('running')
    expect(elapsedMs(t, 12000)).toBe(5000)  // 3000 + 2000
  })

  it('stop marks done and freezes total elapsed', () => {
    let t = start(createTimer(), 1000)
    t = stop(t, 6000)
    expect(t.status).toBe('done')
    expect(elapsedMs(t, 99999)).toBe(5000)
  })

  it('reset returns to idle with zero elapsed', () => {
    let t = start(createTimer(), 1000)
    t = stop(t, 6000)
    t = reset(t)
    expect(t.status).toBe('idle')
    expect(elapsedMs(t, 99999)).toBe(0)
  })

  it('functions never mutate the input state', () => {
    const t0 = createTimer()
    start(t0, 1000)
    expect(t0.status).toBe('idle')
  })

  it('survives serialize → rehydrate and keeps counting from real time', () => {
    const running = start(createTimer(), 1000)
    const rehydrated = JSON.parse(JSON.stringify(running))
    // 10s of wall-clock passed while the app was closed
    expect(elapsedMs(rehydrated, 11000)).toBe(10000)
  })
})

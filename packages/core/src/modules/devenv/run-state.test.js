import { describe, it, expect } from 'vitest'
import {
  createRunState, applyStarting, applyStarted, applyStartFailed, applyLine,
  applyAnswered, applyOpened, applyCancelRequested, applyExit, MAX_LINES,
} from './run-state.js'

const P = '@@devenv '
const run = () => applyStarted(applyStarting(createRunState('db restore')), 7)

describe('run state', () => {
  it('starts idle, then running with a runId', () => {
    expect(createRunState('x').status).toBe('idle')
    const s = run()
    expect(s.status).toBe('running')
    expect(s.runId).toBe(7)
  })

  it('collects output lines from both streams, control lines only from stdout', () => {
    let s = applyLine(run(), 'stdout', 'hello')
    s = applyLine(s, 'stderr', P + '{"type":"step","n":1,"total":2,"text":"x"}')
    expect(s.lines).toEqual([{ stream: 'stdout', text: 'hello' }, { stream: 'stderr', text: P + '{"type":"step","n":1,"total":2,"text":"x"}' }])
    expect(s.step).toBeNull()
  })

  it('queues prompts, tracks the latest step, and keeps results and opens', () => {
    let s = applyLine(run(), 'stdout', P + '{"type":"prompt","id":"p1","kind":"text","title":"Ref"}')
    s = applyLine(s, 'stdout', P + '{"type":"step","n":2,"total":5,"text":"Build"}')
    s = applyLine(s, 'stdout', P + '{"type":"result","kind":"summary"}')
    s = applyLine(s, 'stdout', P + '{"type":"open","url":"http://127.0.0.1:5280"}')
    expect(s.prompts.map(p => p.id)).toEqual(['p1'])
    expect(s.step).toEqual({ n: 2, total: 5, text: 'Build' })
    expect(s.results).toEqual([{ type: 'result', kind: 'summary' }])
    expect(s.opens).toEqual([{ type: 'open', url: 'http://127.0.0.1:5280' }])
    expect(s.lines).toEqual([])
    expect(applyOpened(s).opens).toEqual([])
  })

  it('ignores unknown control types instead of showing them', () => {
    expect(applyLine(run(), 'stdout', P + '{"type":"future-thing"}').lines).toEqual([])
  })

  it('removes an answered prompt and never stores the answer', () => {
    let s = applyLine(run(), 'stdout', P + '{"type":"prompt","id":"p1","kind":"secret","title":"Mac password"}')
    s = applyAnswered(s, 'p1')
    expect(s.prompts).toEqual([])
    expect(JSON.stringify(s)).not.toContain('hunter22')
  })

  it('caps the output buffer', () => {
    let s = run()
    for (let i = 0; i < MAX_LINES + 10; i++) s = applyLine(s, 'stdout', `line ${i}`)
    expect(s.lines).toHaveLength(MAX_LINES)
    expect(s.lines[0].text).toBe('line 10')
  })

  it('exit 0 is done, non-zero is failed, and pending prompts are dropped', () => {
    let s = applyLine(run(), 'stdout', P + '{"type":"prompt","id":"p1","kind":"text","title":"x"}')
    expect(applyExit(s, 0).status).toBe('done')
    const failed = applyExit(s, 1)
    expect(failed.status).toBe('failed')
    expect(failed.exitCode).toBe(1)
    expect(failed.prompts).toEqual([])
  })

  it('a cancelled run ends as cancelled whatever the exit code', () => {
    let s = applyLine(run(), 'stdout', P + '{"type":"prompt","id":"p1","kind":"choice","title":"x"}')
    s = applyCancelRequested(s)
    expect(s.cancelling).toBe(true)
    s = applyExit(s, 1)
    expect(s.status).toBe('cancelled')
    expect(s.prompts).toEqual([])
  })

  it('a failed start records the message', () => {
    const s = applyStartFailed(applyStarting(createRunState('x')), 'No devenv.ps1 in C:\\nope')
    expect(s.status).toBe('failed')
    expect(s.error).toBe('No devenv.ps1 in C:\\nope')
  })
})

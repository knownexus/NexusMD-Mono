import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PlanDialog } from './plan-dialog.jsx'

afterEach(cleanup)

const plan = {
  locked: true, lockError: null, database: 'asis', baseline: null, rememberedBaseline: null,
  emulator: false, ios: 'off', macHost: null, macError: 'no mac.json', dockerApis: 'Orders API',
  test: 'off', testError: null, testServices: ['orders'],
  backups: [{ id: 'b1', size: 1048576, isLatest: true }],
  testApis: [{ key: 'orders', label: 'Orders API', port: 5201 }],
  services: [
    { key: 'orders', label: 'Orders API', ref: 'main', branch: 'main', sha: 'abc1234567', dirty: false, action: 'skip', built: true, remembered: false },
    { key: 'mobile', label: 'Mobile app', ref: 'main', branch: 'feature/x', sha: 'def6789012', dirty: true, action: 'build', built: false, remembered: false },
  ],
}
const prompt = over => ({ type: 'prompt', id: 'p1', kind: 'plan', title: 'Local session - review, then start', plan: { ...plan, ...over } })

describe('PlanDialog', () => {
  it('shows each source with branch, dirty marker and short sha', () => {
    render(<PlanDialog prompt={prompt()} onAnswer={vi.fn()} />)
    expect(screen.getByText('feature/x*')).toBeTruthy()
    expect(screen.getByText('def67890')).toBeTruthy()
  })

  it('Start answers devplan\'s result with the edited choices', () => {
    const onAnswer = vi.fn()
    render(<PlanDialog prompt={prompt()} onAnswer={onAnswer} />)
    fireEvent.change(screen.getByLabelText('Build Orders API'), { target: { value: 'clean' } })
    fireEvent.click(screen.getByLabelText('Start the Android emulator'))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onAnswer).toHaveBeenCalledWith({
      action: 'start', services: { orders: 'clean', mobile: 'build' }, database: 'asis', baseline: null,
      emulator: true, ios: 'off', test: 'off', testServices: ['orders'],
    })
  })

  it('Change branch answers change-ref with the current choices', () => {
    const onAnswer = vi.fn()
    render(<PlanDialog prompt={prompt()} onAnswer={onAnswer} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Change branch…' })[1])
    expect(onAnswer.mock.calls[0][0].action).toBe('change-ref:mobile')
  })

  it('blocks Start on an unlocked plan but still allows Change branch', () => {
    const onAnswer = vi.fn()
    render(<PlanDialog prompt={prompt({ locked: false, lockError: "ref 'nope' not found" })} onAnswer={onAnswer} />)
    expect(screen.getByText("Pick a branch that exists for every source first: ref 'nope' not found")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start' }).disabled).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: 'Change branch…' })[0])
    expect(onAnswer.mock.calls[0][0].action).toBe('change-ref:orders')
  })

  it('wipe needs YES typed before Start', () => {
    const onAnswer = vi.fn()
    render(<PlanDialog prompt={prompt()} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByLabelText(/Wipe the SQL volume/))
    expect(screen.getByRole('button', { name: 'Start' }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Type YES to wipe'), { target: { value: 'YES' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ action: 'start', database: 'wipe', baseline: 'b1' }))
  })

  it('disables iOS with the Mac error', () => {
    render(<PlanDialog prompt={prompt()} onAnswer={vi.fn()} />)
    expect(screen.getByText('no mac.json')).toBeTruthy()
    expect(screen.getByLabelText('Build, then run on the simulator').disabled).toBe(true)
  })

  it('Cancel and Esc answer action cancel (not a protocol cancel)', () => {
    const onAnswer = vi.fn()
    render(<PlanDialog prompt={prompt()} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onAnswer).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'cancel' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onAnswer).toHaveBeenCalledTimes(2)
    expect(onAnswer.mock.calls[1][0].action).toBe('cancel')
  })
})

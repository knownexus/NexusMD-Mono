import React from 'react'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TimeApp } from './time-app.jsx'

const at = (h, m = 0) => new Date(2026, 9, 15, h, m).getTime()
const tickets = [{ id: 'PAY-12', title: 'Fix refund rounding', source: 'jira' }, { id: '4411', title: 'Login timeout', source: 'ado' }]
const host = { capabilities: { has: n => n === 'work.items', call: () => tickets } }

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(at(9)) })
afterEach(() => vi.useRealTimers())

const field = () => screen.getByLabelText('What are you working on')

describe('Time', () => {
  it('invites you to start when the log is empty', () => {
    render(<TimeApp host={host}/>)
    expect(screen.getByText('Nothing running')).toBeTruthy()
    expect(screen.getByText('No time logged yet.')).toBeTruthy()
  })

  it('starts a free-text task with Enter and counts up', () => {
    render(<TimeApp host={host}/>)
    fireEvent.change(field(), { target: { value: 'Planning' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(screen.getByRole('timer').textContent).toBe('00:00')
    vi.setSystemTime(at(9, 5)); act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('timer').textContent).toBe('05:01')
  })

  it('offers matching tickets and starts against the one picked', () => {
    render(<TimeApp host={host}/>)
    fireEvent.change(field(), { target: { value: 'refund' } })
    fireEvent.keyDown(field(), { key: 'Enter' }) // picks the highlighted suggestion
    expect(field().value).toBe('Fix refund rounding')
    fireEvent.keyDown(field(), { key: 'Enter' }) // then starts it
    const bar = screen.getByRole('timer').closest('section')
    expect(within(bar).getByText('PAY-12')).toBeTruthy()
  })

  it('keeps a stopped entry in the log and lets you continue it', () => {
    render(<TimeApp host={host}/>)
    fireEvent.change(field(), { target: { value: 'Planning' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    vi.setSystemTime(at(9, 30)); act(() => { vi.advanceTimersByTime(1000) })
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
    expect(screen.getByText('Nothing running')).toBeTruthy()
    expect(screen.getAllByText('30m').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Continue Planning' }))
    expect(screen.getByRole('timer').closest('section').textContent).toContain('Planning')
  })

  describe('correcting a saved entry', () => {
    const logged = () => {
      render(<TimeApp host={host}/>)
      fireEvent.change(field(), { target: { value: 'Planning' } })
      fireEvent.keyDown(field(), { key: 'Enter' })
      vi.setSystemTime(at(10)); act(() => { vi.advanceTimersByTime(1000) })
      fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
      vi.setSystemTime(at(12)); act(() => { vi.advanceTimersByTime(1000) })
      fireEvent.click(screen.getByRole('button', { name: 'Edit Planning' }))
    }
    const timeInputs = () => document.querySelectorAll('input[type="time"]')

    it('moves the end earlier when you forgot to stop', () => {
      logged()
      fireEvent.change(timeInputs()[1], { target: { value: '09:20' } })
      expect(document.querySelector('.tl-counts').textContent).toBe('20m')
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(screen.getAllByText('20m').length).toBeGreaterThan(0)
    })

    it('moves the start earlier when you forgot to start', () => {
      logged()
      fireEvent.change(timeInputs()[0], { target: { value: '08:30' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(screen.getAllByText('1h 30m').length).toBeGreaterThan(0)
    })

    it('nudges by five minutes', () => {
      logged()
      fireEvent.click(screen.getByRole('button', { name: 'End 5 minutes earlier' }))
      expect(timeInputs()[1].value).toBe('09:55')
    })

    it('takes a break off the time', () => {
      logged()
      fireEvent.change(screen.getByLabelText('Break in minutes'), { target: { value: '15' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(screen.getAllByText('45m').length).toBeGreaterThan(0)
      expect(screen.getByText(/−15m break/)).toBeTruthy()
    })

    it('refuses an end before the start and says why', () => {
      logged()
      fireEvent.change(timeInputs()[1], { target: { value: '08:00' } })
      expect(screen.getByRole('alert').textContent).toMatch(/after the start/)
      expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
    })
  })

  it('deletes an entry and brings it back with Undo', () => {
    render(<TimeApp host={host}/>)
    fireEvent.change(field(), { target: { value: 'Planning' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Planning' }))
    expect(screen.getByText('No time logged yet.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.queryByText('No time logged yet.')).toBeNull()
  })
})

describe('Time: several timers, notes, tickets and the timeline', () => {
  const start = (text, note) => {
    fireEvent.change(field(), { target: { value: text } })
    if (note) {
      fireEvent.click(screen.getByRole('button', { name: /Note/ }))
      fireEvent.change(screen.getByLabelText('Note before starting'), { target: { value: note } })
    }
    fireEvent.keyDown(field(), { key: 'Enter' })
  }
  const tick = ms => { vi.setSystemTime(Date.now() + ms); act(() => { vi.advanceTimersByTime(1000) }) }

  it('runs several timers at once, each with its own clock and Stop', () => {
    render(<TimeApp host={host}/>)
    start('Planning')
    tick(10 * 60000)
    start('Code review')
    tick(5 * 60000)
    const clocks = screen.getAllByRole('timer').map(c => c.textContent)
    expect(clocks).toEqual(['15:02', '05:01'])
    fireEvent.click(screen.getByRole('button', { name: 'Stop Planning' }))
    expect(screen.getAllByRole('timer')).toHaveLength(1)
    expect(screen.getByRole('timer', { name: /Code review/ })).toBeTruthy()
  })

  it('takes a note before starting, during the timer and after it stops, each stamped', () => {
    render(<TimeApp host={host}/>)
    start('Planning', 'Aim: agree the scope')
    const running = () => screen.getByRole('region', { name: 'Running' })
    expect(within(running()).getByText('Aim: agree the scope')).toBeTruthy()
    tick(20 * 60000)
    const during = within(running()).getByLabelText('Add a note')
    fireEvent.change(during, { target: { value: 'Scope cut to two screens' } })
    fireEvent.keyDown(during, { key: 'Enter' })
    expect(within(running()).getByText('Scope cut to two screens')).toBeTruthy()
    expect(within(running()).getByText('09:20')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop Planning' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add note to Planning' }))
    const after = screen.getByLabelText('Add a note')
    fireEvent.change(after, { target: { value: 'Send the summary' } })
    fireEvent.keyDown(after, { key: 'Enter' })
    const log = screen.getByRole('region', { name: 'Time entries' })
    expect(within(log).getByText('Send the summary')).toBeTruthy()
    expect(within(log).getByText('Aim: agree the scope')).toBeTruthy()
  })

  it('assigns a finished timer to a ticket afterwards', () => {
    render(<TimeApp host={host}/>)
    start('Debugging')
    tick(30 * 60000)
    fireEvent.click(screen.getByRole('button', { name: 'Stop Debugging' }))
    fireEvent.click(screen.getByRole('button', { name: 'Assign ticket' }))
    const find = screen.getByLabelText('Find a ticket')
    fireEvent.change(find, { target: { value: '4411' } })
    fireEvent.keyDown(find, { key: 'Enter' })
    const log = screen.getByRole('region', { name: 'Time entries' })
    expect(within(log).getByText('4411')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Assign ticket' })).toBeNull()
  })

  it('shows the day as a timeline in order, with notes, and copies it as markdown', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<TimeApp host={host}/>)
    start('Planning', 'Aim: agree the scope')
    tick(30 * 60000)
    fireEvent.click(screen.getByRole('button', { name: 'Stop Planning' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }))
    const items = screen.getAllByRole('listitem').map(li => li.textContent)
    expect(items.some(t => t.includes('Started') && t.includes('Planning'))).toBe(true)
    expect(items.some(t => t.includes('Aim: agree the scope'))).toBe(true)
    expect(items.some(t => t.includes('Stopped') && t.includes('30m'))).toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Copy as markdown/ })) })
    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText.mock.calls[0][0]).toContain('Started Planning')
    expect(writeText.mock.calls[0][0]).toContain('Aim: agree the scope')
  })

  it('says what the timeline is for when the day is empty', () => {
    render(<TimeApp host={host}/>)
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }))
    expect(screen.getByText(/in the order things happened/)).toBeTruthy()
  })
})

describe('Time: marks, splitting and assigning several timers', () => {
  const start = text => { fireEvent.change(field(), { target: { value: text } }); fireEvent.keyDown(field(), { key: 'Enter' }) }
  const tick = ms => { vi.setSystemTime(Date.now() + ms); act(() => { vi.advanceTimersByTime(1000) }) }
  const log = () => screen.getByRole('region', { name: 'Time entries' })
  const markNow = (name, note) => {
    fireEvent.click(screen.getByRole('button', { name: `Mark now on ${name}` }))
    if (note !== undefined) {
      const inputs = screen.getAllByPlaceholderText('Add a note to this mark')
      const input = inputs[inputs.length - 1]
      fireEvent.change(input, { target: { value: note } })
      fireEvent.blur(input)
    }
  }

  it('drops a mark at this moment while a timer runs, and a note can be attached', () => {
    render(<TimeApp host={host}/>)
    start('Payments')
    tick(20 * 60000)
    markNow('Payments', 'moved to the email copy')
    const running = screen.getByRole('region', { name: 'Running' })
    expect(within(running).getByText('moved to the email copy')).toBeTruthy()
    expect(within(running).getByText(/09:20/)).toBeTruthy()
    expect(screen.getAllByRole('timer')).toHaveLength(1) // the timer carried on
  })

  it('splits a finished timer at its marks into separate entries', () => {
    render(<TimeApp host={host}/>)
    start('Payments')
    tick(20 * 60000); markNow('Payments', 'email copy')
    tick(20 * 60000); markNow('Payments')
    tick(20 * 60000)
    fireEvent.click(screen.getByRole('button', { name: 'Stop Payments' }))
    expect(within(log()).getAllByLabelText('Select Payments')).toHaveLength(1)
    fireEvent.click(within(log()).getByRole('button', { name: 'Split into 3 entries' }))
    expect(within(log()).getAllByLabelText('Select Payments')).toHaveLength(3)
    expect(screen.getByRole('status').textContent).toContain('Entry split at its marks.')
    expect(within(log()).getByText('email copy')).toBeTruthy() // the mark's note moved to the part it starts
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(within(log()).getAllByLabelText('Select Payments')).toHaveLength(1)
  })

  it('marks a moment you forgot to mark on a finished timer', () => {
    render(<TimeApp host={host}/>)
    start('Payments')
    tick(60 * 60000)
    fireEvent.click(screen.getByRole('button', { name: 'Stop Payments' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add mark to Payments' }))
    fireEvent.change(screen.getByLabelText('Mark time'), { target: { value: '09:30' } })
    fireEvent.change(screen.getByLabelText('Mark note'), { target: { value: 'switched task' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add mark' }))
    expect(within(log()).getByText('switched task')).toBeTruthy()
    expect(within(log()).getByRole('button', { name: 'Split into 2 entries' })).toBeTruthy()
  })

  it('will not mark a time outside the timer', () => {
    render(<TimeApp host={host}/>)
    start('Payments')
    tick(30 * 60000)
    fireEvent.click(screen.getByRole('button', { name: 'Stop Payments' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add mark to Payments' }))
    fireEvent.change(screen.getByLabelText('Mark time'), { target: { value: '11:00' } })
    expect(screen.getByRole('button', { name: 'Add mark' }).disabled).toBe(true)
    expect(screen.getByText(/Pick a time between/)).toBeTruthy()
  })

  it('assigns several timers to one ticket at once', () => {
    render(<TimeApp host={host}/>)
    start('Debugging'); tick(10 * 60000); fireEvent.click(screen.getByRole('button', { name: 'Stop Debugging' }))
    start('Code review'); tick(10 * 60000); fireEvent.click(screen.getByRole('button', { name: 'Stop Code review' }))
    start('Standup'); tick(5 * 60000); fireEvent.click(screen.getByRole('button', { name: 'Stop Standup' }))
    fireEvent.click(screen.getByLabelText('Select Debugging'))
    fireEvent.click(screen.getByLabelText('Select Code review'))
    const bulk = screen.getByRole('region', { name: 'Selected entries' })
    expect(bulk.textContent).toContain('2 selected')
    fireEvent.click(within(bulk).getByRole('button', { name: /Assign to ticket/ }))
    const find = within(bulk).getByLabelText('Find a ticket')
    fireEvent.change(find, { target: { value: 'PAY-12' } })
    fireEvent.keyDown(find, { key: 'Enter' })
    expect(screen.queryByRole('region', { name: 'Selected entries' })).toBeNull()
    expect(within(log()).getAllByText('PAY-12')).toHaveLength(2)
    expect(screen.getByRole('status').textContent).toContain('2 entries assigned to PAY-12.')
    expect(screen.getAllByRole('button', { name: 'Assign ticket' })).toHaveLength(1) // Standup is untouched
  })

  it('undoes a bulk assignment', () => {
    render(<TimeApp host={host}/>)
    start('Debugging'); tick(10 * 60000); fireEvent.click(screen.getByRole('button', { name: 'Stop Debugging' }))
    fireEvent.click(screen.getByLabelText('Select Debugging'))
    fireEvent.click(screen.getByRole('button', { name: /Assign to ticket/ }))
    const find = screen.getByLabelText('Find a ticket')
    fireEvent.change(find, { target: { value: '4411' } })
    fireEvent.keyDown(find, { key: 'Enter' })
    expect(screen.queryByRole('button', { name: 'Assign ticket' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('button', { name: 'Assign ticket' })).toBeTruthy()
  })

  it('shows marks on the timeline and in the copied markdown', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<TimeApp host={host}/>)
    start('Payments'); tick(20 * 60000); markNow('Payments', 'email copy'); tick(20 * 60000)
    fireEvent.click(screen.getByRole('button', { name: 'Stop Payments' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }))
    expect(screen.getAllByRole('listitem').some(li => li.textContent.includes('Mark') && li.textContent.includes('email copy'))).toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Copy as markdown/ })) })
    expect(writeText.mock.calls[0][0]).toContain('Mark: email copy')
  })
})

import React from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined }))

import { TestsView } from './view-tests.jsx'
import { resultValue, resultLabel } from './tests-phone.jsx'

afterEach(() => { cleanup(); localStorage.clear() })

const runs = [
  { id: 1, pipeline: 'api-ci', result: 'succeeded', branch: 'main', totalTests: 10, passedTests: 10, failedTests: 0, startTime: '2026-10-02' },
  { id: 2, pipeline: 'api-ci', result: 'failed', branch: 'dev', totalTests: 10, passedTests: 8, failedTests: 2, startTime: '2026-10-03' },
  { id: 3, pipeline: 'web-ci', result: 'succeeded', branch: 'main', totalTests: 5, passedTests: 5, failedTests: 0, startTime: '2026-10-01' },
]
const mount = (device = 'phone') => render(<TestsView tests={runs} acknowledgedTests={[]} setAcknowledgedTests={() => {}} device={device}/>)

describe('Tests on a phone', () => {
  it('filters with two dropdowns, not rows of pills', () => {
    mount()
    expect(screen.getByLabelText('Pipeline')).toBeTruthy()
    expect(screen.getByLabelText('Result')).toBeTruthy()
    expect(document.querySelector('.filter-bar')).toBeNull()
  })

  it('narrows the runs by pipeline and by result', () => {
    mount()
    expect(document.querySelectorAll('.m-card .m-row').length).toBe(3)
    fireEvent.change(screen.getByLabelText('Pipeline'), { target: { value: 'api-ci' } })
    expect(document.querySelectorAll('.m-card .m-row').length).toBe(2)
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'failed' } })
    expect(document.querySelectorAll('.m-card .m-row').length).toBe(1)
    fireEvent.click(screen.getAllByText('Clear filters')[0])
    expect(document.querySelectorAll('.m-card .m-row').length).toBe(3)
  })

  it('opens a run to its actions, with Acknowledge only for a failed one', () => {
    mount()
    fireEvent.click(screen.getByText('#1').closest('.m-row'))
    expect(screen.queryByText(/Acknowledge/)).toBeNull()
    expect(screen.getByText('Create bug')).toBeTruthy()
    fireEvent.click(screen.getByText('#2').closest('.m-row'))
    expect(screen.getByText('Acknowledge')).toBeTruthy()
  })

  it('keeps the desktop layout off a phone', () => {
    mount('tablet')
    expect(document.querySelector('.filter-bar')).not.toBeNull()
  })
})

describe('result helpers', () => {
  it('reads a selection of results for the dropdown', () => {
    expect(resultValue(new Set())).toBe('all')
    expect(resultValue(new Set(['failed']))).toBe('failed')
    expect(resultValue(new Set(['failed', 'succeeded']))).toBe('__many')
    expect(resultLabel('partiallySucceeded')).toBe('Partially succeeded')
    expect(resultLabel('whatever')).toBe('whatever')
  })
})

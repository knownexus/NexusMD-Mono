import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { LogPanel } from './log-panel.jsx'

afterEach(cleanup)
const state = over => ({ ...createRunState('devenv backend logs orders'), status: 'running', ...over })
const lines = [{ stream: 'stdout', text: 'info: started' }, { stream: 'stdout', text: 'fail: boom' }, { stream: 'stdout', text: 'warn: slow' }]

describe('LogPanel', () => {
  it('highlights error and warning lines', () => {
    const { container } = render(<LogPanel state={state({ lines })} filter="" onStop={() => {}} />)
    expect(container.querySelectorAll('[data-level="error"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-level="warn"]')).toHaveLength(1)
  })
  it('filters lines and counts them', () => {
    render(<LogPanel state={state({ lines })} filter="BOOM" onStop={() => {}} />)
    expect(screen.queryByText('info: started')).toBeNull()
    expect(screen.getByText('1 of 3 lines')).toBeTruthy()
  })
  it('offers Stop while running and calls it', () => {
    const onStop = vi.fn()
    render(<LogPanel state={state({ lines })} filter="" onStop={onStop} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalled()
  })
  it('has no Stop once finished', () => {
    render(<LogPanel state={state({ lines, status: 'done', exitCode: 0 })} filter="" onStop={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })
})

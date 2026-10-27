import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { RunPanel } from './run-panel.jsx'

const state = over => ({ ...createRunState('db restore'), status: 'running', runId: 1, ...over })

afterEach(cleanup)

describe('RunPanel', () => {
  it('renders coloured output without escape codes', () => {
    const { container } = render(<RunPanel state={state({ lines: [{ stream: 'stdout', text: '\x1b[32mok\x1b[0m done' }] })} onCancel={vi.fn()} />)
    expect(container.textContent).toContain('ok done')
    expect(container.textContent).not.toContain('\x1b')
    expect(container.querySelector('[data-color="green"]').textContent).toBe('ok')
  })

  it('shows step progress and a Cancel button while running', () => {
    const onCancel = vi.fn()
    render(<RunPanel state={state({ step: { n: 2, total: 5, text: 'Building APIs' } })} onCancel={onCancel} />)
    screen.getByText('2/5 Building APIs')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows the exit badge and no Cancel once finished', () => {
    render(<RunPanel state={state({ status: 'failed', exitCode: 1 })} onCancel={vi.fn()} />)
    screen.getByText('Failed (exit 1)')
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('shows a start error', () => {
    render(<RunPanel state={state({ status: 'failed', error: 'No devenv.ps1 in C:\\x' })} onCancel={vi.fn()} />)
    screen.getByText('No devenv.ps1 in C:\\x')
  })
})

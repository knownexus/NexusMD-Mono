import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PromptHost } from './prompt-host.jsx'

afterEach(cleanup)

describe('PromptHost', () => {
  it('routes plan, ref and other kinds to their dialogs', () => {
    const { unmount } = render(<PromptHost prompt={{ id: 'p1', kind: 'plan', title: 'Plan title', plan: { locked: true, services: [], backups: [], testApis: [] } }} onAnswer={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy()
    unmount()
    const r2 = render(<PromptHost prompt={{ id: 'p2', kind: 'ref', title: 'Branch', ref: { name: 'a', worktrees: [], remotes: [] } }} onAnswer={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Branch, tag or SHA')).toBeTruthy()
    r2.unmount()
    render(<PromptHost prompt={{ id: 'p3', kind: 'text', title: 'Name?', prompt: 'Name?' }} onAnswer={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy()
  })
})

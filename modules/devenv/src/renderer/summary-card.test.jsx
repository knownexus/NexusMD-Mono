import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SummaryCard } from './summary-card.jsx'

afterEach(cleanup)

describe('SummaryCard', () => {
  it('renders rows sharing a key without duplicate-key warnings', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = { type: 'result', kind: 'summary', title: 'T', rows: [{ key: 'H', value: '' }, { key: 'Port', value: 'a1' }, { key: 'Port', value: 'a2' }], notes: ['same', 'same'] }
    render(<SummaryCard result={result} />)
    expect(screen.getAllByText('Port').length).toBe(2)
    expect(screen.getAllByText('same').length).toBe(2)
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })
})

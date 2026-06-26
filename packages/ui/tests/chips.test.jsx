import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { StatusChip, PrioChip, DueLabel } from '../src/index.js'
import { plFmtYmd } from '@nexusmd/core'

afterEach(cleanup)

describe('planner chips (render against core helpers)', () => {
  it('StatusChip shows the current value', () => {
    const { container } = render(<StatusChip value="Blocked" onChange={() => {}} />)
    expect(container.textContent).toContain('Blocked')
    // data-s drives the chip colour
    expect(container.querySelector('.stchip')?.getAttribute('data-s')).toBe('Blocked')
  })

  it('StatusChip shows an em-dash placeholder when empty', () => {
    const { container } = render(<StatusChip value="" onChange={() => {}} />)
    expect(container.textContent).toContain('—')
  })

  it('PrioChip renders the priority number', () => {
    const { container } = render(<PrioChip value="1 - Critical" onChange={() => {}} />)
    expect(container.textContent).toContain('P1')
  })

  it('DueLabel marks an overdue open task with "!"', () => {
    const past = plFmtYmd(new Date(Date.now() - 5 * 86400000))
    const { container } = render(<DueLabel value={past} status="To Do" />)
    expect(container.textContent).toContain('!')
  })

  it('DueLabel shows "Today" for today', () => {
    const today = plFmtYmd(new Date())
    const { container } = render(<DueLabel value={today} status="To Do" />)
    expect(container.textContent).toContain('Today')
  })

  it('DueLabel renders a placeholder for empty input', () => {
    const { container } = render(<DueLabel value="" />)
    expect(container.textContent).toContain('—')
  })
})

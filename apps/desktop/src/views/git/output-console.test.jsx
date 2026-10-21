import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { OutputConsole } from './output-console.jsx'

afterEach(cleanup)

const run = n => Array.from({ length: n }, (_, i) => ({ text: `line ${i}`, tone: i === 0 ? 'cmd' : undefined }))

describe('OutputConsole', () => {
  it('opens when output arrives and can be minimised and restored', () => {
    const { rerender } = render(<OutputConsole lines={[]}><input aria-label="git command" /></OutputConsole>)
    expect(screen.queryByLabelText('Command output')).toBeNull()
    rerender(<OutputConsole lines={run(3)}><input aria-label="git command" /></OutputConsole>)
    expect(screen.getByLabelText('Command output').textContent).toContain('line 2')
    fireEvent.click(screen.getByLabelText('Minimise output'))
    expect(screen.queryByLabelText('Command output')).toBeNull()
    fireEvent.click(screen.getByLabelText('Show output'))
    expect(screen.getByLabelText('Command output')).toBeTruthy()
  })

  it('stays minimised on new output and counts it as unread', () => {
    const { rerender } = render(<OutputConsole lines={run(1)} />)
    fireEvent.click(screen.getByLabelText('Minimise output'))
    rerender(<OutputConsole lines={run(4)} />)
    expect(screen.queryByLabelText('Command output')).toBeNull()
    expect(screen.getByLabelText('Show output, 1 new')).toBeTruthy()
  })

  it('expands without unmounting the command line', () => {
    render(<OutputConsole lines={run(2)}><input aria-label="git command" /></OutputConsole>)
    fireEvent.click(screen.getByRole('button', { name: 'Expand ▴' }))
    expect(screen.getByLabelText('Command output').hasAttribute('data-big')).toBe(true)
    expect(screen.getByLabelText('git command')).toBeTruthy()
  })

  it('lists activity oldest first', () => {
    const activity = [{ at: 2, ok: true, kind: 'push', label: 'feat', summary: 'pushed' }, { at: 1, ok: false, kind: 'pull', label: 'main', summary: 'failed' }]
    render(<OutputConsole lines={run(1)} activity={activity} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Activity 2' }))
    const text = screen.getByLabelText('Command output').textContent
    expect(text.indexOf('main — failed')).toBeLessThan(text.indexOf('feat — pushed'))
  })
})

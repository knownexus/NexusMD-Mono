import { describe, it, expect, afterEach, vi } from 'vitest'
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

  it('keeps ANSI colours on the theme and copies the text without the codes', () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<OutputConsole lines={[{ text: '$ git log', tone: 'cmd' }, { text: '\u001b[33mabc1234\u001b[m subject' }]} />)
    const hash = screen.getByText('abc1234')
    expect(hash.style.color).toBe('var(--warning)')
    expect(screen.getByLabelText('Command output').textContent).not.toContain('\u001b')
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('$ git log\nabc1234 subject')
  })

  it('opens for a command that starts, showing it as still working', () => {
    const { rerender } = render(<OutputConsole lines={[]} />)
    rerender(<OutputConsole lines={[]} running={{ text: '$ git fetch', tone: 'cmd' }} />)
    const out = screen.getByLabelText('Command output')
    expect(out.textContent).toContain('$ git fetch')
    expect(out.textContent).toContain('Working…')
  })

  it('hands its chip to a command line that places it in its own hint row', () => {
    render(<OutputConsole lines={run(1)}>{chip => <div data-testid="bar">{chip}</div>}</OutputConsole>)
    fireEvent.click(screen.getByLabelText('Minimise output'))
    expect(screen.getByTestId('bar').textContent).toBe('Output ▴')
  })

  it('renders nothing with no command line and nothing to show', () => {
    const { container } = render(<OutputConsole lines={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('offers Retry failed under a run with a failure', () => {
    const onRetry = vi.fn()
    const activity = [{ runId: '2', at: 3, ok: true, kind: 'fetch', label: 'C', summary: 'Done' }, { runId: '1', at: 2, ok: false, kind: 'push', label: 'B', summary: 'boom' }, { runId: '1', at: 1, ok: true, kind: 'push', label: 'A', summary: 'Done' }]
    render(<OutputConsole lines={run(1)} activity={activity} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Activity 3' }))
    const retries = screen.getAllByRole('button', { name: 'Retry failed' })
    expect(retries).toHaveLength(1)
    fireEvent.click(retries[0])
    expect(onRetry).toHaveBeenCalledWith('1')
  })

  it('lists activity oldest first', () => {
    const activity = [{ at: 2, ok: true, kind: 'push', label: 'feat', summary: 'pushed' }, { at: 1, ok: false, kind: 'pull', label: 'main', summary: 'failed' }]
    render(<OutputConsole lines={run(1)} activity={activity} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Activity 2' }))
    const text = screen.getByLabelText('Command output').textContent
    expect(text.indexOf('main — failed')).toBeLessThan(text.indexOf('feat — pushed'))
  })
})

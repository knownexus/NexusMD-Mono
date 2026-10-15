import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { GitCommandLine, splitArgs } from './git-command-line.jsx'

afterEach(cleanup)

describe('splitArgs', () => {
  it('splits on whitespace and keeps quoted text, empty quotes included, as one argument', () => {
    expect(splitArgs('log  --oneline -5')).toEqual(['log', '--oneline', '-5'])
    expect(splitArgs(`commit -m "two words" --author='A B'`)).toEqual(['commit', '-m', 'two words', '--author=A B'])
    expect(splitArgs('commit -m ""')).toEqual(['commit', '-m', ''])
  })
})

describe('GitCommandLine', () => {
  const show = (props = {}) => {
    const onRun = vi.fn()
    render(<GitCommandLine path="C:/repos/A" onRun={onRun} {...props} />)
    return { onRun, input: screen.getByLabelText('git command') }
  }

  it('runs on Enter without a leading "git" and clears the line', () => {
    const { onRun, input } = show()
    fireEvent.change(input, { target: { value: 'git status --short' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRun).toHaveBeenCalledWith(['status', '--short'])
    expect(input.value).toBe('')
  })

  it('steps back and forward through this session\'s commands', () => {
    const { input } = show()
    for (const c of ['status', 'log -1']) {
      fireEvent.change(input, { target: { value: c } })
      fireEvent.keyDown(input, { key: 'Enter' })
    }
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input.value).toBe('log -1')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input.value).toBe('status')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.value).toBe('')
  })

  it('runs a quick command at once, or fills one that needs a name', () => {
    const { onRun, input } = show()
    fireEvent.click(screen.getByRole('button', { name: 'git stash' }))
    expect(onRun).toHaveBeenCalledWith(['stash', 'push'])
    fireEvent.click(screen.getByRole('button', { name: 'git switch -c' }))
    expect(input.value).toBe('switch -c ')
  })

  it('does nothing while disabled or empty', () => {
    const { onRun, input } = show({ disabled: true })
    expect(input.disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Run' }).disabled).toBe(true)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRun).not.toHaveBeenCalled()
  })
})

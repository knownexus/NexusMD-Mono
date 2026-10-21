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
    expect(input.value).toBe('git switch -c ')
  })

  it('does nothing while disabled or empty', () => {
    const { onRun, input } = show({ disabled: true })
    expect(input.disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Run' }).disabled).toBe(true)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRun).not.toHaveBeenCalled()
  })
})

describe('GitCommandLine aliases', () => {
  const ga = { name: 'ga', expansion: 'add', takesArgs: true }
  const uncommit = { name: 'uncommit', expansion: 'reset --soft HEAD^', takesArgs: false }
  const stash = { name: 'stash', expansion: 'stash save', takesArgs: true }
  const co = { name: 'co', expansion: 'checkout', shell: false }
  async function showAliases(aliases) {
    const onRun = vi.fn()
    render(<GitCommandLine path="C:/repos/A" onRun={onRun} loadAliases={async () => aliases} />)
    const count = aliases.git.length + aliases.shell.length + (aliases.scripts?.length ?? 0)
    await screen.findByRole('button', { name: `My aliases (${count}) ▾` })
    const input = screen.getByLabelText('git command')
    const type = line => { fireEvent.change(input, { target: { value: line } }); fireEvent.keyDown(input, { key: 'Enter' }) }
    return { onRun, input, type }
  }

  it('has no "git" prefix, and still takes a command with or without one', async () => {
    const { onRun, type } = await showAliases({ git: [], shell: [] })
    expect(document.querySelector('.nx-cmd-prefix')).toBeNull()
    type('git status')
    type('status')
    expect(onRun.mock.calls).toEqual([[['status']], [['status']]])
  })

  it('runs a DotFiles shortcut as the git command it stands for, passing arguments on only where it does', async () => {
    const { onRun, type } = await showAliases({ git: [], shell: [ga, uncommit] })
    type('ga "a b.txt" c.txt')
    type('uncommit ignored')
    expect(onRun.mock.calls).toEqual([[['add', 'a b.txt', 'c.txt']], [['reset', '--soft', 'HEAD^']]])
  })

  it('a leading "git" skips the shortcuts, so git stash pop is still git\'s', async () => {
    const { onRun, type } = await showAliases({ git: [], shell: [stash] })
    type('git stash pop')
    expect(onRun).toHaveBeenCalledWith(['stash', 'pop'])
    fireEvent.click(screen.getByRole('button', { name: 'git stash' }))
    expect(onRun).toHaveBeenLastCalledWith(['stash', 'push'])
  })

  it('hands a DotFiles script to onRun as typed, marked to run in PowerShell, unless "git" comes first', async () => {
    const { onRun, type } = await showAliases({ git: [], shell: [], scripts: [{ name: 'g!' }] })
    type('g! -v')
    type('git g!')
    expect(onRun.mock.calls).toEqual([[['g!', '-v'], { script: true }], [['g!']]])
    fireEvent.click(screen.getByRole('button', { name: 'My aliases (1) ▾' }))
    expect(screen.getByRole('menu', { name: 'My aliases' }).textContent).toBe('DotFiles scriptsg!PowerShell script')
  })

  it('hands a git alias to onRun with the arguments typed after it', async () => {
    const { onRun, type } = await showAliases({ git: [co], shell: [] })
    type('git co feature/x')
    expect(onRun).toHaveBeenCalledWith(['co', 'feature/x'], co)
  })

  it('lists DotFiles shortcuts and git aliases; picking one fills it in', async () => {
    const { input } = await showAliases({ git: [co], shell: [ga, uncommit] })
    fireEvent.click(screen.getByRole('button', { name: 'My aliases (3) ▾' }))
    const menu = screen.getByRole('menu', { name: 'My aliases' })
    expect(menu.textContent).toBe('DotFilesgagit adduncommitgit reset --soft HEAD^git configgit cogit checkout')
    fireEvent.click(screen.getByRole('menuitem', { name: 'ga' }))
    expect(input.value).toBe('ga ')
    fireEvent.click(screen.getByRole('button', { name: 'My aliases (3) ▾' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'uncommit' }))
    expect(input.value).toBe('uncommit')
    fireEvent.click(screen.getByRole('button', { name: 'My aliases (3) ▾' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'git co' }))
    expect(input.value).toBe('git co ')
  })

  it('draws the menu on the page, outside the panel that would clip it, and closes it on Escape or a click elsewhere', async () => {
    await showAliases({ git: [], shell: [ga] })
    const chip = screen.getByRole('button', { name: 'My aliases (1) ▾' })
    fireEvent.click(chip)
    const menu = screen.getByRole('menu', { name: 'My aliases' })
    expect(menu.parentElement).toBe(document.body)
    expect(menu.style.position).toBe('fixed')
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    fireEvent.mouseDown(menu)
    expect(screen.getByRole('menu', { name: 'My aliases' })).toBeTruthy()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(chip)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('says where aliases come from when none are found', async () => {
    await showAliases({ git: [], shell: [] })
    fireEvent.click(screen.getByRole('button', { name: 'My aliases (0) ▾' }))
    expect(screen.getByRole('menu', { name: 'My aliases' }).textContent).toMatch(/Set your DotFiles folder in Settings/)
  })

  it('shows no alias picker without a loader', () => {
    render(<GitCommandLine path="C:/repos/A" onRun={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /My aliases/ })).toBeNull()
  })
})

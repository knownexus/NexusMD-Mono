import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { GroupEditor } from './group-editor.jsx'

afterEach(cleanup)

const config = { version: 1, repos: [{ name: 'AccessControl', path: 'C:/repos/AccessControl' }], groups: [], roots: ['C:/repos'], view: {} }
const snapshot = { worktrees: [{ repo: 'AccessControl', repoRoot: 'C:/repos/AccessControl', path: 'C:/repos/AccessControl', branch: 'main', rebasingBranch: null, error: '', changes: [] }], branches: [] }
const discovered = [{ name: 'Payments', path: 'C:/repos/Payments', commonDir: 'p', registeredAs: null }]

function setup(resolve = async () => ({ commonDir: 'x' })) {
  const adapter = { discover: vi.fn(async () => discovered), resolve: vi.fn(resolve) }
  const onSaved = vi.fn()
  render(<GroupEditor open config={config} snapshot={snapshot} existing={null} adapter={adapter} onClose={() => {}} onSaved={onSaved} />)
  return { adapter, onSaved }
}

describe('GroupEditor', () => {
  it('ticks a registered repo and a discovered one, then saves both under the typed name', async () => {
    const { adapter, onSaved } = setup()
    await screen.findByText('Payments')
    expect(adapter.discover).toHaveBeenCalledWith(['C:/repos'], config.repos)
    fireEvent.click(screen.getByRole('checkbox', { name: 'AccessControl' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Payments' }))
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'QR' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const [next, group] = onSaved.mock.calls[0]
    expect(group).toEqual({ name: 'QR', repos: ['AccessControl', 'Payments'], worktrees: [], branches: [] })
    expect(next.repos.map(r => r.name)).toEqual(['AccessControl', 'Payments'])
  })

  it('keeps the dialog open and flags the failing row when a discovered repo cannot be registered', async () => {
    const { onSaved } = setup(async () => { throw new Error('No repository at C:/repos/Payments') })
    await screen.findByText('Payments')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Payments' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Payments: No repository at C:/repos/Payments')
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'Payments' }).closest('li').dataset.failing).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Payments' }))
  })

  it('focuses the failing row again when the same member fails a second save', async () => {
    setup(async () => { throw new Error('No repository at C:/repos/Payments') })
    await screen.findByText('Payments')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Payments' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Payments' })))
    screen.getByLabelText('Group name').focus()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Payments' })))
  })

  it('explains why an entry inside a whole repo cannot be ticked separately', async () => {
    setup()
    await screen.findByText('Payments')
    fireEvent.click(screen.getByRole('checkbox', { name: 'AccessControl' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'checkout → main' }))
    expect(screen.getByRole('alert').textContent).toMatch(/whole repo/)
  })

  const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
  const mount = adapter => {
    const props = { config, snapshot, existing: null, adapter, onClose: () => {}, onSaved: vi.fn() }
    const view = render(<GroupEditor open {...props} />)
    return { props, set: open => view.rerender(<GroupEditor {...props} open={open} />) }
  }

  it('ignores a scan that finishes after the editor was closed and reopened', async () => {
    const first = deferred()
    const second = deferred()
    const adapter = { discover: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise), resolve: vi.fn() }
    const { set } = mount(adapter)
    set(false)
    set(true)
    expect(await screen.findByText('Searching for repositories…')).toBeTruthy()
    first.reject(new Error('stale failure'))
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Searching for repositories…')).toBeTruthy()
    second.resolve([])
    await waitFor(() => expect(screen.queryByText('Searching for repositories…')).toBeNull())
  })

  it('does not add repos from a stale scan to the reopened draft', async () => {
    const first = deferred()
    const adapter = { discover: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce([]), resolve: vi.fn() }
    const { set } = mount(adapter)
    set(false)
    set(true)
    await waitFor(() => expect(screen.queryByText('Searching for repositories…')).toBeNull())
    first.resolve(discovered)
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByText('Payments')).toBeNull()
  })

  it('disables Cancel while saving and drops a save that resolves after the dialog closed', async () => {
    const pending = deferred()
    const adapter = { discover: vi.fn(async () => discovered), resolve: vi.fn(() => pending.promise) }
    const { props, set } = mount(adapter)
    await screen.findByText('Payments')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Payments' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true))
    set(false)
    pending.resolve({ commonDir: 'x' })
    await new Promise(r => setTimeout(r, 0))
    expect(props.onSaved).not.toHaveBeenCalled()
  })
})

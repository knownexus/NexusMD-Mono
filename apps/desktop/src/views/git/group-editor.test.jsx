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
  })

  it('explains why an entry inside a whole repo cannot be ticked separately', async () => {
    setup()
    await screen.findByText('Payments')
    fireEvent.click(screen.getByRole('checkbox', { name: 'AccessControl' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'checkout → main' }))
    expect(screen.getByRole('alert').textContent).toMatch(/whole repo/)
  })
})

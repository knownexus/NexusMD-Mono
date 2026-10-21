import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { GroupEditor } from './group-editor.jsx'

afterEach(cleanup)

const config = { version: 1, repos: [{ name: 'AccessControl', path: 'C:/repos/AccessControl' }], groups: [], roots: ['C:/repos'], view: {} }
const snapshot = { worktrees: [{ repo: 'AccessControl', repoRoot: 'C:/repos/AccessControl', path: 'C:/repos/AccessControl', branch: 'main', rebasingBranch: null, error: '', changes: [] }], branches: [] }

function setup() {
  const onSaved = vi.fn()
  render(<GroupEditor open config={config} snapshot={snapshot} existing={null} onClose={() => {}} onSaved={onSaved} />)
  return { onSaved }
}

describe('GroupEditor', () => {
  it('offers registered repositories only and saves the group without changing the registered list', () => {
    const { onSaved } = setup()
    expect(screen.getByText('Only repositories registered in Settings → Desktop → Git Workspace are listed.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Rescan' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'AccessControl' }))
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'QR' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSaved).toHaveBeenCalledTimes(1)
    const [next, group] = onSaved.mock.calls[0]
    expect(group).toEqual({ name: 'QR', repos: ['AccessControl'], worktrees: [], branches: [] })
    expect(next.repos).toEqual(config.repos)
  })

  it('keeps the dialog open and says why when the group cannot be saved', () => {
    const { onSaved } = setup()
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Registered repos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toMatch(/reserved/)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('explains why an entry inside a whole repo cannot be ticked separately', () => {
    setup()
    fireEvent.click(screen.getByRole('checkbox', { name: 'AccessControl' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'checkout → main' }))
    expect(screen.getByRole('alert').textContent).toMatch(/whole repo/)
  })
})

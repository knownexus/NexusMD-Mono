import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { QuickAddList } from './planner-editors.jsx'

const section = {
  id: 'tasks', title: 'My tasks', type: 'table',
  cols: [{ k: 'task', l: 'Task', main: true }, { k: 'due', l: 'Due', t: 'date' }, { k: 'status', l: 'Status', t: 'status' }],
}

function Harness({ initial = [] }) {
  const [rows, setRows] = React.useState(initial)
  return <QuickAddList section={section} rows={rows} setRows={setRows} sessionUnlocked onUnlockRequest={() => {}} onLockRow={() => {}} onUnlockRow={() => {}}/>
}

const asPhone = (matches) => { window.matchMedia = vi.fn(() => ({ matches, addEventListener() {}, removeEventListener() {} })) }
beforeEach(() => asPhone(true))
afterEach(cleanup)

describe('Planner quick-add on a phone', () => {
  it('has an Add button that stays off until there is text, then adds the row', () => {
    render(<Harness/>)
    const add = screen.getByRole('button', { name: 'Add' })
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Add to My tasks'), { target: { value: 'Call the vendor' } })
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    expect(screen.getByText('Call the vendor')).toBeTruthy()
    expect(screen.getByLabelText('Add to My tasks').value).toBe('')
  })

  it('does not tell a phone to press Enter, and points to the bar below the list', () => {
    render(<Harness/>)
    expect(screen.getByLabelText('Add to My tasks').placeholder).not.toMatch(/Enter/)
    expect(screen.getByText(/type below/)).toBeTruthy()
  })

  it('offers Add with all fields only once something is typed, and opens the new row', () => {
    render(<Harness/>)
    expect(screen.queryByRole('button', { name: 'Add with all fields' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Add to My tasks'), { target: { value: 'Plan the offsite due:fri' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add with all fields' }))
    expect(screen.getAllByText('Plan the offsite').length).toBeGreaterThan(0)
    // the new row is open, so its other fields are showing
    expect(document.querySelector('.qa-edit')).toBeTruthy()
    expect(screen.getByLabelText('Add to My tasks').value).toBe('')
  })
})

describe('Planner quick-add on a wide screen', () => {
  it('keeps the Enter-key hint and offers no extra button', () => {
    asPhone(false)
    render(<Harness/>)
    expect(screen.getByLabelText('Add to My tasks').placeholder).toMatch(/press Enter/)
    expect(screen.queryByRole('button', { name: 'Add with all fields' })).toBeNull()
    expect(screen.getByText(/type above/)).toBeTruthy()
  })
})

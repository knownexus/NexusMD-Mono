import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { GoToFile } from './go-to-file.jsx'

afterEach(cleanup)

const repo = { name: 'A', path: 'C:/repos/A' }
const registered = ['C:/repos/A']
const files = ['README.md', 'src/app/main.jsx', 'src/views/git/view-git.jsx']
const setup = (extra = {}) => {
  const adapter = { files: vi.fn(async () => ({ files, truncated: false, ...extra })) }
  const onOpen = vi.fn()
  const onClose = vi.fn()
  render(<GoToFile adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} onOpen={onOpen} onClose={onClose} />)
  return { adapter, onOpen, onClose }
}

describe('GoToFile', () => {
  it('filters as you type and opens with Enter', async () => {
    const { adapter, onOpen } = setup()
    expect(screen.getByText('Loading files…')).toBeTruthy()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    expect(adapter.files).toHaveBeenCalledWith(repo, repo.path, registered)
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'view git' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('src/views/git/view-git.jsx')
  })

  it('matches from the start of words only', async () => {
    setup()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'ain' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    fireEvent.change(box, { target: { value: 'main' } })
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['src/app/main.jsx'])
  })

  it('moves with the arrow keys', async () => {
    const { onOpen } = setup()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    const box = screen.getByRole('combobox')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('src/app/main.jsx')
  })

  it('announces the selected option through aria-activedescendant', async () => {
    setup()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    const box = screen.getByRole('combobox')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(box.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id)
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true')
  })

  it('says when the list was cut off', async () => {
    setup({ truncated: true })
    await waitFor(() => expect(screen.getByText('Showing the first 50,000 files.')).toBeTruthy())
  })

  it('Esc closes', async () => {
    const { onClose } = setup()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
  it('lists the files once, not again when the parent re-renders with equal but new props', async () => {
    const adapter = { files: vi.fn(async () => ({ files, truncated: false })) }
    const props = () => ({ adapter, repo: { ...repo }, worktreePath: repo.path, registered: [...registered], onOpen: () => {}, onClose: () => {} })
    const { rerender } = render(<GoToFile {...props()} />)
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    rerender(<GoToFile {...props()} />)
    rerender(<GoToFile {...props()} />)
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    expect(adapter.files).toHaveBeenCalledTimes(1)
  })
})

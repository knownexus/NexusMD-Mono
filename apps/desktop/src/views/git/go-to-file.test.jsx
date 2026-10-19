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
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'vgit' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('src/views/git/view-git.jsx')
  })

  it('moves with the arrow keys', async () => {
    const { onOpen } = setup()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    const box = screen.getByRole('textbox')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('src/app/main.jsx')
  })

  it('says when the list was cut off', async () => {
    setup({ truncated: true })
    await waitFor(() => expect(screen.getByText('Showing the first 50,000 files.')).toBeTruthy())
  })

  it('Esc closes', async () => {
    const { onClose } = setup()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

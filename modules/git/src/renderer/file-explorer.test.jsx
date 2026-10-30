import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FileExplorer, forgetExplorerViews } from './file-explorer.jsx'

afterEach(() => { cleanup(); forgetExplorerViews() })
const FILES = ['README.md', 'docs/guide.md', 'docs/api/ref.md', 'src/app.jsx', 'src/util.js']
const show = (props = {}) => render(<FileExplorer rootName="A" files={FILES} viewKey="k" preview={p => <div>{`preview of ${p}`}</div>} {...props} />)
const rows = () => screen.getAllByRole('treeitem').map(r => r.textContent)
const row = name => screen.getAllByRole('treeitem').find(r => r.textContent === name)

describe('FileExplorer', () => {
  it('shows folders first, then files, and invites a pick until one is made', () => {
    show()
    expect(rows()).toEqual(['docs', 'src', 'README.md'])
    expect(screen.getByText('Pick a file to see it here.')).toBeTruthy()
    expect(screen.getByText('5 files')).toBeTruthy()
    fireEvent.click(row('README.md'))
    expect(screen.getByText('preview of README.md')).toBeTruthy()
    expect(row('README.md').getAttribute('aria-selected')).toBe('true')
  })

  it('filters by any part of the path, opening the folders above each match, and Esc clears it', () => {
    show()
    const filter = screen.getByRole('searchbox', { name: 'Filter files' })
    fireEvent.change(filter, { target: { value: 'REF' } })
    expect(rows()).toEqual(['docs', 'api', 'ref.md'])
    expect(screen.getByText('1 match')).toBeTruthy()
    fireEvent.change(filter, { target: { value: 'nothing' } })
    expect(screen.getByText('No file path holds “nothing”.')).toBeTruthy()
    fireEvent.keyDown(filter, { key: 'Escape' })
    expect(filter.value).toBe('')
    expect(rows()).toEqual(['docs', 'src', 'README.md'])
  })

  it('moves with the arrow keys, opening and closing folders, and Enter picks then opens', () => {
    const onOpen = vi.fn()
    show({ onOpen })
    const docs = row('docs')
    docs.focus()
    fireEvent.keyDown(docs, { key: 'ArrowRight' })
    expect(rows()).toEqual(['docs', 'api', 'guide.md', 'src', 'README.md'])
    fireEvent.keyDown(row('docs'), { key: 'ArrowRight' })
    expect(document.activeElement.textContent).toBe('api')
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(document.activeElement.textContent).toBe('guide.md')
    fireEvent.keyDown(document.activeElement, { key: 'Enter' })
    expect(screen.getByText('preview of docs/guide.md')).toBeTruthy()
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.keyDown(document.activeElement, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('docs/guide.md')
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' })
    expect(document.activeElement.textContent).toBe('docs')
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' })
    expect(rows()).toEqual(['docs', 'src', 'README.md'])
  })

  it('collapses every folder at once', () => {
    show()
    fireEvent.click(row('docs'))
    fireEvent.click(row('src'))
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all folders' }))
    expect(rows()).toEqual(['docs', 'src', 'README.md'])
  })

  it('keeps the pick, the open folders and the filter per view', () => {
    show()
    fireEvent.click(row('src'))
    fireEvent.click(row('app.jsx'))
    cleanup()
    show()
    expect(screen.getByText('preview of src/app.jsx')).toBeTruthy()
    cleanup()
    show({ viewKey: 'other' })
    expect(screen.getByText('Pick a file to see it here.')).toBeTruthy()
  })

  it('drops a pick whose file is gone', () => {
    show()
    fireEvent.click(row('README.md'))
    cleanup()
    show({ files: ['src/app.jsx'] })
    expect(screen.getByText('Pick a file to see it here.')).toBeTruthy()
  })
})

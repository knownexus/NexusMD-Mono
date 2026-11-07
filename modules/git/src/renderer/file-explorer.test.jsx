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

  it('filters by the start of words in the path, opening the folders above each match, and Esc clears it', () => {
    show()
    const filter = screen.getByRole('searchbox', { name: 'Filter files' })
    fireEvent.change(filter, { target: { value: 'REF' } })
    expect(rows()).toEqual(['docs', 'api', 'ref.md'])
    expect(screen.getByText('1 of 5 files match')).toBeTruthy()
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

describe('FileExplorer word-start filter', () => {
  const MORE = ['src/components/Button.jsx', 'src/util.js', 'docs/readme.md']
  const typeFilter = value => fireEvent.change(screen.getByRole('searchbox', { name: 'Filter files' }), { target: { value } })

  it('matches terms that start words anywhere in the path, in any order', () => {
    show({ files: MORE })
    typeFilter('comp src')
    expect(rows()).toEqual(['src', 'components', 'Button.jsx'])
  })

  it('does not match inside a word', () => {
    show({ files: MORE })
    typeFilter('omp')
    expect(screen.getByText('No file path holds “omp”.')).toBeTruthy()
  })

  it('marks the matched word starts in the names when asked to', () => {
    show({ files: MORE, highlightMatches: true })
    typeFilter('but')
    const marks = [...document.querySelectorAll('mark')]
    expect(marks.map(m => m.textContent)).toEqual(['But'])
    expect(marks[0].closest('[role=treeitem]').textContent).toBe('Button.jsx')
  })

  it('draws no marks without highlightMatches', () => {
    show({ files: MORE })
    typeFilter('but')
    expect(document.querySelector('mark')).toBeNull()
  })
})

describe('FileExplorer pins and picking', () => {
  it('draws pins above the tree, handing them pick() and the picked path', () => {
    show({ pins: ({ pick, picked }) => <div><button onClick={() => pick('src/util.js')}>pin</button><span>{`picked: ${picked}`}</span></div> })
    expect(screen.getByText('picked: null')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'pin' }))
    expect(screen.getByText('preview of src/util.js')).toBeTruthy()
    expect(screen.getByText('picked: src/util.js')).toBeTruthy()
  })

  it('tells the page each file picked, from a row or a pin', () => {
    const onPick = vi.fn()
    show({ onPick })
    fireEvent.click(row('README.md'))
    expect(onPick).toHaveBeenCalledWith('README.md')
  })
})

describe('FileExplorer rail', () => {
  const rail = picked => <div>{`rail for ${picked}`}</div>

  it('draws the rail beside the preview with what is picked, and a note before a pick', () => {
    show({ rail, railLabel: 'File details', railOpen: true, onRailToggle: () => {} })
    expect(screen.getByText('rail for null')).toBeTruthy()
    fireEvent.click(row('README.md'))
    expect(screen.getByText('rail for README.md')).toBeTruthy()
  })

  it('collapses to a strip named after its label and asks to be toggled', () => {
    const onRailToggle = vi.fn()
    show({ rail, railLabel: 'File details', railOpen: false, onRailToggle })
    expect(screen.queryByText('rail for null')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show File details' }))
    expect(onRailToggle).toHaveBeenCalledTimes(1)
  })

  it('has no rail unless given one', () => {
    show()
    expect(screen.queryByRole('complementary')).toBeNull()
  })
})

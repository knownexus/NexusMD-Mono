import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { imageType, isImagePath } from './image-types.js'
import { ImageView, ImageDiff, ImageFile } from './image-view.jsx'
import { FileEditor } from './file-editor.jsx'
import { DiffPane } from './diff-pane.jsx'

afterEach(cleanup)

const img = (tag, size = 2048) => ({ mime: 'image/png', size, url: `data:image/png;base64,${tag}` })
const change = (area, path = 'img/logo.png', extra = {}) => ({ id: `${area}\0${path}`, area, path, originalPath: null, xy: '.M', ...extra })
const src = name => screen.getByAltText(name).getAttribute('src')

describe('image types', () => {
  it('knows images by extension, any case, and nothing else', () => {
    expect(imageType('a/b/Logo.PNG')).toBe('image/png')
    expect(imageType('x.jpeg')).toBe('image/jpeg')
    expect(imageType('icon.svg')).toBe('image/svg+xml')
    for (const p of ['notes.txt', 'png', '.png', 'dir.png/readme', '', null, undefined]) expect(isImagePath(p)).toBe(false)
  })
})

describe('ImageView', () => {
  it('shows the picture with its size once loaded, and toggles actual size on click', async () => {
    render(<ImageView name="logo" loadKey="a" load={async () => img('AAA', 2048)} />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    const pic = await screen.findByAltText('logo')
    expect(pic.getAttribute('src')).toBe('data:image/png;base64,AAA')
    expect(screen.getByText('2 KB')).toBeTruthy()
    Object.defineProperty(pic, 'naturalWidth', { value: 64 })
    Object.defineProperty(pic, 'naturalHeight', { value: 32 })
    fireEvent.load(pic)
    expect(screen.getByText('64 × 32 · 2 KB')).toBeTruthy()
    expect(pic.parentElement.dataset.actual).toBeUndefined()
    fireEvent.click(pic)
    expect(pic.parentElement.dataset.actual).toBe('true')
  })

  it('says so when the image is missing, and shows the reason when it cannot be read', async () => {
    const { unmount } = render(<ImageView name="x" loadKey="m" emptyText="Deleted." load={async () => ({ missing: true })} />)
    expect((await screen.findByRole('note')).textContent).toBe('Deleted.')
    unmount()
    render(<ImageView name="x" loadKey="e" load={async () => { throw new Error("Error invoking remote method 'git:readImage': Error: big.png is too large to show here (11 MB).") }} />)
    expect((await screen.findByRole('alert')).textContent).toBe('big.png is too large to show here (11 MB).')
  })

  it('loads again only when its key changes', async () => {
    const load = vi.fn(async () => img('AAA'))
    const { rerender } = render(<ImageView name="x" loadKey="1" load={load} />)
    await screen.findByAltText('x')
    rerender(<ImageView name="x" loadKey="1" load={load} />)
    expect(load).toHaveBeenCalledTimes(1)
    rerender(<ImageView name="x" loadKey="2" load={load} />)
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  })
})

describe('ImageDiff', () => {
  const sides = { index: img('INDEX'), head: img('HEAD'), working: img('WORK') }
  const load = vi.fn(async side => sides[side] ?? { missing: true })

  it('shows an unstaged change as index before and working tree after', async () => {
    render(<ImageDiff change={change('unstaged')} load={load} loadKey="k" />)
    expect(await screen.findByAltText('img/logo.png (old)')).toBeTruthy()
    expect(src('img/logo.png (old)')).toContain('INDEX')
    expect(src('img/logo.png (new)')).toContain('WORK')
    expect(screen.getByText('− old: index')).toBeTruthy()
    expect(screen.getByText('+ new: working tree')).toBeTruthy()
  })

  it('shows a staged change as HEAD before and index after', async () => {
    render(<ImageDiff change={change('staged')} load={load} loadKey="k" />)
    await screen.findByAltText('img/logo.png (old)')
    expect(src('img/logo.png (old)')).toContain('HEAD')
    expect(src('img/logo.png (new)')).toContain('INDEX')
  })

  it('shows only the new side for an untracked file, and reads a renamed file’s old side by its old name', async () => {
    const calls = vi.fn(async () => img('X'))
    render(<ImageDiff change={change('untracked')} load={calls} loadKey="k" />)
    await screen.findByAltText('img/logo.png (new)')
    expect(screen.queryByLabelText('Old image')).toBeNull()
    cleanup()
    render(<ImageDiff change={change('staged', 'img/new-name.png', { originalPath: 'img/old-name.png' })} load={calls} loadKey="r" />)
    await waitFor(() => expect(calls).toHaveBeenCalledWith('head', 'img/old-name.png'))
    expect(calls).toHaveBeenCalledWith('index', 'img/new-name.png')
  })

  it('says a side did not exist when it was added or deleted, and renders nothing for a conflict', async () => {
    const gone = vi.fn(async side => (side === 'working' ? { missing: true } : img('OLD')))
    render(<ImageDiff change={change('unstaged')} load={gone} loadKey="k" />)
    expect((await within(await screen.findByLabelText('New image')).findByRole('note')).textContent).toBe('Deleted.')
    cleanup()
    const added = vi.fn(async side => (side === 'index' ? { missing: true } : img('NEW')))
    render(<ImageDiff change={change('unstaged')} load={added} loadKey="k2" />)
    expect((await within(await screen.findByLabelText('Old image')).findByRole('note')).textContent).toBe('Did not exist before.')
    cleanup()
    const { container } = render(<ImageDiff change={change('conflict')} load={load} loadKey="c" />)
    expect(container.innerHTML).toBe('')
  })
})

describe('ImageFile and FileEditor', () => {
  const repo = { name: 'A', path: 'C:/repos/A' }
  const registered = ['C:/repos/A']

  it('shows the working-tree picture for an image path, reloading on request', async () => {
    const adapter = { readImage: vi.fn(async () => img('PIC')) }
    render(<ImageFile adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} path="img/logo.png" />)
    await screen.findByAltText('img/logo.png')
    expect(adapter.readImage).toHaveBeenCalledWith(repo, repo.path, registered, 'img/logo.png', 'working')
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(adapter.readImage).toHaveBeenCalledTimes(2))
  })

  it('FileEditor shows images instead of an editor, without reading the file as text', async () => {
    const adapter = { readImage: vi.fn(async () => img('PIC')), readFile: vi.fn() }
    render(<FileEditor adapter={adapter} repo={repo} worktreePath={repo.path} registered={registered} path="photo.JPG" />)
    await screen.findByAltText('photo.JPG')
    expect(adapter.readFile).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})

describe('DiffPane images', () => {
  const diff = result => ({ result, files: [], loading: false, error: null })
  const images = { load: vi.fn(async side => img(side.toUpperCase())), key: 'k' }

  it('shows a changed binary image as before and after', async () => {
    render(<DiffPane change={change('unstaged')} diff={diff({ binary: true, size: 100, text: '' })} onHunk={() => {}} images={images} />)
    expect(await screen.findByLabelText('Image diff')).toBeTruthy()
    expect(screen.getByText(/Binary file/)).toBeTruthy()
  })

  it('leaves other binary files, conflicts and gone changes as notes', () => {
    const { rerender } = render(<DiffPane change={change('unstaged', 'data.bin')} diff={diff({ binary: true, size: 100, text: '' })} onHunk={() => {}} images={images} />)
    expect(screen.queryByLabelText('Image diff')).toBeNull()
    rerender(<DiffPane change={change('unstaged')} diff={diff({ gone: true, text: '' })} onHunk={() => {}} images={images} />)
    expect(screen.queryByLabelText('Image diff')).toBeNull()
    rerender(<DiffPane change={change('unstaged')} diff={diff({ binary: true, size: 100, text: '' })} onHunk={() => {}} />)
    expect(screen.queryByLabelText('Image diff')).toBeNull()
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { SourcePicker } from './source-picker.jsx'

afterEach(cleanup)

const REFS = ['refs/heads/master', 'refs/heads/feat/x', 'refs/heads/develop', 'refs/remotes/origin/master', 'refs/remotes/origin/HEAD']
  .map(r => `${r}\0${'a'.repeat(40)}\0\0 `).join('\n')

function setup(over = {}) {
  const adapter = {
    refs: vi.fn(async () => ({ refs: REFS, originHead: null, shallow: false })),
    preview: vi.fn(async () => ({ eligible: true, stamp: 's1' })),
    run: vi.fn(async () => ({ ok: true, detail: '' })),
    ...over,
  }
  const handlers = { onClose: vi.fn(), onPicked: vi.fn() }
  render(<SourcePicker adapter={adapter} repo={{ name: 'r', path: 'C:/r' }} cwd="C:/r" registered={['C:/r']} branch="feat/x" current="refs/heads/master" {...handlers} />)
  return { adapter, ...handlers }
}
const names = () => screen.getAllByRole('option').map(o => o.getAttribute('data-name'))

describe('SourcePicker', () => {
  it('lists branches and remotes without the branch itself', async () => {
    setup()
    await screen.findByRole('option', { name: /develop/ })
    expect(names()).toEqual(['master', 'develop', 'origin/master'])
  })

  it('narrows the list as you type', async () => {
    setup()
    await screen.findByRole('option', { name: /develop/ })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dev' } })
    expect(names()).toEqual(['develop'])
  })

  it('previews then runs setSource when one is picked', async () => {
    const { adapter, onPicked } = setup()
    fireEvent.click(await screen.findByRole('option', { name: /develop/ }))
    await waitFor(() => expect(onPicked).toHaveBeenCalled())
    const repo = { name: 'r', path: 'C:/r' }
    expect(adapter.preview).toHaveBeenCalledWith(repo, 'C:/r', ['C:/r'], 'setSource', { branch: 'feat/x', ref: 'refs/heads/develop' })
    expect(adapter.run).toHaveBeenCalledWith(repo, 'C:/r', ['C:/r'], 'setSource', { branch: 'feat/x', ref: 'refs/heads/develop' }, 's1')
  })

  it('shows an ineligible preview reason and does not run', async () => {
    const { adapter, onPicked } = setup({ preview: vi.fn(async () => ({ eligible: false, reason: 'Not a branch here' })) })
    fireEvent.click(await screen.findByRole('option', { name: /develop/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('Not a branch here')
    expect(adapter.run).not.toHaveBeenCalled()
    expect(onPicked).not.toHaveBeenCalled()
  })

  it('shows a failed run inline', async () => {
    const { onPicked } = setup({ run: vi.fn(async () => ({ ok: false, detail: 'config locked' })) })
    fireEvent.click(await screen.findByRole('option', { name: /develop/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('config locked')
    expect(onPicked).not.toHaveBeenCalled()
  })
})

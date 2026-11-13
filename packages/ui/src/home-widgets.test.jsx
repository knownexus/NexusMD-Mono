import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { WidgetHost, WidgetSheet } from './home-widgets.jsx'

afterEach(cleanup)

describe('WidgetHost', () => {
  it('shows nothing until a widget is added', () => {
    const { container } = render(<WidgetHost widgets={[]} ctx={{}} onEdit={() => {}}/>)
    expect(container.innerHTML).toBe('')
  })

  it('renders a Lists widget whose list was deleted as removed, without throwing', () => {
    const widgets = [{ id: 'a', type: 'lists', config: { listId: 'gone' } }]
    expect(() => render(<WidgetHost widgets={widgets} ctx={{ lists: [{ id: 'other', name: 'Other' }], navTo: () => {} }} onEdit={() => {}}/>)).not.toThrow()
    expect(screen.getByText('This list was removed.')).toBeTruthy()
    expect(screen.queryByText('Other')).toBeNull()
  })

  it('renders a Lists widget with no lists left (or malformed ones) as empty, without throwing', () => {
    const widgets = [{ id: 'a', type: 'lists', config: {} }]
    expect(() => render(<WidgetHost widgets={widgets} ctx={{ navTo: () => {} }} onEdit={() => {}}/>)).not.toThrow()
    expect(screen.getByText('No lists yet.')).toBeTruthy()
    cleanup()
    render(<WidgetHost widgets={widgets} ctx={{ lists: [null, { id: 'l1', name: 'Bare' }], navTo: () => {} }} onEdit={() => {}}/>)
    expect(screen.getByText('Bare')).toBeTruthy()
    expect(screen.getByText('0 items')).toBeTruthy()
  })

  it('skips a widget whose page is in offScreens', () => {
    const widgets = [{ id: 'a', type: 'builds', config: {} }, { id: 'b', type: 'lists', config: {} }]
    render(<WidgetHost widgets={widgets} offScreens={['builds']} ctx={{ lists: [], navTo: () => {} }} onEdit={() => {}}/>)
    expect(screen.queryByText('Builds')).toBeNull()
    expect(screen.getByText('Lists')).toBeTruthy()
  })

  it('reads builds from ctx and shows only as many as configured', () => {
    const builds = [1, 2, 3, 4].map(n => ({ id: n, pipeline: `P${n}`, status: 'success', branch: 'main' }))
    render(<WidgetHost widgets={[{ id: 'a', type: 'builds', config: { count: 2 } }]} ctx={{ builds, navTo: () => {} }} onEdit={() => {}}/>)
    expect(screen.queryByText('P3')).toBeNull()
    expect(screen.getByText('P2')).toBeTruthy()
  })
})

describe('WidgetSheet', () => {
  it('adds a widget set up as chosen', () => {
    const onSave = vi.fn()
    render(<WidgetSheet open widget={null} onClose={() => {}} onSave={onSave} onRemove={() => {}}/>)
    fireEvent.click(screen.getByText('Builds'))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add widget' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: 'builds', config: expect.objectContaining({ count: 7 }) }))
  })

  it('asks for a width unless the host sizes widgets itself (showWidth=false)', () => {
    const { unmount } = render(<WidgetSheet open widget={null} onClose={() => {}} onSave={() => {}} onRemove={() => {}}/>)
    fireEvent.click(screen.getByText('Builds'))
    expect(screen.getByText('Width')).toBeTruthy()
    unmount()
    render(<WidgetSheet open widget={null} showWidth={false} onClose={() => {}} onSave={() => {}} onRemove={() => {}}/>)
    fireEvent.click(screen.getByText('Builds'))
    expect(screen.queryByText('Width')).toBeNull()
  })

  it('offers repos from listRepoChoices and uses the Sheet it is given', async () => {
    const Sheet = ({ open, title, children }) => open ? <div data-testid="my-sheet"><h2>{title}</h2>{children}</div> : null
    const listRepoChoices = vi.fn(() => Promise.resolve({ repos: [{ id: 'r1', name: 'Repo One' }] }))
    render(<WidgetSheet open widget={null} Sheet={Sheet} listRepoChoices={listRepoChoices} onClose={() => {}} onSave={() => {}} onRemove={() => {}}/>)
    expect(screen.getByTestId('my-sheet')).toBeTruthy()
    fireEvent.click(screen.getByText('Repo'))
    expect(await screen.findByText('Repo One')).toBeTruthy()
  })
})

const fileLink = (over = {}) => ({
  id: 'k1', type: 'link',
  config: { target: 'git', kind: 'file', path: '/src/app.js', repo: { provider: 'github', name: 'nexus', fullName: 'knownexus/nexus' }, ...over },
})

describe('File or folder shortcut (link)', () => {
  it('shows the file, where it is, and opens it with the cleaned target on tap', () => {
    const openTarget = vi.fn()
    render(<WidgetHost widgets={[fileLink()]} ctx={{ openTarget, resolveTarget: () => ({ ok: true }) }} onEdit={() => {}}/>)
    expect(screen.getByText('app.js')).toBeTruthy()
    expect(screen.getByText('nexus / src')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^app\.js/ }))
    expect(openTarget).toHaveBeenCalledWith(expect.objectContaining({ target: 'git', path: '/src/app.js' }))
  })

  it('opens from the keyboard too', () => {
    const openTarget = vi.fn()
    render(<WidgetHost widgets={[fileLink()]} ctx={{ openTarget }} onEdit={() => {}}/>)
    fireEvent.keyDown(screen.getByRole('button', { name: /^app\.js/ }), { key: 'Enter' })
    expect(openTarget).toHaveBeenCalledTimes(1)
  })

  it('greys out a shortcut this device cannot open, and a tap says why instead of opening it', () => {
    const openTarget = vi.fn()
    render(<WidgetHost widgets={[fileLink()]} ctx={{ openTarget, resolveTarget: () => ({ ok: false, reason: 'Not on this device.' }) }} onEdit={() => {}}/>)
    const tile = screen.getByRole('button', { name: /^app\.js/ })
    expect(tile.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(tile)
    expect(screen.getByText('Not on this device.')).toBeTruthy()
    expect(openTarget).not.toHaveBeenCalled()
  })

  it('renders a malformed synced config as an incomplete shortcut, without throwing', () => {
    const w = { id: 'k2', type: 'link', config: { target: 'git' } }
    expect(() => render(<WidgetHost widgets={[w]} ctx={{ openTarget: vi.fn() }} onEdit={() => {}}/>)).not.toThrow()
    fireEvent.click(screen.getByRole('button', { name: /^Shortcut/ }))
    expect(screen.getByText('This shortcut is incomplete.')).toBeTruthy()
  })

  it('is left out when the page its target lives on is off', () => {
    const doc = { id: 'k3', type: 'link', config: { target: 'doc', tool: 'json', docId: 'd', name: 'Config' } }
    render(<WidgetHost widgets={[doc, fileLink()]} offScreens={['markdown']} ctx={{}} onEdit={() => {}}/>)
    expect(screen.queryByText('Config')).toBeNull()
    expect(screen.getByText('app.js')).toBeTruthy()
  })
})

describe('WidgetSheet with a File or folder shortcut', () => {
  const noop = () => {}
  it('does not offer the type unless the host can pick targets', () => {
    render(<WidgetSheet open widget={null} onClose={noop} onSave={noop} onRemove={noop}/>)
    expect(screen.queryByText('File or folder')).toBeNull()
  })

  it('offers it when the host supplies targetSources', () => {
    render(<WidgetSheet open widget={null} targetSources={{}} onClose={noop} onSave={noop} onRemove={noop}/>)
    expect(screen.getByText('File or folder')).toBeTruthy()
  })

  it('edits only the name of an existing one, keeping its target, and trims an empty name away', () => {
    const onSave = vi.fn()
    render(<WidgetSheet open widget={fileLink()} onClose={noop} onSave={onSave} onRemove={noop}/>)
    expect(screen.getByText('Opens (fixed once made)')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Main entry' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({
      id: 'k1', type: 'link',
      config: expect.objectContaining({ target: 'git', path: '/src/app.js', label: 'Main entry' }),
    })
    onSave.mockClear()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave.mock.calls[0][0].config).not.toHaveProperty('label')
  })

  it('cannot save one whose target is unusable', () => {
    render(<WidgetSheet open widget={{ id: 'k9', type: 'link', config: { target: 'git' } }} onClose={noop} onSave={noop} onRemove={noop}/>)
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
  })
})

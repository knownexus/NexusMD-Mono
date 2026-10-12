import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { DevenvSettingsCard } from './devenv-settings-card.jsx'
import { getDevenvConfig } from './devenv-config.js'

const catalog = (over = {}) => ({ type: 'result', kind: 'catalog', protocol: 1, profileError: null, groups: [], commands: [{ group: '', verb: 'status' }, { group: '', verb: 'start' }], ...over })
const adapterWith = catalogImpl => ({ isAvailable: () => true, catalog: vi.fn(catalogImpl) })

describe('DevenvSettingsCard', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => cleanup())

  it('renders nothing without the desktop adapter', () => {
    const { container } = render(<DevenvSettingsCard adapter={{ isAvailable: () => false }} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the defaults and saves edits', () => {
    render(<DevenvSettingsCard adapter={adapterWith(async () => catalog())} />)
    const folder = screen.getByLabelText('devenv folder')
    expect(folder.value).toBe('C:\\repos\\dev-environment')
    fireEvent.change(screen.getByLabelText('Profile folder'), { target: { value: 'D:\\prof' } })
    expect(getDevenvConfig().profile).toBe('D:\\prof')
  })

  it('Check reports the command count', async () => {
    const adapter = adapterWith(async () => catalog())
    render(<DevenvSettingsCard adapter={adapter} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    await waitFor(() => screen.getByText(/devenv OK - 2 commands/))
    expect(adapter.catalog).toHaveBeenCalledWith({ root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' })
  })

  it('Check reports a protocol mismatch and errors', async () => {
    const { unmount } = render(<DevenvSettingsCard adapter={adapterWith(async () => catalog({ protocol: 2 }))} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    await waitFor(() => screen.getByText(/update devenv/i))
    unmount()
    render(<DevenvSettingsCard adapter={adapterWith(async () => { throw new Error('No devenv.ps1 in C:\\x') })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    await waitFor(() => screen.getByText('No devenv.ps1 in C:\\x'))
  })

  it('Browse fills the folder from the picker', async () => {
    const picker = { pickDirectory: vi.fn(async () => 'E:\\devenv') }
    render(<DevenvSettingsCard adapter={adapterWith(async () => catalog())} picker={picker} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Browse…' })[0])
    await waitFor(() => expect(screen.getByLabelText('devenv folder').value).toBe('E:\\devenv'))
  })
})

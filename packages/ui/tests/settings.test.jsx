import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import {
  NexusDataProvider, PlToggle, VsRow, VsSeg, VsProfileEditor, VsProfiles, PROFILE_COLORS,
  OAuthServiceCard, IntegrationsView,
} from '../src/index.js'

afterEach(cleanup)

function withProvider(ui, value = {}) {
  return render(
    <NexusDataProvider value={{ data: {}, namespace: 'nexusmd', getProfileKey: (k) => k, ...value }}>
      {ui}
    </NexusDataProvider>,
  )
}

describe('shared settings primitives (web + app)', () => {
  it('PlToggle reflects checked state and fires onChange', () => {
    const onChange = vi.fn()
    const { container } = render(<PlToggle checked={true} onChange={onChange} />)
    const box = container.querySelector('input[type="checkbox"]')
    expect(box).toBeTruthy()
    expect(box.checked).toBe(true)
    box.click()
    expect(onChange).toHaveBeenCalled()
  })

  it('VsRow renders its title and description', () => {
    const { container } = render(<VsRow title="Density" desc="How compact the UI is" />)
    expect(container.textContent).toContain('Density')
    expect(container.textContent).toContain('How compact the UI is')
  })

  it('VsSeg renders one button per option and marks the active one', () => {
    const { container } = render(
      <VsSeg value="b" options={[['a', 'A'], ['b', 'B'], ['c', 'C']]} onChange={() => {}} />,
    )
    const btns = container.querySelectorAll('button')
    expect(btns).toHaveLength(3)
    expect(container.querySelector('button.active')?.textContent).toBe('B')
  })

  it('VsProfileEditor shows the Organisation-label field only when showOrgLabel', () => {
    const web = withProvider(
      <VsProfileEditor profile={{ name: 'X', initials: 'X', color: PROFILE_COLORS[0] }}
        onSave={() => {}} onDelete={() => {}} onExport={() => {}} onClose={() => {}} />,
    )
    expect(web.container.textContent).toContain('Organisation label')
    cleanup()
    const app = withProvider(
      <VsProfileEditor profile={{ name: 'X', initials: 'X', color: PROFILE_COLORS[0] }}
        onSave={() => {}} onDelete={() => {}} onExport={() => {}} onClose={() => {}} showOrgLabel={false} />,
    )
    expect(app.container.textContent).not.toContain('Organisation label')
  })

  it('VsProfileEditor omits orgLabel from onSave payload when showOrgLabel=false (app)', () => {
    const onSave = vi.fn()
    const { container } = withProvider(
      <VsProfileEditor profile={{ name: 'Acme', initials: 'AC', color: PROFILE_COLORS[0], type: 'ado' }}
        onSave={onSave} onDelete={() => {}} onExport={() => {}} onClose={() => {}} showOrgLabel={false} />,
    )
    // Click "Save" (the primary footer button).
    const save = [...container.querySelectorAll('button')].find(b => b.textContent === 'Save')
    save.click()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('orgLabel')
  })

  it('VsProfiles renders the injected profile list (profileApi prop seam)', () => {
    const profileApi = {
      profiles: [{ id: 'p1', name: 'Work', initials: 'WK', color: '#9a7e22', type: 'ado' }],
      activeId: 'p1',
      switchProfile: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn(),
      deleteProfile: vi.fn(), exportProfile: vi.fn(), importProfile: vi.fn(),
    }
    const { container } = withProvider(<VsProfiles profileApi={profileApi} />)
    expect(container.textContent).toContain('Work')
    expect(container.textContent).toContain('Active')
  })
})

describe('OAuthServiceCard', () => {
  function makeService(overrides = {}) {
    return {
      id: 'github',
      label: 'GitHub',
      icon: 'pr',
      desc: 'GitHub OAuth App',
      isConnected: vi.fn(() => false),
      connect: vi.fn(),
      disconnect: vi.fn(),
      credFields: [
        { key: 'clientId', label: 'Client ID' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
      loadCreds: vi.fn(() => ({})),
      saveCreds: vi.fn(),
      ...overrides,
    }
  }

  it('shows "Not configured" badge when credentials are empty', () => {
    const { container } = render(<OAuthServiceCard service={makeService()} />)
    expect(container.textContent).toContain('Not configured')
    expect(container.textContent).not.toContain('Configured')
  })

  it('shows "Configured" badge when all credential fields are filled', () => {
    const { container } = render(
      <OAuthServiceCard service={makeService({
        loadCreds: vi.fn(() => ({ clientId: 'abc', clientSecret: 'xyz' })),
      })} />,
    )
    expect(container.textContent).toContain('Configured')
  })

  it('shows service label and Connect button when disconnected', () => {
    const { container } = render(<OAuthServiceCard service={makeService()} />)
    expect(container.textContent).toContain('GitHub')
    expect(container.textContent).toContain('Connect GitHub')
  })

  it('shows Connected pill and Disconnect button when connected', () => {
    const { container } = render(
      <OAuthServiceCard service={makeService({ isConnected: vi.fn(() => true) })} />,
    )
    expect(container.textContent).toContain('Connected')
    const disco = [...container.querySelectorAll('button')].find(b => b.textContent === 'Disconnect')
    expect(disco).toBeTruthy()
  })

  it('clicking Connect with missing creds opens credentials form and shows error', () => {
    const { container } = render(<OAuthServiceCard service={makeService()} />)
    const connectBtn = [...container.querySelectorAll('button')].find(b => b.textContent === 'Connect GitHub')
    connectBtn.click()
    expect(container.textContent).toContain('Enter Client ID and Secret first')
  })

  it('clicking Connect with creds filled calls connect()', () => {
    const connect = vi.fn()
    const { container } = render(
      <OAuthServiceCard service={makeService({
        connect,
        loadCreds: vi.fn(() => ({ clientId: 'abc', clientSecret: 'xyz' })),
      })} />,
    )
    const connectBtn = [...container.querySelectorAll('button')].find(b => b.textContent === 'Connect GitHub')
    connectBtn.click()
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('clicking Disconnect calls disconnect()', () => {
    const disconnect = vi.fn()
    const { container } = render(
      <OAuthServiceCard service={makeService({ isConnected: vi.fn(() => true), disconnect })} />,
    )
    const disco = [...container.querySelectorAll('button')].find(b => b.textContent === 'Disconnect')
    disco.click()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('renders children inside the card', () => {
    const service = { ...makeService(), children: <div>custom-child</div> }
    const { container } = render(<OAuthServiceCard service={service} />)
    expect(container.textContent).toContain('custom-child')
  })
})

describe('IntegrationsView', () => {
  it('renders one OAuthServiceCard per service', () => {
    const makeS = (id, label) => ({
      id, label, icon: 'pr', desc: '', isConnected: () => false,
      connect: vi.fn(), disconnect: vi.fn(),
      credFields: [], loadCreds: () => ({}), saveCreds: vi.fn(),
    })
    const { container } = render(
      <IntegrationsView services={[makeS('ado', 'Azure DevOps'), makeS('github', 'GitHub')]} />,
    )
    expect(container.textContent).toContain('Azure DevOps')
    expect(container.textContent).toContain('GitHub')
  })
})

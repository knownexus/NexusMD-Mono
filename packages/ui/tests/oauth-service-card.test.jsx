import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { IntegrationsView } from '../src/views/view-settings.jsx'

afterEach(() => cleanup())

describe('OAuthServiceCard without credFields', () => {
  it('renders Connect (no credential inputs) when the service has no credFields', () => {
    const service = {
      id: 'google', label: 'Google', icon: 'calendar', desc: 'Google stuff',
      isConnected: () => false, connect: vi.fn(), disconnect: vi.fn(),
      // no credFields / loadCreds / saveCreds
    }
    render(<IntegrationsView services={[service]} />)
    expect(screen.getByText('Google')).toBeTruthy()
    // The connect button is present and not gated behind credential inputs
    expect(screen.getByRole('button', { name: /connect/i })).toBeTruthy()
    // No credential textboxes rendered
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

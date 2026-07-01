import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('@nexusmd/ui', async (orig) => ({
  ...(await orig()),
  IntegrationsView: ({ services }) => (
    <div>{services.map(s => <div key={s.id} data-testid={`svc-${s.id}`}>{s.label}</div>)}</div>
  ),
}))
vi.mock('./cloud-auth.js', () => ({
  makeNativeGoogleBinding: () => ({ id: 'google', isConnected: () => false, connect: vi.fn(), disconnect: vi.fn() }),
  makeNativeMicrosoftBinding: () => ({ id: 'microsoft', isConnected: () => false, connect: vi.fn(), disconnect: vi.fn() }),
  makeDesktopOAuthService: () => ({ isConnected: () => false, connect: vi.fn(), disconnect: vi.fn() }),
  desktopCloudProviders: [],
}))

import { IntegrationsPanel } from './desktop-settings.jsx'

afterEach(() => cleanup())

describe('IntegrationsPanel OAuth services', () => {
  it('offers exactly Google and Microsoft native connects (no ado/github OAuth entries)', () => {
    render(<IntegrationsPanel />)
    expect(screen.getByTestId('svc-google')).toBeTruthy()
    expect(screen.getByTestId('svc-microsoft')).toBeTruthy()
    expect(screen.queryByTestId('svc-ado')).toBeNull()
    expect(screen.queryByTestId('svc-github')).toBeNull()
  })
})

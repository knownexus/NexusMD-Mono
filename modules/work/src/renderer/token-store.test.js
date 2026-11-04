import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@nexusmd/shell-sdk', async (orig) => ({ ...(await orig()), getProfileKey: k => `nexusmd.p.P1.${k}` }))

import { profileSecrets } from '@nexusmd/shell-sdk'
import { getAdoConfig, saveAdoConfig, isAdoConfigured } from './ado-client.js'

afterEach(async () => { localStorage.clear(); await profileSecrets.remove('nexusmd.p.P1.ado.pat') })

describe('ADO token in secure storage', () => {
  it('reads the PAT the shell loaded into the secret cache, not a plain key', async () => {
    localStorage.setItem('nexusmd.p.P1.ado.org', 'acme')
    localStorage.setItem('nexusmd.p.P1.ado.projects', '["P"]')
    localStorage.setItem('nexusmd.p.P1.ado.pat', 'stale-plain')
    await profileSecrets.set('nexusmd.p.P1.ado.pat', 'secure-pat')
    expect(getAdoConfig().pat).toBe('secure-pat')
    expect(isAdoConfigured()).toBe(true)
  })

  it('saving the PAT writes the secret, never the plain key', () => {
    saveAdoConfig({ org: 'acme', pat: 'new-pat' })
    expect(profileSecrets.peek('nexusmd.p.P1.ado.pat')).toBe('new-pat')
    expect(localStorage.getItem('nexusmd.p.P1.ado.pat')).toBeNull()
    expect(localStorage.getItem('nexusmd.p.P1.ado.org')).toBe('acme')
  })
})

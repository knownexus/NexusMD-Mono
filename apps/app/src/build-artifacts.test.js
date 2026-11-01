import { describe, it, expect, vi } from 'vitest'
import { saveArtifact } from './build-artifacts.js'

// Listing, mapping and auth are tested in @nexusmd/core (tests/build-artifacts.test.js).
describe('build artifacts (mobile)', () => {
  it('hands the plugin the url, filename and headers', async () => {
    const plugin = { save: vi.fn(async () => ({ bytes: 1 })) }
    await saveArtifact({ provider: 'ado', url: 'https://dev.azure.com/u', filename: 'a.zip' }, { plugin, headers: { Authorization: 't' } })
    expect(plugin.save).toHaveBeenCalledWith({ url: 'https://dev.azure.com/u', filename: 'a.zip', headers: { Authorization: 't' } })
  })
})

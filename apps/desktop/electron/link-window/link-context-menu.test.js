import { describe, it, expect } from 'vitest'
import { buildLinkMenuTemplate } from './link-context-menu.cjs'

// A stand-in for manager.cjs's isAllowedUrl (http/https only).
const allow = (u) => { try { return /^https?:$/.test(new URL(u).protocol) } catch { return false } }

describe('buildLinkMenuTemplate', () => {
  it('returns the three link actions in order for an http link', () => {
    const template = buildLinkMenuTemplate({ linkURL: 'http://example.com/', isAllowedUrl: allow })
    expect(template).toEqual([
      { label: 'Open link', action: 'open' },
      { label: 'Open in browser', action: 'openExternal' },
      { label: 'Copy link address', action: 'copy' },
    ])
  })

  it('returns the three link actions for an https link', () => {
    const template = buildLinkMenuTemplate({ linkURL: 'https://uat.example.com/', isAllowedUrl: allow })
    expect(template).toHaveLength(3)
    expect(template.map(i => i.action)).toEqual(['open', 'openExternal', 'copy'])
  })

  it('returns null when there is no link under the cursor', () => {
    expect(buildLinkMenuTemplate({ linkURL: '', isAllowedUrl: allow })).toBeNull()
    expect(buildLinkMenuTemplate({ isAllowedUrl: allow })).toBeNull()
  })

  it('returns null for disallowed schemes', () => {
    expect(buildLinkMenuTemplate({ linkURL: 'file:///etc/passwd', isAllowedUrl: allow })).toBeNull()
    expect(buildLinkMenuTemplate({ linkURL: 'mailto:a@b.com', isAllowedUrl: allow })).toBeNull()
  })
})

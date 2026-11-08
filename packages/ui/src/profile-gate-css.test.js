import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const file = './styles/base.css' // a variable, so Vite does not treat the URL as an asset
const css = readFileSync(new URL(file, import.meta.url), 'utf8')
const rule = (selector) => {
  const start = css.indexOf(`${selector} {`)
  return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}

// The first-run gate fills the screen. On a phone its card is taller than the screen, so the screen must scroll or the
// "Create profile" button at the bottom cannot be reached. Centring with align-items would also cut off the top of a tall
// card, so the card centres itself with auto margins instead.
describe('first-run profile gate layout', () => {
  it('scrolls when the card is taller than the screen', () => {
    expect(rule('.profile-setup')).toMatch(/overflow-y:\s*auto/)
  })
  it('centres the card with auto margins, so a tall card is not clipped at the top', () => {
    expect(rule('.profile-setup')).not.toMatch(/align-items:\s*center/)
    expect(rule('.profile-setup__card')).toMatch(/margin:\s*auto/)
  })
})

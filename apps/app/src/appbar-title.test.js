import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// A long title (an open file's name) is cut short with "…" and never runs under the buttons beside it. The title sits in a box inside
// the flexible `.m-ab-lead`; that box must be allowed to shrink below the width of its text, or the "…" never appears.
const file = './styles/helm-mobile.css' // a variable, so Vite does not treat the URL as an asset
const css = readFileSync(new URL(file, import.meta.url), 'utf8')
const rule = (selector) => {
  const start = css.indexOf(`${selector} {`)
  return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}

describe('the app bar title', () => {
  it('can shrink, so a long title ends in an ellipsis instead of overlapping the actions', () => {
    expect(rule('.m-appbar h1')).toMatch(/text-overflow:\s*ellipsis/)
    expect(rule('.m-appbar .m-ab-lead > div')).toMatch(/min-width:\s*0/)
  })
})

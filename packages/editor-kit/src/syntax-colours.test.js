import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const colours = () => read('./syntax-colours.css')

describe('syntax colours', () => {
  it('defines the token classes from theme tokens', () => {
    const css = colours()
    for (const cls of ['tok-keyword', 'tok-string', 'tok-number', 'tok-comment', 'tok-typeName', 'tok-propertyName', 'tok-invalid']) {
      const rule = css.split('\n').find(line => line.split(/[\s,{]+/).includes('.' + cls))
      expect(rule, `a rule for .${cls}`).toBeTruthy()
      expect(rule, `.${cls} uses a theme token`).toMatch(/var\(--/)
    }
  })

  it('devenv-git.css imports it and no longer defines the rules itself', () => {
    const css = read('./devenv-git.css')
    expect(css).toMatch(/@import\s+['"]\.\/syntax-colours\.css['"]\s*;/)
    expect(css).not.toMatch(/\.tok-keyword/)
  })

  it('the Editor module imports it', () => {
    const app = read('../../../modules/editor/src/renderer/editor-app.jsx')
    expect(app).toMatch(/import\s+['"]@nexusmd\/editor-kit\/syntax-colours\.css['"]/)
  })
})

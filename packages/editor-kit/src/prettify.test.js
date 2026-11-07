import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { canPrettify, prettify } from './prettify.js'

const CASES = [
  ['json', 'a.json', '{"a":1,"b":[1,2]}', '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}\n'],
  ['js', 'a.js', 'const a={b:1,c:[1,2]};function f(x){return x+1}', 'const a = { b: 1, c: [1, 2] };\nfunction f(x) {\n  return x + 1;\n}\n'],
  ['jsx', 'a.jsx', 'const a=<div className="x">{y}</div>', 'const a = <div className="x">{y}</div>;\n'],
  ['ts', 'a.ts', 'interface A{a:number;b?:string}\nconst x:A={a:1}', 'interface A {\n  a: number;\n  b?: string;\n}\nconst x: A = { a: 1 };\n'],
  ['tsx', 'a.tsx', 'const a:number=1;const b=<div>{a}</div>', 'const a: number = 1;\nconst b = <div>{a}</div>;\n'],
  ['html', 'a.html', '<div><p>hi</p><ul><li>a</li><li>b</li></ul></div>', '<div>\n  <p>hi</p>\n  <ul>\n    <li>a</li>\n    <li>b</li>\n  </ul>\n</div>\n'],
  ['css', 'a.css', 'a{color:red;background:blue}b{margin:0}', 'a {\n  color: red;\n  background: blue;\n}\nb {\n  margin: 0;\n}\n'],
  ['scss', 'a.scss', '.a{.b{color:red}}', '.a {\n  .b {\n    color: red;\n  }\n}\n'],
  ['less', 'a.less', '.a{.b{color:red}}', '.a {\n  .b {\n    color: red;\n  }\n}\n'],
  ['yaml', 'a.yml', 'a:   1\nb:\n    - x\n    -   y\n', 'a: 1\nb:\n  - x\n  - y\n'],
  ['xml', 'a.xml', '<a><b>1</b><c x="1"><d/></c></a>', '<a>\n  <b>1</b>\n  <c x="1">\n    <d/>\n  </c>\n</a>'],
  ['sql', 'a.sql', 'select a,b from t where x=1 and y=2 order by a', 'select\n  a,\n  b\nfrom\n  t\nwhere\n  x = 1\n  and y = 2\norder by\n  a'],
]

describe('canPrettify', () => {
  it('is true for the tidy-able types, in any case, and false for everything else', () => {
    for (const p of ['a.json', 'a.js', 'a.mjs', 'a.cjs', 'a.jsx', 'a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.html', 'a.htm', 'a.css', 'a.scss', 'a.less',
      'a.yml', 'a.yaml', 'a.xml', 'a.xsd', 'a.xsl', 'a.xslt', 'a.svg', 'a.csproj', 'a.props', 'a.plist', 'a.sql', 'A.JSON', 'B.TS', 'dir\\sub/C.Yaml']) {
      expect(canPrettify(p), p).toBe(true)
    }
    for (const p of ['a.cs', 'a.py', 'a.md', 'a.txt', 'a.go', 'a.sh', 'a.toml', 'a.ini', 'readme', '', undefined, null]) expect(canPrettify(p), String(p)).toBe(false)
  })
})

describe('prettify', () => {
  for (const [name, path, before, after] of CASES) {
    it(`tidies ${name}`, async () => {
      expect(await prettify(path, before)).toEqual({ ok: true, text: after })
    })
  }

  it('is idempotent: tidying the output again returns the same text', async () => {
    for (const [name, path, before] of CASES) {
      const once = await prettify(path, before)
      const twice = await prettify(path, once.text)
      expect(twice, name).toEqual(once)
    }
  })

  it('keeps JSON numbers exactly, and the order of the keys', async () => {
    const r = await prettify('a.json', '{"n":12345678901234567890,"z":1,"a":2,"f":1.50,"e":1E5}')
    expect(r.ok).toBe(true)
    expect(r.text).toContain('12345678901234567890')
    expect(r.text).toContain('1.50')
    expect(r.text).toContain('1E5')
    expect([...r.text.matchAll(/"(\w+)":/g)].map(m => m[1])).toEqual(['n', 'z', 'a', 'f', 'e'])
  })

  it('tidies a top-level array, a bare number and an empty file', async () => {
    expect(await prettify('a.json', '[1,{"a":2}]')).toEqual({ ok: true, text: '[\n  1,\n  {\n    "a": 2\n  }\n]\n' })
    expect(await prettify('a.json', '42')).toEqual({ ok: true, text: '42\n' })
    for (const path of ['a.json', 'a.js', 'a.css', 'a.yaml', 'a.sql', 'a.xml']) expect(await prettify(path, ''), path).toEqual({ ok: true, text: '' })
  })

  it('uses plain line endings whatever the file had', async () => {
    const r = await prettify('a.js', 'const a = 1\r\nconst b = 2\r\n')
    expect(r).toEqual({ ok: true, text: 'const a = 1;\nconst b = 2;\n' })
  })

  it('refuses broken input and says why, with no text', async () => {
    const broken = [['a.json', '{ "a": '], ['a.js', 'const a = {'], ['a.ts', 'let x: = ;'], ['a.css', 'a{color:red'], ['a.yaml', 'a: [1, 2\nb: : :'],
      ['a.xml', '<a><b></a>'], ['a.sql', 'select * from t where (a = 1']]
    for (const [path, text] of broken) {
      const r = await prettify(path, text)
      expect(r.ok, path).toBe(false)
      expect(r.message, path).toMatch(/^Could not tidy: \S/)
      expect(r.message.length, path).toBeLessThanOrEqual('Could not tidy: '.length + 160)
      expect(r.message, path).not.toContain('\n')
      expect(r, path).not.toHaveProperty('text')
    }
  })

  it('refuses C# and other types without a formatter', async () => {
    expect(await prettify('a.cs', 'class A{}')).toEqual({ ok: false, message: 'This file type cannot be tidied.' })
    expect(await prettify('a.py', 'x=1')).toEqual({ ok: false, message: 'This file type cannot be tidied.' })
  })

  it('refuses a file over 1,000,000 characters', async () => {
    const big = '[' + '1,'.repeat(500000) + '1]'
    expect(big.length).toBeGreaterThan(1000000)
    expect(await prettify('a.json', big)).toEqual({ ok: false, message: 'This file is too large to tidy here (the limit is 1 MB).' })
  })

  it('treats upper-case extensions the same', async () => {
    expect(await prettify('A.JSON', '{"a":1}')).toEqual({ ok: true, text: '{\n  "a": 1\n}\n' })
    expect(await prettify('B.TS', 'let a:number=1')).toEqual({ ok: true, text: 'let a: number = 1;\n' })
  })

  it('does not load formatters at import', () => {
    const file = './prettify.js' // a variable, so Vite does not treat the URL as an asset
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
    expect(source).not.toMatch(/^\s*import\s[^\n]*['"](prettier|sql-formatter|xml-formatter)/m)
    expect(source).toMatch(/import\(\s*['"]prettier\/standalone['"]\s*\)/)
  })
})

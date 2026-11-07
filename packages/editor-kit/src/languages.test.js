import { describe, it, expect } from 'vitest'
import { languageForPath, languageLabel, languageExtension, parserFor } from './languages.js'

const TABLE = [
  // existing
  ['a.js', 'javascript'], ['a.jsx', 'javascript'], ['a.ts', 'typescript'], ['a.tsx', 'typescript'], ['a.css', 'css'], ['a.scss', 'css'],
  ['a.html', 'html'], ['a.cs', 'csharp'], ['a.json', 'json'], ['a.yml', 'yaml'], ['a.sql', 'sql'], ['a.md', 'markdown'], ['a.ps1', 'powershell'],
  // new
  ['a.xml', 'xml'], ['a.xsd', 'xml'], ['a.svg', 'xml'], ['App.csproj', 'xml'], ['a.props', 'xml'], ['a.plist', 'xml'],
  ['run.sh', 'shell'], ['a.bash', 'shell'], ['a.zsh', 'shell'],
  ['a.py', 'python'], ['a.pyw', 'python'], ['A.java', 'java'], ['a.c', 'c'], ['a.h', 'c'],
  ['a.cpp', 'cpp'], ['a.cc', 'cpp'], ['a.cxx', 'cpp'], ['a.hpp', 'cpp'], ['a.hh', 'cpp'],
  ['a.go', 'go'], ['a.rs', 'rust'], ['a.rb', 'ruby'], ['a.php', 'php'], ['a.toml', 'toml'],
  ['a.ini', 'ini'], ['a.conf', 'ini'], ['a.cfg', 'ini'], ['a.properties', 'ini'],
  // upper case and folders
  ['A.CS', 'csharp'], ['FILE.TS', 'typescript'], ['dir\sub/Main.PY', 'python'], ['SCRIPT.SH', 'shell'],
]

describe('languageForPath', () => {
  it('maps every extension to its language', () => {
    for (const [path, name] of TABLE) expect(languageForPath(path), path).toBe(name)
  })
  it('treats unknown or missing extensions as plain text', () => {
    for (const path of ['readme', 'x.unknownext', '', undefined, null, '.gitignore-ish', 'dir.d/file']) expect(languageForPath(path), String(path)).toBeNull()
  })
})

describe('the language table', () => {
  const names = [...new Set(TABLE.map(([, name]) => name))]
  it('labels every language', () => {
    expect(Object.fromEntries(names.map(n => [n, languageLabel(n)]))).toMatchObject({
      xml: 'XML', shell: 'Shell', python: 'Python', java: 'Java', c: 'C', cpp: 'C++', go: 'Go', rust: 'Rust', ruby: 'Ruby', php: 'PHP', toml: 'TOML', ini: 'INI',
      csharp: 'C#', json: 'JSON',
    })
    for (const n of names) expect(languageLabel(n), n).toBeTruthy()
    expect(languageLabel('nope')).toBeNull()
  })
  it('gives every language a parser, and plain text none', () => {
    for (const n of names) expect(parserFor(n), n).toBeTruthy()
    expect(parserFor('nope')).toBeNull()
    expect(languageExtension('nope')).toEqual([])
  })
  it('colours a line of real code with more than one kind of token', () => {
    const samples = { python: 'def f(x):\n  return "a" + 1  # note\n', go: 'func main() { x := "a" }\n', rust: 'fn main() { let x = 1; }\n', xml: '<a b="c">d</a>\n', php: '<?php echo "a"; ?>\n', toml: 'a = "b"\n[t]\n', ini: '[s]\na=1\n', shell: 'echo "a" # c\n' }
    for (const [name, code] of Object.entries(samples)) {
      const tree = parserFor(name).parse(code)
      let nodes = 0
      tree.iterate({ enter: () => { nodes++ } })
      expect(nodes, name).toBeGreaterThan(2)
    }
  })
})

// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const { isPassiveTextName, PASSIVE_EXTENSIONS } = createRequire(import.meta.url)('./git-files.cjs')

describe('which files may be opened with the default app', () => {
  it.each(['a.txt', 'notes.MD', 'docs/readme.markdown', 'c.json', 'x.YAML', 'y.yml', 'z.toml', 'app.log', 'w.ini', 'main.c', 'util.h', 'a.cpp', 'q.cs', 'q.go', 'q.rs', 'q.java', 'q.sql', 'style.css', 'LICENSE', 'README', 'docs/CHANGELOG', '.gitignore', 'sub/.editorconfig'])
    ('allows %s', name => expect(isPassiveTextName(name)).toBe(true))

  it.each([
    'a.exe', 'a.bat', 'a.cmd', 'a.ps1', 'a.vbs', 'a.js', 'a.mjs', 'a.py', 'a.sh', 'a.jar', 'a.lnk', 'a.url', 'a.reg',
    'a.html', 'a.htm', 'a.svg', 'a.xhtml', 'a.hta', 'a.chm', 'a.docm', 'a.xlsm', 'a.csv', 'a.tsv', 'a.slk', 'a.iqy',
    'a.settings-ms', 'a.library-ms', 'a.application', 'a.appref-ms', 'a.msc', 'a.pif', 'a.jnlp', 'a.xml', 'a.pdf', 'a.ts',
    'Makefile', 'Dockerfile', 'run', 'a.', 'a.txt.exe', 'a.txt ', '.hidden', '',
  ])('refuses %s', name => expect(isPassiveTextName(name)).toBe(false))

  it('looks only at the final extension, so a harmless-looking prefix does not help', () => {
    expect(isPassiveTextName('invoice.txt.bat')).toBe(false)
    expect(isPassiveTextName('archive.exe.txt')).toBe(true)
  })

  it('keeps the list short and free of anything a program or spreadsheet would run', () => {
    for (const e of ['exe', 'bat', 'js', 'html', 'svg', 'csv', 'xml', 'docm', 'py', 'ps1', 'sh']) expect(PASSIVE_EXTENSIONS.has(e)).toBe(false)
  })
})

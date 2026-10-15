import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { parseDiff, diffSides } from './diff.js'

const fixture = fs.readFileSync(new URL('./fixtures/three-hunks.diff', import.meta.url), 'utf8')
const lines = (...l) => l.join('\n') + '\n'

describe('parseDiff', () => {
  it('reads hunks with old and new line numbers', () => {
    const { files } = parseDiff(fixture)
    expect(files).toHaveLength(1)
    const f = files[0]
    expect([f.path, f.oldPath, f.newPath, f.status, f.binary, f.combined]).toEqual(['src/app.js', 'src/app.js', 'src/app.js', 'modified', false, false])
    expect(f.hunks.map(h => [h.oldStart, h.newStart])).toEqual([[1, 1], [10, 10], [20, 21]])
    expect(f.hunks[1].header).toBe('@@ -10,2 +10,3 @@ function tail() {')
    expect(f.hunks[0].lines).toEqual([
      { kind: 'context', text: 'one', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'two', oldNo: 2, newNo: null },
      { kind: 'add', text: 'TWO', oldNo: null, newNo: 2 },
      { kind: 'context', text: 'three', oldNo: 3, newNo: 3 },
    ])
    expect(f.hunks[1].lines.map(l => [l.kind, l.oldNo, l.newNo])).toEqual([['context', 10, 10], ['add', null, 11], ['context', 11, 12]])
  })

  it('parses CRLF output the same as LF', () => {
    expect(parseDiff(fixture.replace(/\n/g, '\r\n'))).toEqual(parseDiff(fixture))
  })

  it('reads renames, including the tab git adds after names with spaces', () => {
    const { files } = parseDiff(lines(
      'diff --git a/old name.txt b/new name.txt', 'similarity index 90%', 'rename from old name.txt', 'rename to new name.txt',
      'index 3333333..4444444 100644', '--- a/old name.txt\t', '+++ b/new name.txt\t', '@@ -1 +1 @@', '-hello', '+hello world'))
    expect([files[0].status, files[0].oldPath, files[0].newPath, files[0].path]).toEqual(['renamed', 'old name.txt', 'new name.txt', 'new name.txt'])
    expect(files[0].hunks[0].lines.map(l => l.kind)).toEqual(['del', 'add'])
  })

  it('reads new and deleted files', () => {
    const added = parseDiff(lines('diff --git a/added.txt b/added.txt', 'new file mode 100644', 'index 0000000..5555555',
      '--- /dev/null', '+++ b/added.txt', '@@ -0,0 +1,2 @@', '+first', '+second')).files[0]
    expect([added.status, added.oldPath, added.path]).toEqual(['added', null, 'added.txt'])
    expect(added.hunks[0].lines.map(l => l.newNo)).toEqual([1, 2])
    const gone = parseDiff(lines('diff --git a/gone.txt b/gone.txt', 'deleted file mode 100644', 'index 6666666..0000000',
      '--- a/gone.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-bye')).files[0]
    expect([gone.status, gone.newPath, gone.path]).toEqual(['deleted', null, 'gone.txt'])
  })

  it('keeps mode changes as meta lines and takes the path from the diff line', () => {
    const f = parseDiff(lines('diff --git a/run.sh b/run.sh', 'old mode 100644', 'new mode 100755')).files[0]
    expect([f.path, f.status, f.meta, f.hunks]).toEqual(['run.sh', 'modified', ['old mode 100644', 'new mode 100755'], []])
  })

  it('marks no-newline notes as meta lines', () => {
    const f = parseDiff(lines('diff --git a/end.txt b/end.txt', 'index 7777777..8888888 100644', '--- a/end.txt', '+++ b/end.txt',
      '@@ -1 +1 @@', '-last', '\\ No newline at end of file', '+last line', '\\ No newline at end of file')).files[0]
    expect(f.hunks[0].lines.map(l => [l.kind, l.text])).toEqual([
      ['del', 'last'], ['meta', 'No newline at end of file'], ['add', 'last line'], ['meta', 'No newline at end of file'],
    ])
  })

  it('flags binary files', () => {
    const f = parseDiff(lines('diff --git a/logo.png b/logo.png', 'index 9999999..aaaaaaa 100644', 'Binary files a/logo.png and b/logo.png differ')).files[0]
    expect([f.path, f.binary, f.hunks]).toEqual(['logo.png', true, []])
  })

  it('unquotes octal-escaped unicode paths', () => {
    const q = '"a/caf\\303\\251 \\"q\\".txt"'
    const f = parseDiff(lines(`diff --git ${q} ${q.replace('a/', 'b/')}`, 'index bbbbbbb..ccccccc 100644',
      `--- ${q}`, `+++ ${q.replace('a/', 'b/')}`, '@@ -1 +1 @@', '-a', '+b')).files[0]
    expect(f.path).toBe('café "q".txt')
  })

  it('reads combined conflict diffs with result line numbers only', () => {
    const f = parseDiff(lines('diff --cc both.txt', 'index ddddddd,eeeeeee..0000000', '--- a/both.txt', '+++ b/both.txt',
      '@@@ -1,1 -1,1 +1,5 @@@', '++<<<<<<< ours', ' +mine', '++=======', '+ theirs', '++>>>>>>> theirs')).files[0]
    expect([f.path, f.combined, f.hunks[0].columns]).toEqual(['both.txt', true, 2])
    expect(f.hunks[0].lines.map(l => [l.kind, l.text, l.oldNo, l.newNo])).toEqual([
      ['add', '<<<<<<< ours', null, 1], ['add', 'mine', null, 2], ['add', '=======', null, 3], ['add', 'theirs', null, 4], ['add', '>>>>>>> theirs', null, 5],
    ])
  })

  it('reads the synthetic diff main builds for untracked files', () => {
    const f = parseDiff(lines('--- /dev/null', '+++ b/notes.md', '@@ -0,0 +1,2 @@', '+one', '+two')).files[0]
    expect([f.path, f.status, f.hunks[0].lines.length]).toEqual(['notes.md', 'added', 2])
  })

  it('returns no files for empty output', () => {
    expect(parseDiff('')).toEqual({ files: [] })
  })
})

describe('diffSides', () => {
  it('labels each side by where the change lives', () => {
    expect(diffSides({ area: 'unstaged' })).toEqual({ old: 'index', new: 'working tree', staging: 'stage' })
    expect(diffSides({ area: 'staged' })).toEqual({ old: 'HEAD', new: 'index', staging: 'unstage' })
    expect(diffSides({ area: 'untracked' })).toEqual({ old: null, new: 'new file', staging: null })
    expect(diffSides({ area: 'conflict' })).toEqual({ old: 'ours', new: 'theirs', staging: null })
    expect(diffSides({ area: 'other' })).toBeNull()
  })
})

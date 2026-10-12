import { describe, it, expect } from 'vitest'
import { ansiToSpans, stripAnsi } from './ansi.js'

describe('ansiToSpans', () => {
  it('returns one plain span for plain text', () => {
    expect(ansiToSpans('hello')).toEqual([{ text: 'hello', color: null, bold: false }])
  })
  it('splits on colour codes and resets', () => {
    expect(ansiToSpans('\x1b[32mok\x1b[0m done')).toEqual([
      { text: 'ok', color: 'green', bold: false },
      { text: ' done', color: null, bold: false },
    ])
  })
  it('handles bold + bright colours and combined codes', () => {
    expect(ansiToSpans('\x1b[1;91mFAILED\x1b[0m')).toEqual([{ text: 'FAILED', color: 'red', bold: true }])
  })
  it('skips 256-colour and truecolour parameters instead of reading them as SGR codes', () => {
    expect(ansiToSpans('\x1b[38;5;1mx\x1b[0m')).toEqual([{ text: 'x', color: null, bold: false }])
    expect(ansiToSpans('\x1b[38;2;255;0;31mx')).toEqual([{ text: 'x', color: null, bold: false }])
    expect(ansiToSpans('\x1b[1;38;5;196;32mok')).toEqual([{ text: 'ok', color: 'green', bold: true }])
  })
  it('drops non-colour escapes', () => {
    expect(ansiToSpans('\x1b[2Kline\x1b[?25l')).toEqual([{ text: 'line', color: null, bold: false }])
  })
  it('stripAnsi removes all escapes', () => {
    expect(stripAnsi('\x1b[36m── [1/3] Build \x1b[0m')).toBe('── [1/3] Build ')
  })
})

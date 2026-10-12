// packages/core/src/modules/devenv/ansi.js
//
// devenv's Write-Host colours arrive as ANSI SGR codes (host mode sets
// $PSStyle.OutputRendering='Ansi'); docker/git add their own. Only colour and bold are kept.

const ESC = /\x1b\[([0-9;?]*)([A-Za-z])/g
const COLORS = {
  30: 'black', 31: 'red', 32: 'green', 33: 'yellow', 34: 'blue', 35: 'magenta', 36: 'cyan', 37: 'white',
  90: 'gray', 91: 'red', 92: 'green', 93: 'yellow', 94: 'blue', 95: 'magenta', 96: 'cyan', 97: 'white',
}

/**
 * @param {string} line
 * @returns {{ text: string, color: string|null, bold: boolean }[]}
 */
export function ansiToSpans(line) {
  const spans = []
  let color = null
  let bold = false
  let last = 0
  const push = text => {
    if (!text) return
    const prev = spans[spans.length - 1]
    if (prev && prev.color === color && prev.bold === bold) prev.text += text
    else spans.push({ text, color, bold })
  }
  for (const m of String(line ?? '').matchAll(ESC)) {
    push(line.slice(last, m.index))
    last = m.index + m[0].length
    if (m[2] !== 'm') continue
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number)
    for (const c of codes) {
      if (c === 0) { color = null; bold = false }
      else if (c === 1) bold = true
      else if (c === 22) bold = false
      else if (c === 39) color = null
      else if (COLORS[c]) color = COLORS[c]
    }
  }
  push(String(line ?? '').slice(last))
  return spans.length ? spans : [{ text: '', color: null, bold: false }]
}

/** @param {string} line */
export function stripAnsi(line) {
  return String(line ?? '').replace(ESC, '')
}

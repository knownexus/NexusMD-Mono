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
  const str = String(line ?? '')
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
  for (const m of str.matchAll(ESC)) {
    push(str.slice(last, m.index))
    last = m.index + m[0].length
    if (m[2] !== 'm') continue
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]
      if (c === 0) { color = null; bold = false }
      else if (c === 1) bold = true
      else if (c === 22) bold = false
      else if (c === 39) color = null
      // 38/48 introduce extended colour: 5;n (256-colour) or 2;r;g;b (truecolour). Skip their
      // parameters so they are not misread as SGR codes; the colour itself is left unchanged.
      else if (c === 38 || c === 48) {
        const mode = codes[i + 1]
        if (mode === 5) i += 2
        else if (mode === 2) i += 4
      }
      else if (c === 49) { /* default background: no foreground effect */ }
      else if (COLORS[c]) color = COLORS[c]
    }
  }
  push(str.slice(last))
  return spans.length ? spans : [{ text: '', color: null, bold: false }]
}

/** @param {string} line */
export function stripAnsi(line) {
  return String(line ?? '').replace(ESC, '')
}

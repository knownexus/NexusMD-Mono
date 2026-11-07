const isWordChar = ch => /[a-z0-9]/.test(ch)

/**
 * `text` cut into [{ text, hit }] where each hit is a typed term that starts a word (the start of the text,
 * or right after anything that isn't a letter or digit). The same rule as word-start filtering, so what is
 * marked is why the text matched. Joined, the segments give back `text`.
 */
export function matchSegments(text, query) {
  const terms = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  const lower = text.toLowerCase()
  const marked = new Array(text.length).fill(false)
  for (const term of terms) {
    for (let from = lower.indexOf(term); from >= 0; from = lower.indexOf(term, from + 1)) {
      if (from === 0 || !isWordChar(lower[from - 1])) marked.fill(true, from, from + term.length)
    }
  }
  const out = []
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1]
    if (last && last.hit === marked[i]) last.text += text[i]
    else out.push({ text: text[i], hit: marked[i] })
  }
  return out.length ? out : [{ text, hit: false }]
}

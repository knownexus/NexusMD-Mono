// What the Regex Tester's parts share: flag descriptions, the capture-group colours and the saved pattern's name.

export const FLAG_INFO = [
  ['g', 'Global — find all matches'],
  ['i', 'Case insensitive'],
  ['m', 'Multiline — ^ and $ match line ends'],
  ['s', 'Dotall — . matches newlines'],
  ['u', 'Unicode'],
]

// Per-capture-group highlight colours: a small fixed, theme-independent palette (group N needs a stable,
// distinguishable colour, not a semantic theme colour).
export const GROUP_COLORS = ['#818cf8', '#60a5fa', '#34d399', '#fb923c', '#c084fc', '#f472b6']

/** The colour of capture group `n` (1-based). */
export const groupColor = n => GROUP_COLORS[(n - 1) % GROUP_COLORS.length]

export function flagsToString(flags) {
  return Object.keys(flags).filter(f => flags[f]).join('')
}

// A saved doc's display name: the pattern itself, since that's the natural identifier for a saved regex.
export function regexAutoName(state) {
  return state.pattern ? `/${state.pattern}/${flagsToString(state.flags)}`.slice(0, 80) : 'Untitled'
}

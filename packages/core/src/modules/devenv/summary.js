// packages/core/src/modules/devenv/summary.js
//
// The "Session up" summary devenv start emits; a row with no value is a section heading,
// exactly as the terminal prints it.

export function normaliseSummary(result) {
  const sections = []
  let current = null
  for (const row of Array.isArray(result?.rows) ? result.rows : []) {
    const key = String(row?.key ?? '')
    const value = String(row?.value ?? '')
    if (!value) { current = { heading: key, rows: [] }; sections.push(current); continue }
    if (!current) { current = { heading: null, rows: [] }; sections.push(current) }
    current.rows.push({ key, value, failed: value.startsWith('FAILED') })
  }
  return {
    title: String(result?.title ?? 'Session up'),
    sections: sections.filter(s => s.rows.length),
    notes: (Array.isArray(result?.notes) ? result.notes : []).map(String),
  }
}

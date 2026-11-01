// md-extras.js — the pure parts of the Markdown tool's cheat sheet, learn mode and Compare view.

// ── Cheat sheet ──────────────────────────────────────────────────────────────
// `format` names the formatting chip an entry inserts (see FORMATS in md-phone.jsx).
export const CHEAT = [
  { group: 'Text', items: [
    { name: 'Bold', syntax: '**text**', note: 'Make text bold', format: 'Bold' },
    { name: 'Italic', syntax: '*text*', note: 'Make text italic', format: 'Italic' },
    { name: 'Strikethrough', syntax: '~~text~~', note: 'Strike through text', format: 'Strikethrough' },
    { name: 'Inline code', syntax: '`code`', note: 'Code or a variable name', format: 'Inline code' },
  ] },
  { group: 'Structure', items: [
    { name: 'Heading 1', syntax: '# Heading', note: 'Top-level heading', format: 'Heading 1' },
    { name: 'Heading 2', syntax: '## Heading', note: 'Second-level heading', format: 'Heading 2' },
    { name: 'Heading 3', syntax: '### Heading', note: 'Third-level heading', format: 'Heading 3' },
    { name: 'Quote', syntax: '> quote', note: 'Indented quote block', format: 'Quote' },
    { name: 'Divider', syntax: '---', note: 'Horizontal line', format: 'Divider' },
  ] },
  { group: 'Lists', items: [
    { name: 'Bullet list', syntax: '- item', note: 'Unordered list item', format: 'Bullet list' },
    { name: 'Numbered list', syntax: '1. item', note: 'Ordered list item', format: 'Numbered list' },
    { name: 'Task', syntax: '- [ ] task', note: 'Checkbox item', format: 'Task' },
  ] },
  { group: 'Links, media and code', items: [
    { name: 'Link', syntax: '[text](url)', note: 'A clickable link', format: 'Link' },
    { name: 'Image', syntax: '![alt](url)', note: 'An embedded image', format: 'Image' },
    { name: 'Code block', syntax: '```\ncode\n```', note: 'Fenced block of code', format: 'Code block' },
    { name: 'Table', syntax: '| a | b |\n| --- | --- |', note: 'A table with a header row', format: 'Table' },
  ] },
];

// ── Learn mode ───────────────────────────────────────────────────────────────
// Tapping something in the preview shows the Markdown that made it.
const LEARN = {
  H1: ['Heading 1', '# Heading'], H2: ['Heading 2', '## Heading'], H3: ['Heading 3', '### Heading'],
  H4: ['Heading 4', '#### Heading'], H5: ['Heading 5', '##### Heading'], H6: ['Heading 6', '###### Heading'],
  STRONG: ['Bold', '**text**'], B: ['Bold', '**text**'], EM: ['Italic', '*text*'], I: ['Italic', '*text*'],
  DEL: ['Strikethrough', '~~text~~'], S: ['Strikethrough', '~~text~~'],
  PRE: ['Code block', '```\ncode\n```'], CODE: ['Inline code', '`code`'],
  BLOCKQUOTE: ['Quote', '> quote'], HR: ['Divider', '---'],
  A: ['Link', '[text](url)'], IMG: ['Image', '![alt](url)'],
  TABLE: ['Table', '| a | b |\n| --- | --- |'], TH: ['Table', '| a | b |\n| --- | --- |'], TD: ['Table', '| a | b |\n| --- | --- |'],
  LI: ['List item', '- item'], UL: ['Bullet list', '- item'], OL: ['Numbered list', '1. item'],
};

// Walks up from what was tapped to the nearest element that has a Markdown meaning. A checkbox
// list item is a task; a <code> inside a <pre> is the block, not inline code.
export function learnTarget(el, root) {
  for (let n = el; n && n !== root; n = n.parentElement) {
    const tag = n.tagName;
    if (tag === 'CODE' && n.parentElement?.tagName === 'PRE') continue;
    if (tag === 'LI') {
      if (n.querySelector(':scope > input[type="checkbox"]')) return { name: 'Task', syntax: '- [ ] task' };
      if (n.parentElement?.tagName === 'OL') return { name: 'Numbered list item', syntax: '1. item' };
    }
    if (LEARN[tag]) return { name: LEARN[tag][0], syntax: LEARN[tag][1] };
  }
  return null;
}

// ── Compare ──────────────────────────────────────────────────────────────────
export const MAX_DIFF_LINES = 600;

// Line diff by longest common subsequence: [{ t: '=' | '+' | '-', v }]. `null` when either side is
// too long to compare on a phone.
export function diffLines(oldText, newText) {
  const a = String(oldText).split('\n'), b = String(newText).split('\n');
  const N = a.length, M = b.length;
  if (N > MAX_DIFF_LINES || M > MAX_DIFF_LINES) return null;
  const lcs = new Array((N + 1) * (M + 1)).fill(0);
  for (let i = N - 1; i >= 0; i--) {
    for (let j = M - 1; j >= 0; j--) {
      lcs[i * (M + 1) + j] = a[i] === b[j] ? 1 + lcs[(i + 1) * (M + 1) + j + 1] : Math.max(lcs[(i + 1) * (M + 1) + j], lcs[i * (M + 1) + j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < N || j < M) {
    if (i < N && j < M && a[i] === b[j]) { out.push({ t: '=', v: a[i] }); i++; j++; }
    // Drop the old line when that keeps the longest common run; otherwise the new line is an addition.
    else if (i < N && (j >= M || lcs[(i + 1) * (M + 1) + j] >= lcs[i * (M + 1) + j + 1])) { out.push({ t: '-', v: a[i] }); i++; }
    else { out.push({ t: '+', v: b[j] }); j++; }
  }
  return out;
}

export const diffCounts = (diff) => ({ added: diff.filter(d => d.t === '+').length, removed: diff.filter(d => d.t === '-').length });

// Hides long unchanged stretches: keeps `context` lines around each change and marks the gap.
export function collapseDiff(diff, context = 2) {
  const keep = new Array(diff.length).fill(false);
  diff.forEach((d, i) => { if (d.t !== '=') for (let k = Math.max(0, i - context); k <= Math.min(diff.length - 1, i + context); k++) keep[k] = true; });
  const out = [];
  let gap = 0;
  diff.forEach((d, i) => {
    if (keep[i]) { if (gap) { out.push({ t: 'gap', v: `${gap} unchanged line${gap === 1 ? '' : 's'}` }); gap = 0; } out.push(d); } else gap++;
  });
  if (gap) out.push({ t: 'gap', v: `${gap} unchanged line${gap === 1 ? '' : 's'}` });
  return out;
}

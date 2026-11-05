// md-extras.js — the pure parts of the Markdown tool's cheat sheet, learn mode and Compare view.
// One syntax data set and one element-to-source table serve both layouts: the desktop Markdown view
// (cheat sheet panel, toolbar, hover learn mode) and the phone (cheat sheet, tap learn mode).

// ── Cheat sheet ──────────────────────────────────────────────────────────────
// Each entry carries the desktop's wording (label, syntax, description), what the desktop inserts
// (before/after/placeholder) and its learn-progress key, plus `format`, the phone formatting chip it
// inserts (see FORMATS in md-phone.jsx), and the phone's wording (`phone`: name, syntax, note).
// Each group names the phone group it falls under (`phoneGroup`); neighbouring groups may share one.
import { rendererLog, ignore } from '../../log.js'

const log = rendererLog('core', 'markdown')
const e = (label, learnKey, syntax, description, before, after, placeholder, inline, format, phone) =>
  ({ label, learnKey, syntax, description, before, after, placeholder, inline, format, phone: { name: format, ...phone } });

export const MD_CHEAT_GROUPS = [
  { label: 'Text Formatting', phoneGroup: 'Text', items: [
    e('Bold', 'bold', '**text**', 'Make text bold', '**', '**', 'bold text', true, 'Bold', { syntax: '**text**', note: 'Make text bold' }),
    e('Italic', 'italic', '*text*', 'Make text italic', '*', '*', 'italic text', true, 'Italic', { syntax: '*text*', note: 'Make text italic' }),
    e('Strikethrough', 'strikethrough', '~~text~~', 'Strike through text', '~~', '~~', 'strikethrough', true, 'Strikethrough', { syntax: '~~text~~', note: 'Strike through text' }),
    e('Inline Code', 'inline-code', '`code`', 'Inline code or variable names', '`', '`', 'code', true, 'Inline code', { syntax: '`code`', note: 'Code or a variable name' }),
  ] },
  { label: 'Structure', phoneGroup: 'Structure', items: [
    e('H1', 'heading', '# Heading 1', 'Top-level heading', '\n# ', '', 'Heading 1', false, 'Heading 1', { syntax: '# Heading', note: 'Top-level heading' }),
    e('H2', 'heading', '## Heading 2', 'Second-level heading', '\n## ', '', 'Heading 2', false, 'Heading 2', { syntax: '## Heading', note: 'Second-level heading' }),
    e('H3', 'heading', '### Heading 3', 'Third-level heading', '\n### ', '', 'Heading 3', false, 'Heading 3', { syntax: '### Heading', note: 'Third-level heading' }),
    e('Blockquote', 'blockquote', '> text', 'Indented quote block', '\n> ', '', 'blockquote text', false, 'Quote', { syntax: '> quote', note: 'Indented quote block' }),
    e('Horiz. Rule', 'hr', '---', 'Horizontal divider line', '\n---\n', '', '', false, 'Divider', { syntax: '---', note: 'Horizontal line' }),
  ] },
  { label: 'Lists', phoneGroup: 'Lists', items: [
    e('• Bullet List', 'bullet-list', '- item', 'Unordered list item', '\n- ', '', 'list item', false, 'Bullet list', { syntax: '- item', note: 'Unordered list item' }),
    e('1. Numbered', 'numbered-list', '1. item', 'Ordered list item', '\n1. ', '', 'list item', false, 'Numbered list', { syntax: '1. item', note: 'Ordered list item' }),
    e('☐ Task', 'task-list', '- [ ] task', 'Checkbox task item', '\n- [ ] ', '', 'task item', false, 'Task', { syntax: '- [ ] task', note: 'Checkbox item' }),
  ] },
  { label: 'Links & Media', phoneGroup: 'Links, media and code', items: [
    e('Link', 'link', '[text](url)', 'Clickable hyperlink', '[', '](url)', 'link text', true, 'Link', { syntax: '[text](url)', note: 'A clickable link' }),
    e('Image', 'image', '![alt](url)', 'Embedded image', '![', '](image-url)', 'alt text', true, 'Image', { syntax: '![alt](url)', note: 'An embedded image' }),
  ] },
  { label: 'Code', phoneGroup: 'Links, media and code', items: [
    e('Code Block', 'code-block', '```lang\ncode\n```', 'Fenced code block with syntax highlighting', '\n```\n', '\n```\n', 'code here', false, 'Code block', { syntax: '```\ncode\n```', note: 'Fenced block of code' }),
  ] },
  { label: 'Table', phoneGroup: 'Links, media and code', items: [
    e('Table', 'table', '| Col | Col |', '3-column table with header row',
      '\n| Header | Header | Header |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n', '', '', false, 'Table', { syntax: '| a | b |\n| --- | --- |', note: 'A table with a header row' }),
  ] },
];

// The phone's view of the same data: [{ group, items: [{ name, syntax, note, format }] }].
export const CHEAT = MD_CHEAT_GROUPS.reduce((out, g) => {
  const items = g.items.map(i => ({ name: i.phone.name, syntax: i.phone.syntax, note: i.phone.note, format: i.format }));
  const last = out[out.length - 1];
  if (last && last.group === g.phoneGroup) last.items.push(...items); else out.push({ group: g.phoneGroup, items });
  return out;
}, []);

// ── Learn mode ───────────────────────────────────────────────────────────────
// One table of the preview elements that have a Markdown meaning. `sel` is what the desktop annotates
// for hover and `source` the Markdown it shows for that element; `is` is how the phone recognises a
// tapped element, and `name`/`syntax` what it shows. Order matters: the desktop applies the rows in
// turn (a later row wins on the same element); the phone takes the first row that matches.
const txt = (el) => el.textContent.trim();
const tag = (...names) => (el) => names.includes(el.tagName);
const heading = (n) => ({
  is: tag(`H${n}`), sel: `h${n}`, name: `Heading ${n}`, syntax: `${'#'.repeat(n)} Heading`, source: el => `${'#'.repeat(n)} ${txt(el)}`,
});

export const LEARN_ELEMENTS = [
  heading(1), heading(2), heading(3), heading(4), heading(5), heading(6),
  { is: tag('STRONG', 'B'), sel: 'strong', name: 'Bold', syntax: '**text**', source: el => `**${txt(el)}**` },
  { is: tag('EM', 'I'), sel: 'em', name: 'Italic', syntax: '*text*', source: el => `*${txt(el)}*` },
  { is: tag('DEL', 'S'), sel: 'del', name: 'Strikethrough', syntax: '~~text~~', source: el => `~~${txt(el)}~~` },
  // A <code> inside a <pre> is the block, not inline code: the phone walks on up to the <pre>.
  { is: el => el.tagName === 'CODE' && el.parentElement?.tagName !== 'PRE', sel: 'p > code, li > code', name: 'Inline code', syntax: '`code`', source: el => `\`${el.textContent}\`` },
  { is: tag('BLOCKQUOTE'), sel: 'blockquote', name: 'Quote', syntax: '> quote', source: el => `> ${txt(el).split('\n')[0].trim()}` },
  { is: tag('A'), sel: 'a[href]', name: 'Link', syntax: '[text](url)', source: el => `[${txt(el)}](${el.getAttribute('href')})` },
  { is: tag('IMG'), sel: 'img', name: 'Image', syntax: '![alt](url)', source: el => `![${el.alt}](${el.getAttribute('src')})` },
  { is: tag('PRE'), sel: 'pre', name: 'Code block', syntax: '```\ncode\n```', source: el => {
    const lang = el.getAttribute('data-lang') || '';
    const code = el.querySelector('code')?.textContent?.trim() || '';
    return `\`\`\`${lang}\n${code.slice(0, 60)}${code.length > 60 ? '…' : ''}\n\`\`\``;
  } },
  { is: tag('TABLE', 'TH', 'TD'), sel: 'table', name: 'Table', syntax: '| a | b |\n| --- | --- |', source: () => '| Col | Col |\n| --- | --- |' },
  { is: tag('HR'), sel: 'hr', name: 'Divider', syntax: '---', source: () => '---' },
  { is: el => el.tagName === 'LI' && !!el.querySelector(':scope > input[type="checkbox"]'), sel: 'li.task-list-item', name: 'Task', syntax: '- [ ] task', source: el => {
    const checked = el.querySelector('input[type="checkbox"]')?.checked;
    return `- [${checked ? 'x' : ' '}] ${txt(el)}`;
  } },
  { is: tag('UL'), sel: 'ul:not(.contains-task-list)', name: 'Bullet list', syntax: '- item', source: () => '- item\n- item' },
  { is: tag('OL'), sel: 'ol', name: 'Numbered list', syntax: '1. item', source: () => '1. item\n2. item' },
  // Tap only (the desktop annotates the list, not each item).
  { is: el => el.tagName === 'LI' && el.parentElement?.tagName === 'OL', name: 'Numbered list item', syntax: '1. item' },
  { is: tag('LI'), name: 'List item', syntax: '- item' },
];

/** The Markdown the desktop shows on hover for a preview element, or null if it has none. */
export function markdownSourceOf(el) {
  let src = null;
  for (const r of LEARN_ELEMENTS) {
    if (r.sel && el.matches(r.sel)) { try { src = r.source(el); } catch (err) { ignore(log, 'a learn-element source failed; what an earlier row gave is kept', err, 'debug') } }
  }
  return src;
}

// Tapping something in the preview shows the Markdown that made it: walks up from what was tapped to
// the nearest element that has a Markdown meaning.
export function learnTarget(el, root) {
  for (let n = el; n && n !== root; n = n.parentElement) {
    const r = LEARN_ELEMENTS.find(x => x.is(n));
    if (r) return { name: r.name, syntax: r.syntax };
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

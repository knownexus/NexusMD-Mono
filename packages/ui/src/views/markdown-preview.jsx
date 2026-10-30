// markdown-preview.jsx — rendered markdown as the Documents app shows it: sanitized HTML, heading
// anchors, highlighted code and the md-content styles. MarkdownViewer and the Editor app share it.
import React from 'react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { isDarkPalette } from '../themes.js';

const HLJS_SCRIPT = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js";
const HLJS_LIGHT  = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css";
const HLJS_DARK   = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css";

export const MARKDOWN_CONTENT_CSS = `
  .md-content h1, .md-content h2, .md-content h3, .md-content h4, .md-content h5, .md-content h6 {
    margin: 1.5em 0 .5em; line-height: 1.3; font-weight: 700; color: var(--text);
  }
  .md-content h1:first-child, .md-content h2:first-child { margin-top: 0; }
  .md-content h1 { font-size: 1.85em; border-bottom: 2px solid var(--border); padding-bottom: .35em; }
  .md-content h2 { font-size: 1.35em; border-bottom: 1px solid var(--border); padding-bottom: .25em; }
  .md-content h3 { font-size: 1.15em; }
  .md-content h4 { font-size: 1em; }
  .md-content p { margin: .75em 0; }
  .md-content a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  .md-content a:hover { opacity: .8; }
  .md-content ul, .md-content ol { padding-left: 1.6em; margin: .65em 0; }
  .md-content li { margin: .3em 0; }
  .md-content li > ul, .md-content li > ol { margin: .2em 0; }
  .md-content blockquote {
    border-left: 3px solid var(--accent); margin: 1.1em 0;
    padding: .6em 1em .6em 1.1em; background: var(--accent-soft);
    border-radius: 0 var(--radius) var(--radius) 0; color: var(--text-muted);
  }
  .md-content code:not(pre code) {
    background: var(--surface-2); padding: .18em .45em; border-radius: 4px;
    font-family: var(--mono);
    font-size: .855em; color: var(--danger);
  }
  .md-content pre {
    position: relative; margin: 1.1em 0; border-radius: var(--radius);
    overflow: hidden; border: 1px solid var(--border);
  }
  .md-content pre code {
    display: block; padding: 16px 20px;
    font-family: var(--mono);
    font-size: .9em; line-height: 1.65; overflow-x: auto;
  }
  .md-content pre[data-lang]::before {
    content: attr(data-lang); position: absolute; top: 0; right: 0;
    padding: 2px 8px; font-size: 10px; font-family: var(--sans);
    font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
    color: var(--text-subtle); background: rgba(0,0,0,.04);
    border-bottom-left-radius: var(--radius);
  }
  .md-content table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .92em; }
  .md-content th, .md-content td { border: 1px solid var(--border); padding: 8px 13px; text-align: left; }
  .md-content th { background: var(--surface-2); font-weight: 600; }
  .md-content tr:nth-child(even) td { background: var(--surface-2); }
  .md-content img { max-width: 100%; border-radius: var(--radius); display: block; }
  .md-content hr { border: none; border-top: 2px solid var(--border); margin: 1.8em 0; }
  .md-content .task-list-item { list-style: none; margin-left: -1.2em; }
  .md-content .task-list-item input { margin-right: .45em; accent-color: var(--accent); }
`;

// GitHub-style heading anchors, so [text](#some-heading) links work. Kept in a data attribute
// rather than an id, so a heading can't clash with an id elsewhere in the app.
export function slugifyHeading(text) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

export function addHeadingAnchors(container) {
  const seen = new Map();
  container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
    const base = slugifyHeading(h.textContent);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    h.setAttribute('data-anchor', n ? `${base}-${n}` : base);
  });
}

// A click on a link in the preview. Web links open as the app's other links do (the link window
// in the desktop app, a new tab on the web), mailto: in the mail app, and #anchors scroll to their
// heading. Anything else is ignored, so a click can never navigate the app itself away.
export function followPreviewLink(e, container, {
  open = url => window.open(url, '_blank', 'noopener'),
  openExternal = window.electronAPI?.openExternal,
} = {}) {
  const a = e.target.closest?.('a[href]');
  if (!a || !container.contains(a)) return;
  e.preventDefault();
  const href = a.getAttribute('href');
  if (href.startsWith('#')) {
    let anchor = href.slice(1);
    try { anchor = decodeURIComponent(anchor); } catch { /* keep it as written */ }
    const heading = [...container.querySelectorAll('[data-anchor]')]
      .find(h => h.getAttribute('data-anchor') === anchor.toLowerCase());
    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  let url;
  try { url = new URL(href); } catch { return; }
  if (url.protocol === 'http:' || url.protocol === 'https:') open(url.href);
  else if (url.protocol === 'mailto:') (openExternal ?? open)(url.href);
}

// Renders markdown into a preview element: sanitized HTML, heading anchors, and highlighted code
// when highlight.js is loaded.
export function renderPreview(el, markdown, hljs) {
  el.innerHTML = DOMPurify.sanitize(new Marked({ gfm: true }).parse(markdown || ''));
  addHeadingAnchors(el);
  if (!hljs) return;
  el.querySelectorAll('pre code[class*="language-"]').forEach(block => {
    hljs.highlightElement(block);
    const lang = (block.className.match(/language-(\S+)/) || [])[1];
    if (lang) block.closest("pre").setAttribute("data-lang", lang);
  });
}

export function useScript(src) {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    if (document.querySelector(`script[src="${src}"]`)) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, [src]);
  return ready;
}

// Loads highlight.js (once, from the CDN) and keeps its stylesheet matching the app's theme.
// True once it is ready.
export function useHighlightJs() {
  const ready = useScript(HLJS_SCRIPT);
  React.useEffect(() => {
    const getHref = () => isDarkPalette(document.body.dataset.theme) ? HLJS_DARK : HLJS_LIGHT;
    let link = document.getElementById("hljs-theme");
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.id  = "hljs-theme";
      document.head.appendChild(link);
    }
    link.href = getHref();
    const observer = new MutationObserver(() => { link.href = getHref(); });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return ready;
}

// ── Text size ────────────────────────────────────────────────────
// One size, as a percentage, for every rendered markdown view (the Documents panes, the Editor's
// preview), so changing it in one changes them all. It is remembered between sessions.
const TEXT_SIZE_KEY = 'nexusmd.markdown.textSize';
const TEXT_SIZE_EVENT = 'nexusmd-markdown-text-size';
export const TEXT_SIZES = [70, 80, 90, 100, 110, 125, 150, 175, 200];

function readTextSize() {
  try {
    const n = Number(localStorage.getItem(TEXT_SIZE_KEY));
    return TEXT_SIZES.includes(n) ? n : 100;
  } catch { return 100; }
}

// The size one step smaller (dir -1) or larger (dir 1), staying within TEXT_SIZES.
export function stepTextSize(size, dir) {
  const i = TEXT_SIZES.indexOf(size);
  const at = i < 0 ? TEXT_SIZES.indexOf(100) : i;
  return TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, at + dir))];
}

// [size, setSize]: the shared text size, kept in step with every other view showing markdown.
export function useMarkdownTextSize() {
  const [size, setLocal] = React.useState(readTextSize);
  React.useEffect(() => {
    const sync = () => setLocal(readTextSize());
    window.addEventListener(TEXT_SIZE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(TEXT_SIZE_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  const setSize = React.useCallback(next => {
    try { localStorage.setItem(TEXT_SIZE_KEY, String(next)); } catch { /* still changes for this session's views */ }
    setLocal(next);
    window.dispatchEvent(new Event(TEXT_SIZE_EVENT));
  }, []);
  return [size, setSize];
}

const sizeBtnStyle = {
  height: 22, minWidth: 26, padding: "0 6px", fontSize: 12, lineHeight: 1,
  color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)", cursor: "pointer",
};

// A−, the size (click to go back to 100%), A+.
export function TextSizeControls({ size, onChange }) {
  return (
    <div role="group" aria-label="Text size" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button type="button" aria-label="Smaller text" title="Smaller text (Ctrl+scroll)" style={sizeBtnStyle}
        disabled={size === TEXT_SIZES[0]} onClick={() => onChange(stepTextSize(size, -1))}>A−</button>
      <button type="button" aria-label="Reset text size" title="Back to 100%" style={{ ...sizeBtnStyle, minWidth: 44, color: "var(--text-muted)" }}
        onClick={() => onChange(100)}>{size}%</button>
      <button type="button" aria-label="Larger text" title="Larger text (Ctrl+scroll)" style={sizeBtnStyle}
        disabled={size === TEXT_SIZES[TEXT_SIZES.length - 1]} onClick={() => onChange(stepTextSize(size, 1))}>A+</button>
    </div>
  );
}

const NO_ELEMENT = { current: null };

// Ctrl+scroll (pinch on a trackpad) over the element changes the text size instead of zooming the page.
export function useCtrlWheelTextSize(ref, size, setSize) {
  const latest = React.useRef(size);
  latest.current = size;
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = e => {
      if (!e.ctrlKey || !e.deltaY) return;
      e.preventDefault();
      setSize(stepTextSize(latest.current, e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, setSize]);
}

// Markdown, rendered. Code is highlighted once highlight.js has loaded; until then it shows plain.
// The text is at the shared text size, which Ctrl+scroll over it changes (ctrlWheel false leaves
// that to the page, e.g. to take it over the whole pane around the preview).
export function MarkdownPreview({ markdown, className = '', style, ctrlWheel = true, ...rest }) {
  const ref = React.useRef(null);
  const hljsReady = useHighlightJs();
  const [textSize, setTextSize] = useMarkdownTextSize();
  useCtrlWheelTextSize(ctrlWheel ? ref : NO_ELEMENT, textSize, setTextSize);
  React.useEffect(() => {
    if (ref.current) renderPreview(ref.current, markdown, hljsReady ? window.hljs : null);
  }, [markdown, hljsReady]);
  return (
    <>
      <style>{MARKDOWN_CONTENT_CSS}</style>
      <div
        {...rest}
        ref={ref}
        className={`md-content${className ? ` ${className}` : ''}`}
        onClick={e => followPreviewLink(e, e.currentTarget)}
        style={{ lineHeight: 1.8, color: "var(--text)", fontSize: `${textSize}%`, ...style }}
      />
    </>
  );
}

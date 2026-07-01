import DOMPurify from 'dompurify'
import { marked } from 'marked'

export function sanitizeHtml(html) {
  return DOMPurify.sanitize(html || '')
}

export function mdToHtml(text) {
  return sanitizeHtml(marked.parse(text || ''))
}

// Matches tags that indicate real rich-text formatting — content should be
// rendered as sanitized HTML, not stripped and re-parsed as markdown.
const FORMATTING_TAG_RE = /<(b|strong|i|em|u|s|del|ul|ol|li|table|thead|tbody|tr|td|th|pre|code|h[1-6])\b|<a\s[^>]*href/i

// Tags that are safe to strip: ADO wraps plain text in these automatically.
const STRUCTURAL_RE = /<\/?(div|p|span|section|article|header|footer|main|nav|aside)[^>]*>/gi

export function isOnlyStructural(html) {
  if (!html) return true
  if (FORMATTING_TAG_RE.test(html)) return false
  // Strip known structural tags and br; if any opening tag remains it's unknown HTML
  const stripped = html
    .replace(STRUCTURAL_RE, '')
    .replace(/<br\s*\/?>/gi, '')
  return !/<[a-zA-Z]/.test(stripped)
}

export function stripStructural(html) {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .trim()
}

export function renderContent(value) {
  if (!value || !value.trim()) {
    return '<em style="color:var(--text-subtle)">Not set</em>'
  }
  if (isOnlyStructural(value)) {
    return mdToHtml(stripStructural(value))
  }
  return sanitizeHtml(value)
}

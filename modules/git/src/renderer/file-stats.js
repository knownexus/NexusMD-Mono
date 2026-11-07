import { languageForPath, languageLabel } from '@nexusmd/editor-kit/languages.js'

const encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null

/** "14 B", "1.5 KB", "5.0 MB". */
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * What a file's status footer says: its language (by extension), line count (a final newline doesn't add
 * one), size in bytes, line endings (LF, CRLF, Mixed or None) and encoding (files are read as UTF-8).
 */
export function fileStats(text, path) {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  const eol = crlf && lf ? 'Mixed' : crlf ? 'CRLF' : lf ? 'LF' : 'None'
  const breaks = crlf + lf
  const lines = text === '' ? 0 : breaks + (/[\r\n]$/.test(text) ? 0 : 1)
  const bytes = encoder ? encoder.encode(text).length : text.length
  return { language: languageLabel(languageForPath(path)) ?? 'Plain text', lines, bytes, eol, encoding: 'UTF-8' }
}

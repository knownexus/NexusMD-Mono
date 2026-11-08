// The languages NexusMD colours code in (the file editor, diffs, conflict sides), by file extension.
import { StreamLanguage } from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { sql } from '@codemirror/lang-sql'
import { markdown } from '@codemirror/lang-markdown'
import { javascript } from '@codemirror/lang-javascript'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { php } from '@codemirror/lang-php'
import { csharp, java, c, cpp } from '@codemirror/legacy-modes/mode/clike'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { xml } from '@codemirror/legacy-modes/mode/xml'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { python } from '@codemirror/legacy-modes/mode/python'
import { go } from '@codemirror/legacy-modes/mode/go'
import { rust } from '@codemirror/legacy-modes/mode/rust'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { properties } from '@codemirror/legacy-modes/mode/properties'

const LANGUAGES = {
  json: () => json(),
  yaml: () => yaml(),
  sql: () => sql(),
  markdown: () => markdown(),
  powershell: () => StreamLanguage.define(powerShell),
  javascript: () => javascript({ jsx: true }),
  typescript: () => javascript({ jsx: true, typescript: true }),
  css: () => css(),
  html: () => html(),
  csharp: () => StreamLanguage.define(csharp),
  xml: () => StreamLanguage.define(xml),
  shell: () => StreamLanguage.define(shell),
  python: () => StreamLanguage.define(python),
  java: () => StreamLanguage.define(java),
  c: () => StreamLanguage.define(c),
  cpp: () => StreamLanguage.define(cpp),
  go: () => StreamLanguage.define(go),
  rust: () => StreamLanguage.define(rust),
  ruby: () => StreamLanguage.define(ruby),
  php: () => php(),
  toml: () => StreamLanguage.define(toml),
  ini: () => StreamLanguage.define(properties), // INI and .properties files read alike: [section] headers, key = value, # or ; comments
}
const EXTENSIONS = {
  javascript: ['js', 'mjs', 'cjs', 'jsx'], typescript: ['ts', 'tsx', 'mts', 'cts'], css: ['css', 'scss', 'less'],
  html: ['html', 'htm'], csharp: ['cs', 'csx'], json: ['json'], yaml: ['yml', 'yaml'], sql: ['sql'],
  markdown: ['md', 'markdown'], powershell: ['ps1', 'psm1', 'psd1'],
  xml: ['xml', 'xsd', 'xsl', 'xslt', 'svg', 'csproj', 'props', 'plist'], shell: ['sh', 'bash', 'zsh'], python: ['py', 'pyw'], java: ['java'],
  c: ['c', 'h'], cpp: ['cpp', 'cc', 'cxx', 'hpp', 'hh'], go: ['go'], rust: ['rs'], ruby: ['rb'], php: ['php'], toml: ['toml'],
  ini: ['ini', 'conf', 'cfg', 'properties'],
}
const BY_EXTENSION = new Map(Object.entries(EXTENSIONS).flatMap(([name, exts]) => exts.map(e => [e, name])))

// Highlighting language for a file path, or null for plain text.
export function languageForPath(path) {
  const base = String(path ?? '').split(/[\\/]/).pop()
  const dot = base.lastIndexOf('.')
  return dot < 0 ? null : BY_EXTENSION.get(base.slice(dot + 1).toLowerCase()) ?? null
}

const LABELS = {
  json: 'JSON', yaml: 'YAML', sql: 'SQL', markdown: 'Markdown', powershell: 'PowerShell', javascript: 'JavaScript',
  typescript: 'TypeScript', css: 'CSS', html: 'HTML', csharp: 'C#',
  xml: 'XML', shell: 'Shell', python: 'Python', java: 'Java', c: 'C', cpp: 'C++', go: 'Go', rust: 'Rust', ruby: 'Ruby', php: 'PHP', toml: 'TOML', ini: 'INI',
}
// A language's display name (the diff header's tag), or null for plain text.
export const languageLabel = name => LABELS[name] ?? null

// The CodeMirror extension for a language name, or nothing for plain text.
export const languageExtension = name => LANGUAGES[name]?.() ?? []

const parsers = new Map()
// The language's parser (made once per language), or null for plain text.
export function parserFor(name) {
  if (!LANGUAGES[name]) return null
  if (!parsers.has(name)) {
    const ext = LANGUAGES[name]()
    parsers.set(name, (ext.language ?? ext).parser)
  }
  return parsers.get(name)
}

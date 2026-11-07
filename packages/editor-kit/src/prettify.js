// Prettify: tidies a file's layout when the person asks. Nothing here runs on open or save.
//
// The formatters (Prettier, sql-formatter, xml-formatter) are large, so each is loaded with a dynamic import() the first time a
// file of its kind is tidied, never at app start. A file with a syntax error is refused and left as it was, with the reason.

import { rendererLog, ignore } from '@nexusmd/core'

const log = rendererLog('editor', 'prettify')

const MAX_CHARS = 1_000_000 // above this a phone would freeze while formatting
const MESSAGE_LIMIT = 160

// How each file extension is tidied: `kind` picks the formatter, `parser` the Prettier parser.
const BY_EXTENSION = new Map([
  // json-stringify, not json: the same two-space layout as the JSON editor, every object opened out, and number text kept exactly.
  ['json', { kind: 'prettier', parser: 'json-stringify' }],
  ...['js', 'mjs', 'cjs', 'jsx'].map(e => [e, { kind: 'prettier', parser: 'babel' }]),
  ...['ts', 'tsx', 'mts', 'cts'].map(e => [e, { kind: 'prettier', parser: 'typescript' }]),
  ...['html', 'htm'].map(e => [e, { kind: 'prettier', parser: 'html' }]),
  ['css', { kind: 'prettier', parser: 'css' }], ['scss', { kind: 'prettier', parser: 'scss' }], ['less', { kind: 'prettier', parser: 'less' }],
  ...['yml', 'yaml'].map(e => [e, { kind: 'prettier', parser: 'yaml' }]),
  ...['xml', 'xsd', 'xsl', 'xslt', 'svg', 'csproj', 'props', 'plist'].map(e => [e, { kind: 'xml' }]),
  ['sql', { kind: 'sql' }],
])

const formatterFor = (path) => {
  const base = String(path ?? '').split(/[\\/]/).pop()
  const dot = base.lastIndexOf('.')
  return dot < 0 ? null : BY_EXTENSION.get(base.slice(dot + 1).toLowerCase()) ?? null
}

/** True when Prettify can tidy this file: JSON, JavaScript, TypeScript, HTML, CSS, YAML, XML and SQL files. */
export const canPrettify = (path) => formatterFor(path) !== null

const esm = (m) => m.default ?? m // a module's default export when it has one (the CommonJS builds), else the module itself

// Prettier's plugins each parse some languages; the standalone build only knows the ones it is given.
const PRETTIER_PLUGINS = {
  'json-stringify': ['babel', 'estree'], babel: ['babel', 'estree'], typescript: ['typescript', 'estree'],
  html: ['html'], css: ['postcss'], scss: ['postcss'], less: ['postcss'], yaml: ['yaml'],
}
const loadPlugin = (name) => ({
  babel: () => import('prettier/plugins/babel'), estree: () => import('prettier/plugins/estree'),
  typescript: () => import('prettier/plugins/typescript'), html: () => import('prettier/plugins/html'),
  postcss: () => import('prettier/plugins/postcss'), yaml: () => import('prettier/plugins/yaml'),
})[name]().then(esm)

async function withPrettier(parser, text) {
  const [prettier, ...plugins] = await Promise.all([import('prettier/standalone'), ...PRETTIER_PLUGINS[parser].map(loadPlugin)])
  return esm(prettier).format(text, { parser, plugins, tabWidth: 2, endOfLine: 'lf' })
}

// xml-formatter repairs some broken XML silently (a missing end tag is closed for you), which would change the file's meaning.
// So the file is checked as XML first, by the browser's own parser, and refused if it is not well formed.
function assertWellFormedXml(text) {
  if (typeof DOMParser === 'undefined') return
  const error = new DOMParser().parseFromString(text, 'application/xml').getElementsByTagName('parsererror')[0]
  if (error) throw new Error(error.textContent)
}

async function withXml(text) {
  assertWellFormedXml(text)
  const format = esm(await import('xml-formatter'))
  return format(text, { indentation: '  ', lineSeparator: '\n', collapseContent: true })
}

async function withSql(text) {
  const { format } = esm(await import('sql-formatter'))
  return format(text, { tabWidth: 2, keywordCase: 'preserve' })
}

// The first line of an error, kept short enough for one line of the screen.
const oneLine = (error) => {
  const line = String(error?.message ?? error ?? '').split('\n').map(l => l.trim()).find(Boolean) || 'the file could not be read'
  return line.length > MESSAGE_LIMIT ? line.slice(0, MESSAGE_LIMIT) : line
}

/**
 * Tidies a file's text for its type.
 * @param {string} path the file's name or path (its extension picks the formatter)
 * @param {string} text
 * @returns {Promise<{ ok: true, text: string } | { ok: false, message: string }>}
 */
export async function prettify(path, text) {
  const formatter = formatterFor(path)
  if (!formatter) return { ok: false, message: 'This file type cannot be tidied.' }
  if (text.length > MAX_CHARS) return { ok: false, message: 'This file is too large to tidy here (the limit is 1 MB).' }
  if (text === '') return { ok: true, text: '' }
  try {
    const tidy = formatter.kind === 'prettier' ? await withPrettier(formatter.parser, text) : formatter.kind === 'xml' ? await withXml(text) : await withSql(text)
    return { ok: true, text: tidy }
  } catch (error) {
    ignore(log, 'a file that cannot be tidied is refused and left as it was, with the reason shown to the person', error, 'debug')
    return { ok: false, message: `Could not tidy: ${oneLine(error)}` }
  }
}

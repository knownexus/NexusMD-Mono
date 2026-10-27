// One-way importer: a Bruno collection folder -> our { tree, requests, environments } shape.
//
// A Bruno collection is a directory on disk:
//   <dir>/bruno.json               { name, ... }
//   <dir>/collection.bru           collection-level settings (not imported)
//   <dir>/<sub>/folder.bru         optional folder meta (display name, seq)
//   <dir>/**/<name>.bru            one file per request
//   <dir>/environments/<name>.bru  one file per environment
//
// Same spirit as postman-import.js: best-effort, with anything that can't be
// confidently converted reported in `warnings` rather than failing outright.
// A real collection trips the same few problems on hundreds of requests, so
// warnings are grouped: one line per kind of problem, with a count and a few
// example names, never one line per request.
//
// Auth set to "inherit" and headers are resolved the way Bruno does: from the
// nearest folder.bru that sets them, then collection.bru.

const TEXT_BLOCK = /^(body:(?!form-urlencoded$|multipart-form$).+|script:.+|tests|docs)$/
const SKIP_FILES = new Set(['collection.bru', 'folder.bru'])
const ENVIRONMENTS_DIR = 'environments'

const join = (...parts) => parts.join('/')
const bruFiles = (names) => [...new Set(names)].filter(n => n.endsWith('.bru'))

function parseDictLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return null
  const enabled = !trimmed.startsWith('~')
  const body = enabled ? trimmed : trimmed.slice(1)
  const colon = body.indexOf(':')
  if (colon === -1) return null
  return { key: body.slice(0, colon).trim(), value: body.slice(colon + 1).trim(), enabled }
}

/**
 * Parses a .bru file into { blockName: value }. Dictionary blocks become
 * [{ key, value, enabled }] (`~key` = disabled), list blocks (`name [ ... ]`)
 * become string arrays, and text blocks (bodies, scripts, tests, docs) keep
 * their content verbatim minus the two-space indent Bruno writes them with.
 */
export function parseBru(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const blocks = {}
  let i = 0
  while (i < lines.length) {
    const header = lines[i].match(/^([\w:-]+)\s*([{[])\s*$/)
    i += 1
    if (!header) continue
    const [, name, open] = header
    const close = open === '{' ? '}' : ']'
    const content = []
    while (i < lines.length && lines[i].trimEnd() !== close) content.push(lines[i++])
    i += 1

    if (open === '[') {
      blocks[name] = content.map(l => l.trim().replace(/,$/, '')).filter(Boolean)
    } else if (TEXT_BLOCK.test(name)) {
      blocks[name] = content.map(l => (l.startsWith('  ') ? l.slice(2) : l)).join('\n').trim()
    } else {
      blocks[name] = content.map(parseDictLine).filter(Boolean)
    }
  }
  return blocks
}

const dictGet = (entries, key) => (entries || []).find(e => e.key === key)?.value

function enabledObject(entries) {
  const out = {}
  for (const e of entries || []) if (e.enabled) out[e.key] = e.value
  return out
}

const enabledPairs = (entries) => (entries || []).filter(e => e.enabled).map(({ key, value }) => ({ key, value }))

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
const SCRIPT_BLOCKS = ['script:pre-request', 'script:post-response', 'tests']
const EXAMPLE_NAMES = 5

const WARNING_TEXT = {
  scripts:        'Scripts and tests were not imported: they run arbitrary code, and they use Bruno\'s bru/res/expect API, which this client doesn\'t provide',
  folderScripts:  'Collection- and folder-level scripts were not imported (same reason as request scripts)',
  pathParams:     'Path params (:name) were not converted; replace them with {{vars}} or literal values',
  multipartFiles: 'Multipart file fields were imported as their file path text; re-attach the files manually',
  graphqlBody:    'GraphQL bodies were imported as raw text; wrap them as a JSON { "query": ... } body before running',
  graphqlRequest: 'GraphQL requests aren\'t natively supported; imported as plain HTTP requests',
  oauth2:         'OAuth2 auth was imported as an empty access-token placeholder; reconfigure it manually',
}

/** Collects (kind, name) problems and renders one summary line per kind. */
function makeWarnings() {
  const byKind = new Map()
  return {
    add(kind, name, text = WARNING_TEXT[kind]) {
      if (!byKind.has(kind)) byKind.set(kind, { text, names: [] })
      byKind.get(kind).names.push(name)
    },
    lines() {
      return [...byKind.values()].map(({ text, names }) => {
        const unique = [...new Set(names)]
        const shown = unique.slice(0, EXAMPLE_NAMES).map(n => `"${n}"`).join(', ')
        const more = unique.length > EXAMPLE_NAMES ? ` and ${unique.length - EXAMPLE_NAMES} more` : ''
        return `${text} (${names.length} affected: ${shown}${more})`
      })
    },
  }
}

const ROOT_INHERITED = { auth: { mode: 'none', blocks: {} }, headers: {} }

/** What a folder (or the collection) passes down: its auth if it sets one, and its headers on top of its parent's. */
function inheritFrom(parent, blocks) {
  const mode = dictGet(blocks.auth, 'mode')
  return {
    auth:    mode && mode !== 'inherit' ? { mode, blocks } : parent.auth,
    headers: { ...parent.headers, ...enabledObject(blocks.headers) },
  }
}

function mapBody(blocks, mode, warnings, name) {
  switch (mode) {
    case undefined:
    case 'none':
      return { bodyType: 'none', bodyLanguage: 'json', body: '' }
    case 'json':
    case 'text':
    case 'xml':
      return { bodyType: 'raw', bodyLanguage: mode, body: blocks[`body:${mode}`] ?? '' }
    case 'formUrlEncoded':
      return { bodyType: 'urlencoded', bodyLanguage: 'json', body: enabledPairs(blocks['body:form-urlencoded']) }
    case 'multipartForm': {
      const pairs = enabledPairs(blocks['body:multipart-form'])
      if (pairs.some(p => p.value.startsWith('@file('))) warnings.add('multipartFiles', name)
      return { bodyType: 'formdata', bodyLanguage: 'json', body: pairs }
    }
    case 'graphql':
      warnings.add('graphqlBody', name)
      return { bodyType: 'raw', bodyLanguage: 'text', body: blocks['body:graphql'] ?? '' }
    default:
      warnings.add(`body:${mode}`, name, `Unsupported body mode "${mode}"; left empty`)
      return { bodyType: 'none', bodyLanguage: 'json', body: '' }
  }
}

function mapAuth(blocks, mode, warnings, name) {
  switch (mode) {
    case undefined:
    case 'none':
    case 'inherit': // only reached when nothing up the tree sets auth
      return { type: 'none' }
    case 'bearer':
      return { type: 'bearer', token: dictGet(blocks['auth:bearer'], 'token') || '' }
    case 'basic':
      return {
        type:     'basic',
        username: dictGet(blocks['auth:basic'], 'username') || '',
        password: dictGet(blocks['auth:basic'], 'password') || '',
      }
    case 'apikey': {
      const b = blocks['auth:apikey']
      return {
        type:  'apikey',
        key:   dictGet(b, 'key') || '',
        value: dictGet(b, 'value') || '',
        in:    dictGet(b, 'placement') === 'queryparams' ? 'query' : 'header',
      }
    }
    case 'oauth2':
      warnings.add('oauth2', name)
      return { type: 'oauth2', accessToken: '' }
    default:
      warnings.add(`auth:${mode}`, name, `Unsupported auth type "${mode}"; set to none`)
      return { type: 'none' }
  }
}

function convertRequest(blocks, fallbackName, warnings, inherited) {
  const name = dictGet(blocks.meta, 'name') || fallbackName
  if (dictGet(blocks.meta, 'type') === 'graphql') warnings.add('graphqlRequest', name)

  const method = HTTP_METHODS.find(m => blocks[m]) || 'get'
  const http = blocks[method]
  let url = dictGet(http, 'url') || ''
  const params = enabledObject(blocks['params:query'])
  // Bruno writes the query string into the URL *and* params:query; the
  // request builder appends params to the URL, so keep only one copy.
  if (blocks['params:query'] && url.includes('?')) url = url.slice(0, url.indexOf('?'))

  if (blocks['params:path']?.length) warnings.add('pathParams', name)

  // Scripts run arbitrary code and the collection may come from someone else,
  // so — as with the Postman importer — they're never copied into an
  // executable field; we only flag that one existed.
  if (SCRIPT_BLOCKS.some(b => blocks[b])) warnings.add('scripts', name)

  const authMode = dictGet(http, 'auth')
  const auth = authMode === 'inherit'
    ? mapAuth(inherited.auth.blocks, inherited.auth.mode, warnings, name)
    : mapAuth(blocks, authMode, warnings, name)

  return {
    name,
    seq: Number(dictGet(blocks.meta, 'seq')) || 0,
    request: {
      method:  method.toUpperCase(),
      url,
      params,
      headers: { ...inherited.headers, ...enabledObject(blocks.headers) },
      ...mapBody(blocks, dictGet(http, 'body'), warnings, name),
      auth,
      preRequestScript:   '',
      postResponseScript: '',
      tests:              '',
    },
  }
}

function convertEnvironment(blocks) {
  const variables = {}
  for (const e of blocks.vars || []) if (e.enabled) variables[e.key] = { value: e.value }
  for (const key of blocks['vars:secret'] || []) {
    if (!key.startsWith('~')) variables[key] = { secret: true }
  }
  return { variables }
}

/**
 * Reads the Bruno collection at `dir` through the file adapter (which must
 * implement listDirs). `idPrefix` namespaces the generated refIds so a second
 * import into the same collection can't overwrite the first one's requests.
 */
export async function importBrunoCollection(file, dir, { idPrefix = `bruno-${Date.now()}` } = {}) {
  let config
  try {
    config = JSON.parse(await file.read(join(dir, 'bruno.json')))
  } catch {
    throw new Error(`Not a Bruno collection: no readable bruno.json in ${dir}`)
  }

  const warnings = makeWarnings()
  const requests = {}
  let counter = 0

  // collection.bru and folder.bru are optional; a missing one just inherits.
  async function readSettings(path, label) {
    let blocks
    try { blocks = parseBru(await file.read(path)) } catch { return {} }
    if (SCRIPT_BLOCKS.some(b => blocks[b])) warnings.add('folderScripts', label)
    return blocks
  }

  async function walk(folderDir, isRoot, inherited) {
    const folders = []
    for (const sub of (await file.listDirs(folderDir)).sort()) {
      if (isRoot && sub === ENVIRONMENTS_DIR) continue
      if (sub.startsWith('.') || sub === 'node_modules') continue
      const subDir = join(folderDir, sub)
      const folderBlocks = await readSettings(join(subDir, 'folder.bru'), sub)
      const children = await walk(subDir, false, inheritFrom(inherited, folderBlocks))
      if (!children.length) continue // tooling/asset folders with no requests
      folders.push({
        dir:  sub,
        seq:  Number(dictGet(folderBlocks.meta, 'seq')) || null,
        node: { type: 'folder', name: dictGet(folderBlocks.meta, 'name') || sub, children },
      })
    }
    // seq only orders folders when every one at this level has it; otherwise
    // the directory names (often numbered, like 01-auth) are the order.
    if (folders.every(f => f.seq !== null)) folders.sort((a, b) => a.seq - b.seq)
    else folders.sort((a, b) => a.dir.localeCompare(b.dir))

    const items = []
    for (const fileName of bruFiles(await file.list(folderDir)).sort()) {
      if (SKIP_FILES.has(fileName)) continue
      const blocks = parseBru(await file.read(join(folderDir, fileName)))
      const { name, seq, request } = convertRequest(blocks, fileName.slice(0, -4), warnings, inherited)
      counter += 1
      const refId = `${idPrefix}-${counter}`
      requests[refId] = request
      items.push({ seq, node: { type: 'request', name, refId } })
    }

    const bySeq = (a, b) => a.seq - b.seq
    return [...folders, ...items.sort(bySeq)].map(x => x.node)
  }

  const collectionBlocks = await readSettings(join(dir, 'collection.bru'), config?.name || 'collection')
  const tree = await walk(dir, true, inheritFrom(ROOT_INHERITED, collectionBlocks))

  const environments = {}
  for (const fileName of bruFiles(await file.list(join(dir, ENVIRONMENTS_DIR)))) {
    environments[fileName.slice(0, -4)] = convertEnvironment(parseBru(await file.read(join(dir, ENVIRONMENTS_DIR, fileName))))
  }

  return {
    meta: { name: config?.name || 'Imported collection', description: '' },
    tree,
    requests,
    environments,
    warnings: warnings.lines(),
  }
}

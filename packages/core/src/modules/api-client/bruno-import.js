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
// confidently converted pushed to `warnings` rather than failing outright.

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
      if (pairs.some(p => p.value.startsWith('@file('))) {
        warnings.push(`"${name}": multipart file fields were imported as their file path text — re-attach the files manually`)
      }
      return { bodyType: 'formdata', bodyLanguage: 'json', body: pairs }
    }
    case 'graphql':
      warnings.push(`"${name}": GraphQL body imported as raw text — wrap it as a JSON { "query": ... } body before running`)
      return { bodyType: 'raw', bodyLanguage: 'text', body: blocks['body:graphql'] ?? '' }
    default:
      warnings.push(`"${name}": unsupported body mode "${mode}" — left empty`)
      return { bodyType: 'none', bodyLanguage: 'json', body: '' }
  }
}

function mapAuth(blocks, mode, warnings, name) {
  switch (mode) {
    case undefined:
    case 'none':
      return { type: 'none' }
    case 'inherit':
      warnings.push(`"${name}": auth was set to inherit from the collection/folder — set it on the request manually`)
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
      warnings.push(`"${name}": OAuth2 auth imported as an empty access-token placeholder — reconfigure manually`)
      return { type: 'oauth2', accessToken: '' }
    default:
      warnings.push(`"${name}": unsupported auth type "${mode}" — set to none`)
      return { type: 'none' }
  }
}

function convertRequest(blocks, fallbackName, warnings) {
  const name = dictGet(blocks.meta, 'name') || fallbackName
  if (dictGet(blocks.meta, 'type') === 'graphql') {
    warnings.push(`"${name}": GraphQL requests aren't natively supported — imported as a plain HTTP request`)
  }

  const method = HTTP_METHODS.find(m => blocks[m]) || 'get'
  const http = blocks[method]
  let url = dictGet(http, 'url') || ''
  const params = enabledObject(blocks['params:query'])
  // Bruno writes the query string into the URL *and* params:query; the
  // request builder appends params to the URL, so keep only one copy.
  if (blocks['params:query'] && url.includes('?')) url = url.slice(0, url.indexOf('?'))

  if (blocks['params:path']?.length) {
    warnings.push(`"${name}": path params (:name) were not converted — replace them with {{vars}} or literal values`)
  }

  // Scripts run arbitrary code and the collection may come from someone else,
  // so — as with the Postman importer — they're never copied into an
  // executable field; we only flag that one existed.
  for (const [block, label] of [['script:pre-request', 'pre-request script'], ['script:post-response', 'post-response script'], ['tests', 'tests']]) {
    if (blocks[block]) {
      warnings.push(`"${name}": ${label} was not imported (scripts run arbitrary code) — review the source collection and add it manually if you trust it`)
    }
  }

  return {
    name,
    seq: Number(dictGet(blocks.meta, 'seq')) || 0,
    request: {
      method:  method.toUpperCase(),
      url,
      params,
      headers: enabledObject(blocks.headers),
      ...mapBody(blocks, dictGet(http, 'body'), warnings, name),
      auth:    mapAuth(blocks, dictGet(http, 'auth'), warnings, name),
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

  const warnings = []
  const requests = {}
  let counter = 0

  async function walk(folderDir, isRoot) {
    const folders = []
    for (const sub of (await file.listDirs(folderDir)).sort()) {
      if (isRoot && sub === ENVIRONMENTS_DIR) continue
      if (sub.startsWith('.') || sub === 'node_modules') continue
      const subDir = join(folderDir, sub)
      let folderMeta = {}
      try { folderMeta = parseBru(await file.read(join(subDir, 'folder.bru'))) } catch { /* folder.bru is optional */ }
      folders.push({
        seq:  Number(dictGet(folderMeta.meta, 'seq')) || 0,
        node: { type: 'folder', name: dictGet(folderMeta.meta, 'name') || sub, children: await walk(subDir, false) },
      })
    }

    const items = []
    for (const fileName of bruFiles(await file.list(folderDir)).sort()) {
      if (SKIP_FILES.has(fileName)) continue
      const { name, seq, request } = convertRequest(parseBru(await file.read(join(folderDir, fileName))), fileName.slice(0, -4), warnings)
      counter += 1
      const refId = `${idPrefix}-${counter}`
      requests[refId] = request
      items.push({ seq, node: { type: 'request', name, refId } })
    }

    const bySeq = (a, b) => a.seq - b.seq
    return [...folders.sort(bySeq), ...items.sort(bySeq)].map(x => x.node)
  }

  const tree = await walk(dir, true)

  const environments = {}
  for (const fileName of bruFiles(await file.list(join(dir, ENVIRONMENTS_DIR)))) {
    environments[fileName.slice(0, -4)] = convertEnvironment(parseBru(await file.read(join(dir, ENVIRONMENTS_DIR, fileName))))
  }

  return {
    meta: { name: config?.name || 'Imported collection', description: '' },
    tree,
    requests,
    environments,
    warnings,
  }
}

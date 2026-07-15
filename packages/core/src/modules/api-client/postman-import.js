// One-way importer: Postman v2.1 collection.json -> our { tree, requests } shape.
// Best-effort — anything that can't be confidently converted (scripts using the
// pm.* API, unsupported body/auth modes) is still imported where possible, with
// a warning pushed to the returned `warnings` list rather than failing outright.

function extractUrl(url) {
  if (typeof url === 'string') return url
  return url?.raw || ''
}

function mapHeaders(headerArr) {
  const headers = {}
  for (const h of headerArr || []) {
    if (h.disabled) continue
    headers[h.key] = h.value ?? ''
  }
  return headers
}

function mapParams(queryArr) {
  const params = {}
  for (const q of queryArr || []) {
    if (q.disabled) continue
    params[q.key] = q.value ?? ''
  }
  return params
}

function mapBody(body, warnings, name) {
  if (!body || !body.mode) return undefined
  switch (body.mode) {
    case 'raw':
      return body.raw ?? ''
    case 'urlencoded':
      return (body.urlencoded || [])
        .filter(p => !p.disabled)
        .map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value ?? '')}`)
        .join('&')
    case 'formdata':
      warnings.push(`"${name}": multipart form-data body imported as a JSON description — review before running`)
      return JSON.stringify((body.formdata || []).map(p => ({ key: p.key, value: p.value, type: p.type })))
    default:
      warnings.push(`"${name}": unsupported body mode "${body.mode}" — left empty`)
      return undefined
  }
}

function mapAuth(auth, warnings, name) {
  if (!auth || auth.type === 'noauth') return { type: 'none' }
  const get = (arr, key) => (arr || []).find(x => x.key === key)?.value
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', token: get(auth.bearer, 'token') || '' }
    case 'basic':
      return { type: 'basic', username: get(auth.basic, 'username') || '', password: get(auth.basic, 'password') || '' }
    case 'apikey':
      return {
        type:  'apikey',
        key:   get(auth.apikey, 'key') || '',
        value: get(auth.apikey, 'value') || '',
        in:    get(auth.apikey, 'in') || 'header',
      }
    case 'oauth2':
      warnings.push(`"${name}": OAuth2 auth imported as a static access-token placeholder — reconfigure manually`)
      return { type: 'oauth2', accessToken: get(auth.oauth2, 'accessToken') || '' }
    default:
      warnings.push(`"${name}": unsupported auth type "${auth.type}" — set to none`)
      return { type: 'none' }
  }
}

function mapScript(events, listen) {
  const exec = (events || []).find(e => e.listen === listen)?.script?.exec
  if (!exec) return undefined
  return Array.isArray(exec) ? exec.join('\n') : String(exec)
}

export function importPostmanCollection(json) {
  const warnings = []
  const requests = {}
  let counter = 0

  function convertItem(item) {
    if (Array.isArray(item.item)) {
      return { type: 'folder', name: item.name || 'Folder', children: item.item.map(convertItem) }
    }

    counter += 1
    const refId = `postman-${counter}`
    const req = item.request || {}

    // Scripts run arbitrary code (see api-client-script.cjs's security notes),
    // and an imported collection.json may come from someone else entirely —
    // so scripts are deliberately NOT auto-imported into an executable field.
    // We only surface that one existed, so the user can review and re-add it
    // themselves if they trust it.
    if (mapScript(item.event, 'prerequest')) {
      warnings.push(`"${item.name}": pre-request script was not imported (scripts run arbitrary code) — review the source collection and add it manually if you trust it`)
    }
    if (mapScript(item.event, 'test')) {
      warnings.push(`"${item.name}": test script was not imported (scripts run arbitrary code) — review the source collection and add it manually if you trust it`)
    }

    requests[refId] = {
      method:  (req.method || 'GET').toUpperCase(),
      url:     extractUrl(req.url),
      params:  mapParams(req.url?.query),
      headers: mapHeaders(req.header),
      body:    mapBody(req.body, warnings, item.name),
      auth:    mapAuth(req.auth, warnings, item.name),
      preRequestScript: undefined,
      tests: undefined,
    }

    return { type: 'request', name: item.name || refId, refId }
  }

  const tree = (json?.item || []).map(convertItem)

  return {
    meta: { name: json?.info?.name || 'Imported collection', description: json?.info?.description || '' },
    tree,
    requests,
    warnings,
  }
}

import { resolveObjectVars } from './var-resolve.js'

function toBase64(str) {
  if (typeof btoa === 'function') return btoa(str)
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf-8').toString('base64')
  throw new Error('No base64 encoder available in this environment')
}

function buildUrl(url, params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (!entries.length) return url
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  return url + (url.includes('?') ? '&' : '?') + qs
}

/** Applies an auth block on top of already-resolved headers/params. */
function applyAuth(headers, params, auth) {
  if (!auth || auth.type === 'none' || !auth.type) return { headers, params }
  const nextHeaders = { ...headers }
  const nextParams = { ...params }
  switch (auth.type) {
    case 'bearer':
      nextHeaders.Authorization = `Bearer ${auth.token || ''}`
      break
    case 'basic':
      nextHeaders.Authorization = `Basic ${toBase64(`${auth.username || ''}:${auth.password || ''}`)}`
      break
    case 'apikey':
      if (auth.in === 'query') nextParams[auth.key] = auth.value
      else nextHeaders[auth.key] = auth.value
      break
    case 'oauth2':
      nextHeaders.Authorization = `Bearer ${auth.accessToken || ''}`
      break
    default:
      break
  }
  return { headers: nextHeaders, params: nextParams }
}

/**
 * Content-Type to auto-set for a given body mode, or null to set none.
 * 'raw'+'text' deliberately returns null — that's the shape a request had
 * before bodyType existed (a plain string body, no header), so old saved
 * requests (bodyType missing -> defaults below) keep sending exactly as
 * before.
 */
function autoContentType(bodyType, bodyLanguage) {
  if (bodyType === 'raw') {
    if (bodyLanguage === 'json') return 'application/json'
    if (bodyLanguage === 'xml') return 'application/xml'
    return null
  }
  if (bodyType === 'urlencoded') return 'application/x-www-form-urlencoded'
  return null
}

/**
 * Turns a resolved body value into what actually gets sent.
 * - raw: the string as-is
 * - urlencoded: an array of {key,value} pairs -> a "k=v&k2=v2" string
 * - formdata: an array of {key,value} pairs -> a real FormData instance, so
 *   fetch generates the multipart boundary itself (no Content-Type header
 *   is set for this mode — see buildRequest)
 * - none: undefined
 */
function serializeBody(bodyType, body) {
  switch (bodyType) {
    case 'raw':
      return typeof body === 'string' ? body : undefined
    case 'urlencoded':
      return (Array.isArray(body) ? body : [])
        .filter(p => p.key)
        .map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value ?? '')}`)
        .join('&')
    case 'formdata': {
      const fd = new FormData()
      for (const p of Array.isArray(body) ? body : []) {
        if (p.key) fd.append(p.key, p.value ?? '')
      }
      return fd
    }
    case 'none':
    default:
      return undefined
  }
}

/**
 * Resolves {{vars}} across a request definition, applies auth, serializes
 * the body per requestDef.bodyType, and runs the pre-request script (if
 * any) via adapters.scriptRunner. Returns the request ready to send, plus
 * whatever vars the script updated (e.g. a token it set) so callers/executor
 * can carry them forward.
 */
export async function buildRequest(requestDef, { vars = {}, adapters = {} } = {}) {
  const bodyType = requestDef.bodyType || 'raw'
  const bodyLanguage = requestDef.bodyLanguage || 'text'

  const resolved = resolveObjectVars(
    {
      method:  requestDef.method || 'GET',
      url:     requestDef.url || '',
      params:  requestDef.params || {},
      headers: requestDef.headers || {},
      body:    requestDef.body,
    },
    vars,
  )

  const { headers, params } = applyAuth(resolved.headers, resolved.params, requestDef.auth)

  const finalHeaders = { ...headers }
  const contentType = autoContentType(bodyType, bodyLanguage)
  if (contentType && !Object.keys(finalHeaders).some(h => h.toLowerCase() === 'content-type')) {
    finalHeaders['Content-Type'] = contentType
  }

  let request = {
    method:  resolved.method,
    url:     buildUrl(resolved.url, params),
    headers: finalHeaders,
    body:    serializeBody(bodyType, resolved.body),
  }

  let nextVars = vars
  let preScriptError = null
  let preScriptLogs = []

  if (requestDef.preRequestScript && adapters.scriptRunner) {
    const outcome = await adapters.scriptRunner.run(requestDef.preRequestScript, { vars: { ...vars }, request })
    preScriptLogs = outcome?.logs || []
    if (outcome?.error) {
      preScriptError = outcome.error
    } else {
      nextVars = outcome?.context?.vars ?? vars
      request = outcome?.context?.request ?? request
    }
  }

  return { request, vars: nextVars, preScriptError, preScriptLogs }
}

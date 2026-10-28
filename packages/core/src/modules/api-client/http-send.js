function normalizeHeaders(headers) {
  if (headers && typeof headers.entries === 'function') return Object.fromEntries(headers.entries())
  return headers || {}
}

/**
 * Sends an already-built request via adapters.apiHttp and times it.
 * Resolves to { response } or, if the request never got a response, { error }.
 */
export async function sendRequest(adapters, request) {
  const started = Date.now()
  try {
    const raw = await adapters.apiHttp.fetch(request.url, {
      method:  request.method,
      headers: request.headers,
      body:    request.body,
    })
    const bodyText = typeof raw.text === 'function' ? await raw.text() : (raw.body ?? '')
    return {
      response: {
        status:     raw.status,
        statusText: raw.statusText,
        headers:    normalizeHeaders(raw.headers),
        body:       bodyText,
        durationMs: Date.now() - started,
      },
    }
  } catch (error) {
    return { error: error?.message || String(error) }
  }
}

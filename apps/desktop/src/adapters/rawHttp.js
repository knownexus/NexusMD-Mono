// Unlike the ado-scoped `http` adapter (ado-client.js), this sends exactly the
// request it's given, to any host — no forced auth/URL scoping. Used only by
// the api-client module's executor for arbitrary user-defined requests.
export const rawHttpAdapter = {
  async fetch(url, options) { return window.fetch(url, options) },
}

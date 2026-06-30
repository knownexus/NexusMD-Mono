// Pure ADO HTTP helpers — URL construction and Basic-auth headers shared by
// desktop and app. Web routes through the backend and doesn't use these.

export function makeAdoUrl(org, path) {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${path}`
}

export function makeAdoAuthHeaders(pat, extra = {}) {
  return {
    Authorization: 'Basic ' + btoa(':' + pat),
    Accept: 'application/json',
    ...extra,
  }
}

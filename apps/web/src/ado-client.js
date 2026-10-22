export function createAdoHttpAdapter() {
  return {
    async fetch(path, options = {}) {
      const res = await window.fetch('/api/ado/' + path, options)
      return {
        ok: res.ok,
        status: res.status,
        json: () => res.json(),
        text: () => res.text(),
      }
    },
  }
}

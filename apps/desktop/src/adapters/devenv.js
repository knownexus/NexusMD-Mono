// Renderer-side `devenv` adapter (contract: IDevenvAdapter in packages/core/src/adapters/index.js),
// calling through to window.electronAPI.devenv from electron/preload.cjs.

const api = () => window.electronAPI?.devenv

export const devenvAdapter = {
  isAvailable() { return !!api() },
  run(config, argv, opts) { return api().run(config, argv, opts) },
  answer(runId, answer) { return api().answer(runId, answer) },
  cancel(runId) { return api().cancel(runId) },
  catalog(config) { return api().catalog(config) },
  open(target) { return api().open(target) },
  active() { return api().active() },
  query(config, argv) { return api().query(config, argv) },
  pathForFile(file) { return api()?.pathForFile?.(file) || '' },
  onLine(cb) { return api()?.onLine(cb) ?? (() => {}) },
  onExit(cb) { return api()?.onExit(cb) ?? (() => {}) },
}

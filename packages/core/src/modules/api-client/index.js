import { registerModule } from '../../features/module-registry.js'

// Module-level state set during init so callers don't need to pass adapters
// every time. This module is action-oriented (UI calls its functions on
// demand), not part of core's periodic data:updated polling cycle — load()
// exists only so the module participates in adapter-presence gating.
let _file          = null
let _scriptRunner  = null
let _secureStorage = null
let _apiHttp       = null

/** The adapters this module was initialised with (null fields if not ready). */
export function getApiClientAdapters() {
  return { file: _file, scriptRunner: _scriptRunner, secureStorage: _secureStorage, apiHttp: _apiHttp }
}

registerModule({
  id:               'api-client',
  name:             'API Client',
  // `file` exists on every platform; `scriptRunner` is desktop-only (sandboxed
  // Node vm via Electron IPC), so its absence is what keeps this module off
  // web/app until a portable scripting story exists there.
  requiredAdapters: ['file', 'scriptRunner'],
  defaultEnabled:   true,

  async init(adapters) {
    _file          = adapters?.file ?? null
    _scriptRunner  = adapters?.scriptRunner ?? null
    _secureStorage = adapters?.secureStorage ?? null
    _apiHttp       = adapters?.apiHttp ?? null
  },

  async load(_adapters) { return {} },

  dispose() {
    _file          = null
    _scriptRunner  = null
    _secureStorage = null
    _apiHttp       = null
  },
})

export * from './collection-store.js'
export * from './var-resolve.js'
export * from './request-builder.js'
export * from './executor.js'
export * from './runner.js'
export * from './history-store.js'
export * from './postman-import.js'
export * from './bruno-import.js'
export * from './bruno-executor.js'

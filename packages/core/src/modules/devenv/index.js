// packages/core/src/modules/devenv/index.js
//
// Dev Environment — drives devenv (C:\repos\dev-environment) from NexusMD desktop.
// Pure logic only; processes are started by the desktop-only `devenv` adapter.

import { registerModule } from '../../features/module-registry.js'

export { CONTROL_PREFIX as DEVENV_CONTROL_PREFIX, PROTOCOL_VERSION as DEVENV_PROTOCOL_VERSION, parseLine as parseDevenvLine } from './protocol.js'
export { ansiToSpans, stripAnsi } from './ansi.js'
export {
  MAX_LINES as DEVENV_MAX_LINES, createRunState, applyStarting, applyStarted, applyStartFailed,
  applyLine, applyAnswered, applyOpened, applyCancelRequested, applyExit,
} from './run-state.js'
export { normaliseCatalog, isCompatibleCatalog, takesArgs, takesManyArgs, buildDevenvArgv, commandKey as devenvCommandKey } from './catalog.js'
export { normaliseStatus } from './status.js'
export { createPlanForm, validatePlanForm, buildPlanAnswer, normaliseRefPrompt } from './plan.js'
export { normaliseSummary } from './summary.js'
export { normaliseBuilds, buildBuildArgv, MOBILE_ABIS as DEVENV_MOBILE_ABIS, DEPLOY_MODES as DEVENV_DEPLOY_MODES } from './builds.js'
export { normaliseLogTargets, classifyLogLevel, filterLogLines, captureFolder, CAPTURE_SINCE as DEVENV_CAPTURE_SINCE } from './logs.js'
export { normaliseTestRuns, normaliseTestCollection, buildTestUpArgv, buildTestRunArgv, topLevelPaths } from './tests.js'
export { normaliseBaselines, normaliseSqlScripts, buildDbArgv, DB_EDITOR_URL as DEVENV_DB_EDITOR_URL } from './database.js'
export { normaliseAvds, buildEmulatorArgv } from './emulator.js'
export { normaliseMacStatus, buildMacArgv, macConnectionText } from './mac.js'

let _adapter = null

export function getDevenvAdapter() {
  return _adapter
}

registerModule({
  id: 'devenv',
  name: 'Dev Environment',
  // Desktop-only: running pwsh needs the Electron main process.
  requiredAdapters: ['devenv'],
  defaultEnabled: false,
  init(adapters) {
    _adapter = adapters.devenv
  },
  async load() {
    // Action-oriented module — nothing to poll.
    return {}
  },
  dispose() {
    _adapter = null
  },
})

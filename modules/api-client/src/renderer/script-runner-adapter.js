export const scriptRunnerAdapter = {
  async run(script, context) { return window.electronAPI.apiClient.script.run(script, context) },
  // Bruno-style scripts run as a session so they can await bru.runRequest (see bruno-runtime.cjs).
  async runBruno(script, input) { return window.electronAPI.apiClient.bruno.start(script, input) },
  async resumeBruno(sessionId, requestId, result) { return window.electronAPI.apiClient.bruno.resume(sessionId, requestId, result) },
}

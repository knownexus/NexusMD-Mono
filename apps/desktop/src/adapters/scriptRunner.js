export const scriptRunnerAdapter = {
  async run(script, context) { return window.electronAPI.apiClient.script.run(script, context) },
}

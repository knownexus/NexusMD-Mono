export const pickerAdapter = {
  async pickFile(filter)     { return window.electronAPI.picker.pickFile(filter) },
  async pickDirectory()      { return window.electronAPI.picker.pickDirectory() },
  async saveFile(name, text) { return window.electronAPI.picker.saveFile(name, text) },
}

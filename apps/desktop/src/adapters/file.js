export const fileAdapter = {
  async read(path)          { return window.electronAPI.file.read(path) },
  async write(path, text)   { return window.electronAPI.file.write(path, text) },
  async exists(path)        { return window.electronAPI.file.exists(path) },
  async list(dir)           { return window.electronAPI.file.list(dir) },
  async delete(path)        { return window.electronAPI.file.delete(path) },
  async mkdir(dir)          { return window.electronAPI.file.mkdir(dir) },
  async defaultProfileDir() { return window.electronAPI.file.defaultProfileDir() },
}

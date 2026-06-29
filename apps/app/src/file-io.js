// App (Capacitor) file I/O for profile bundles. Built on the existing
// pickerAdapter (hidden <input> to open, blob download to save) so it works in
// the Android WebView today without pulling in native @capacitor/filesystem.
import { pickerAdapter } from './adapters/picker.js'

export const appFileIO = {
  async saveFile(filename, text) {
    await pickerAdapter.saveFile(filename, text)
  },
  async pickFile() {
    const picked = await pickerAdapter.pickFile({ ext: '.nmdprofile,.nmdplanner,application/json' })
    return picked?.text ?? null
  },
}

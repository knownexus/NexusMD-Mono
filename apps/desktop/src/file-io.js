// Desktop (Electron) file I/O for profile bundles. Built on the existing
// pickerAdapter, which bridges to native open/save dialogs over IPC
// (electron/ipc/picker.js).
import { pickerAdapter } from './adapters/picker.js'

export const desktopFileIO = {
  async saveFile(filename, text) {
    await pickerAdapter.saveFile(filename, text)
  },
  async pickFile() {
    const picked = await pickerAdapter.pickFile({ ext: '.nmdprofile' })
    return picked?.text ?? null
  },
}

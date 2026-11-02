// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { register, describe: describeDisplay, parseFake } = require('./display.cjs')

const disp = (id, width, height, scaleFactor = 1) => ({ id, size: { width, height }, scaleFactor })

function setup({ env = {} } = {}) {
  const handlers = {}
  const screenListeners = {}
  const winListeners = {}
  let display = disp(1, 2560, 1440, 1.5)
  const win = {
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    on: (ev, fn) => { winListeners[ev] = fn },
    webContents: { send: vi.fn() },
  }
  const screen = {
    getDisplayMatching: vi.fn(() => display),
    getPrimaryDisplay: () => display,
    on: (ev, fn) => { screenListeners[ev] = fn },
  }
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn } }
  const watch = register(ipcMain, { screen, getWindow: () => win, env })
  watch.watch(win)
  return { handlers, screenListeners, winListeners, win, setDisplay: d => { display = d } }
}

afterEach(() => { delete globalThis.__nexusmdSetDisplay })

describe('display tracker', () => {
  it('reports the real resolution and the laid-out size', () => {
    expect(describeDisplay(disp(7, 2560, 1440, 1.5))).toEqual({ id: 7, width: 2560, height: 1440, scaleFactor: 1.5, physicalWidth: 3840, physicalHeight: 2160 })
  })

  it('answers display:get with the screen the window is on', async () => {
    const { handlers } = setup()
    expect(await handlers['display:get']()).toMatchObject({ physicalWidth: 3840, physicalHeight: 2160 })
  })

  it('tells the page only when the screen changes, not on every move or resize', async () => {
    const { handlers, winListeners, screenListeners, win, setDisplay } = setup()
    await handlers['display:get']()
    winListeners.moved()
    winListeners.resize()
    expect(win.webContents.send).not.toHaveBeenCalled()

    setDisplay(disp(2, 1920, 1080))
    winListeners.moved()
    expect(win.webContents.send).toHaveBeenCalledTimes(1)
    expect(win.webContents.send).toHaveBeenLastCalledWith('display:changed', expect.objectContaining({ id: 2, physicalWidth: 1920 }))

    // Scaling changed on the same screen.
    setDisplay(disp(2, 1536, 864, 1.25))
    screenListeners['display-metrics-changed']()
    expect(win.webContents.send).toHaveBeenCalledTimes(2)
  })

  it('stands in a fake screen for tests, switched like moving to another monitor', async () => {
    expect(parseFake('3840x2160@1.5')).toMatchObject({ width: 2560, height: 1440, physicalWidth: 3840, physicalHeight: 2160 })
    expect(parseFake('nonsense')).toBeNull()
    const { handlers, win } = setup({ env: { NEXUSMD_E2E_DISPLAY: '3840x1600' } })
    expect(await handlers['display:get']()).toMatchObject({ physicalWidth: 3840, physicalHeight: 1600 })
    globalThis.__nexusmdSetDisplay('1920x1080')
    expect(win.webContents.send).toHaveBeenLastCalledWith('display:changed', expect.objectContaining({ physicalWidth: 1920, physicalHeight: 1080 }))
  })
})

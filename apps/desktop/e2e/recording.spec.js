import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'
import { buildTree } from '../src/recording-model.js'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Record real clicks in the real app and read the recording back: the calls a click set off, a request that carries a token (the
// token must not be in the file or on screen; an ordinary value in the response must be), an IPC call into the main process with
// what it did beneath it, and a round trip through Export and Import.
const PAT = 'SEEDED-PAT-0123456789abcdef'
const PAT_BASIC = Buffer.from(`:${PAT}`).toString('base64') // how the request carries it
const MARKER = 'e2e-response-body-marker'

const descendants = (node) => node.children.flatMap((c) => [c, ...descendants(c)])
const ancestorsOf = (tree, node) => { const out = []; for (let n = node.parent && tree.byId.get(node.parent); n; n = n.parent && tree.byId.get(n.parent)) out.push(n); return out }

test('a recording shows what a click set off, hides the token, and survives export and import', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'nxt-e2e-'))
  const { app, win, close } = await launchApp()
  try {
    const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
    await win.route('https://dev.azure.com/**', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ value: [{ name: 'Alpha' }, { name: 'Beta' }], marker: MARKER }),
    }))
    await expect(win.getByText('Dashboard').first()).toBeVisible({ timeout: 20_000 })

    // Set up before recording: the Azure DevOps form, filled in; and a control of the test's own whose click makes an IPC call
    // (its handler is not traced code, so what hangs under the click is the join to the main process, nothing else).
    await win.getByText('Settings').first().click()
    await win.getByRole('button', { name: 'Integrations' }).click()
    await win.getByPlaceholder('your-org-name').fill('acme')
    await win.getByPlaceholder('Leave blank to keep existing PAT').fill(PAT)
    await win.evaluate(() => {
      const b = document.createElement('button'); b.textContent = 'E2E screen info'
      b.onclick = () => window.electronAPI.display.get()
      document.body.appendChild(b)
    })

    // Record from here, without leaving the form (switching Settings tabs clears it).
    const { id } = await win.evaluate(() => window.electronAPI.recording.start('e2e discover projects'))
    await win.getByRole('button', { name: 'Discover projects' }).click()
    await expect(win.getByText(/Discovered 2 projects/)).toBeVisible({ timeout: 10_000 })   // the app behaved as it does when not recording
    await win.getByRole('button', { name: 'E2E screen info' }).click()
    await win.waitForTimeout(900)                                                            // the window's last batch reaches the main process
    const info = await win.evaluate(() => window.electronAPI.recording.stop())
    expect(info.status).toBe('finished')

    // The tree: the click, the calls under it, the request.
    const { events } = await win.evaluate((rid) => window.electronAPI.recording.read(rid), id)
    const tree = buildTree(events)
    const discover = tree.roots.find(r => r.title === 'Clicked Discover projects')
    expect(discover, 'a click node named from the button').toBeTruthy()
    expect(discover.data.page).toBe('Settings')
    const net = descendants(discover).find(n => n.kind === 'net' && n.title.includes('dev.azure.com/acme/_apis/projects'))
    expect(net, 'the request, under the click').toBeTruthy()
    expect(net.data).toMatchObject({ method: 'GET', status: 200 })
    expect(net.data.responseBody).toContain(MARKER)
    expect(ancestorsOf(tree, net).map(n => n.title)).toContain('discoverProjects')
    expect(net.data.headers.authorization).toBe('[redacted]')

    // An IPC call from the window, with what the main process did about it beneath it.
    const screenClick = tree.roots.find(r => r.title === 'Clicked E2E screen info')
    const ipc = descendants(screenClick).find(n => n.kind === 'ipc' && n.title === 'display:get')
    expect(ipc, 'the IPC call, under the click').toBeTruthy()
    expect(ipc.proc).toBe('main')
    expect(descendants(ipc).length, 'frames the main process ran for it').toBeGreaterThan(0)

    // The token is nowhere in what was saved, in either of the ways it travels; a value no rule knows is there.
    const saved = readFileSync(join(userData, 'logs', '_recordings', `${id}.nxrec`), 'utf8')
    expect(saved).not.toContain(PAT)
    expect(saved).not.toContain(PAT_BASIC)
    expect(saved).toContain(MARKER)
    expect(saved).toContain('Alpha')

    // On screen: open it from the panel, find the request, read its response; the token is not on the page.
    await win.getByRole('button', { name: 'Data & sync' }).click()
    await win.getByRole('button', { name: 'Open e2e discover projects' }).click()
    await expect(win.getByRole('tree', { name: 'Recorded calls' })).toBeVisible({ timeout: 10_000 })
    await win.getByRole('treeitem', { name: /Clicked Discover projects/ }).click()
    await win.getByRole('button', { name: 'Expand Clicked Discover projects' }).click()
    await expect(win.getByRole('treeitem', { name: /discoverProjects/ })).toBeVisible()
    await expect(win.locator('body')).not.toContainText(PAT)
    await win.getByRole('button', { name: 'Close recording' }).click()

    // Export, delete, import: the file comes back byte for byte. (The native file dialogs are answered here.)
    const exported = join(scratch, 'copy.nxrec')
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }) }, exported)
    await win.getByRole('button', { name: 'Export e2e discover projects' }).click()
    await expect(win.getByRole('status')).toContainText(/saved/i)
    expect(readFileSync(exported)).toEqual(readFileSync(join(userData, 'logs', '_recordings', `${id}.nxrec`)))

    await win.getByRole('button', { name: 'Delete e2e discover projects' }).click()
    await win.getByRole('button', { name: 'Delete for good' }).click()
    await expect(win.getByRole('button', { name: 'Open e2e discover projects' })).toHaveCount(0)
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, exported)
    await win.getByRole('button', { name: 'Import recording' }).click()
    await expect(win.getByRole('button', { name: 'Open e2e discover projects' })).toBeVisible()
    expect(readFileSync(join(userData, 'logs', '_recordings', `${id}.nxrec`))).toEqual(readFileSync(exported))
  } finally {
    await close()
    rmSync(scratch, { recursive: true, force: true })
  }
})

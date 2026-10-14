import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ProfileEditor } from './profile-editor.jsx'
import { clearAllDrafts, getDraft } from './profile-drafts.js'
import { EXAMPLE_ENV, DIR, CFG, fakeProfileAdapter } from './profile-test-fixtures.js'

afterEach(() => { cleanup(); clearAllDrafts() })

function open(path, files, props = {}) {
  const adapter = fakeProfileAdapter(files)
  const utils = render(<ProfileEditor adapter={adapter} config={CFG} dir={DIR} path={path} {...props} />)
  return { adapter, ...utils }
}
const saveButton = () => screen.getByRole('button', { name: 'Save' })
const textBox = path => screen.getByRole('textbox', { name: `Text of ${path}` })

describe('ProfileEditor', () => {
  it('opens a plain file as text with Save disabled until it changes', async () => {
    open('commands.ps1', { 'commands.ps1': '# extra commands\n' })
    expect((await screen.findByRole('textbox', { name: 'Text of commands.ps1' })).value).toBe('# extra commands\n')
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(textBox('commands.ps1'), { target: { value: '# changed\n' } })
    expect(saveButton().disabled).toBe(false)
  })

  it('saves with the stamp it opened and the folder it read from', async () => {
    const { adapter } = open('commands.ps1', { 'commands.ps1': 'a' })
    fireEvent.change(await screen.findByRole('textbox', { name: 'Text of commands.ps1' }), { target: { value: 'b' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(adapter.disk.get('commands.ps1')).toBe('b'))
    expect(adapter.writeProfileFile).toHaveBeenCalledWith(CFG, 'commands.ps1', 'b', { expected: 's1', dir: DIR })
    expect(getDraft(DIR, 'commands.ps1')).toBeNull()
    await waitFor(() => expect(saveButton().disabled).toBe(true))
  })

  it('Ctrl+S saves', async () => {
    const { adapter } = open('commands.ps1', { 'commands.ps1': 'a' })
    const box = await screen.findByRole('textbox', { name: 'Text of commands.ps1' })
    fireEvent.change(box, { target: { value: 'c' } })
    fireEvent.keyDown(box, { key: 's', ctrlKey: true })
    await waitFor(() => expect(adapter.disk.get('commands.ps1')).toBe('c'))
  })

  it('reports a file changed on disk instead of overwriting it; Overwrite then wins', async () => {
    const { adapter } = open('mac.json', { 'mac.json': '{"host":"mac.local","user":"me"}' })
    await screen.findByRole('textbox', { name: 'Host' })
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    adapter.changeOnDisk('mac.json', '{"host":"mac.local","user":"me","sshKey":"C:\\\\k"}')
    fireEvent.change(textBox('mac.json'), { target: { value: '{"host":"mac2","user":"me"}' } })
    fireEvent.click(saveButton())
    expect(await screen.findByText('mac.json changed on disk since you opened it.')).toBeTruthy()
    expect(adapter.disk.get('mac.json')).toMatch(/sshKey/)
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(adapter.disk.get('mac.json')).toBe('{"host":"mac2","user":"me"}'))
    await waitFor(() => expect(screen.queryByText(/changed on disk/)).toBeNull())
  })

  it('Reload drops the draft and shows what is on disk', async () => {
    const { adapter } = open('commands.ps1', { 'commands.ps1': 'a' })
    fireEvent.change(await screen.findByRole('textbox', { name: 'Text of commands.ps1' }), { target: { value: 'mine' } })
    adapter.changeOnDisk('commands.ps1', 'theirs')
    fireEvent.click(saveButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(textBox('commands.ps1').value).toBe('theirs'))
    expect(getDraft(DIR, 'commands.ps1')).toBeNull()
  })

  it('keeps a draft across unmount, and flags it when the file changed meanwhile', async () => {
    const files = { 'commands.ps1': 'a' }
    const first = open('commands.ps1', files)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Text of commands.ps1' }), { target: { value: 'draft' } })
    first.unmount()
    first.adapter.changeOnDisk('commands.ps1', 'changed')
    render(<ProfileEditor adapter={first.adapter} config={CFG} dir={DIR} path="commands.ps1" />)
    expect((await screen.findByRole('textbox', { name: 'Text of commands.ps1' })).value).toBe('draft')
    expect(await screen.findByText('commands.ps1 changed on disk since you opened it.')).toBeTruthy()
  })

  it('blocks Save on invalid YAML with the parser\'s message', async () => {
    open('docker/services.compose.yml', { 'docker/services.compose.yml': 'services: {}\n' })
    fireEvent.change(await screen.findByRole('textbox', { name: 'Text of docker/services.compose.yml' }), { target: { value: 'services: [\n' } })
    expect(screen.getByRole('list', { name: 'Problems' }).textContent).toMatch(/Not valid YAML/)
    expect(saveButton().disabled).toBe(true)
  })

  it('blocks Save on an environment.json devenv would reject, and shows the problem next to the field', async () => {
    open('environment.json', { 'environment.json': EXAMPLE_ENV })
    const ports = await screen.findAllByRole('textbox', { name: 'Port' })
    fireEvent.change(ports[0], { target: { value: '70000' } })
    expect(saveButton().disabled).toBe(true)
    expect(screen.getAllByRole('note').some(n => /1 to 65535/.test(n.textContent))).toBe(true)
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Port' })[0], { target: { value: '5102' } })
    expect(saveButton().disabled).toBe(false)
    expect(screen.getByText('Form edits rewrite this file with 2-space indentation.')).toBeTruthy()
  })

  it('a form edit changes only that value in the text', async () => {
    const { adapter } = open('environment.json', { 'environment.json': EXAMPLE_ENV })
    fireEvent.change((await screen.findAllByRole('textbox', { name: 'Port' }))[0], { target: { value: '5102' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(JSON.parse(adapter.disk.get('environment.json'))).toEqual({
      ...JSON.parse(EXAMPLE_ENV),
      repositories: { ...JSON.parse(EXAMPLE_ENV).repositories, orders: { ...JSON.parse(EXAMPLE_ENV).repositories.orders, port: 5102 } },
    }))
  })

  it('switches the form off while the text is not valid JSON', async () => {
    open('environment.json', { 'environment.json': EXAMPLE_ENV })
    await screen.findAllByRole('textbox', { name: 'Port' })
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    fireEvent.change(textBox('environment.json'), { target: { value: '{ broken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Form' }))
    expect(screen.getByText(/The form needs valid JSON/)).toBeTruthy()
  })

  it('a missing mac.json opens as an empty form and Save creates it', async () => {
    const { adapter } = open('mac.json', {})
    expect(await screen.findByText("mac.json doesn't exist yet - Save creates it.")).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Host' }), { target: { value: 'mac.local' } })
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: 'User' }), { target: { value: 'me' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(JSON.parse(adapter.disk.get('mac.json'))).toEqual({ host: 'mac.local', user: 'me' }))
    expect(adapter.writeProfileFile.mock.calls[0][3]).toEqual({ expected: null, dir: DIR })
  })

  it('does not offer to edit a binary or very large file', async () => {
    const adapter = fakeProfileAdapter({})
    adapter.readProfileFile.mockResolvedValueOnce({ dir: DIR, path: 'logo.png', stamp: 'x', binary: true })
    render(<ProfileEditor adapter={adapter} config={CFG} dir={DIR} path="logo.png" />)
    expect(await screen.findByText("This file isn't text, so it can't be edited here.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open folder' }))
    expect(adapter.open).toHaveBeenCalledWith({ path: DIR })
  })

  it('keeps the draft and shows the error when saving fails', async () => {
    const { adapter } = open('commands.ps1', { 'commands.ps1': 'a' })
    adapter.writeProfileFile.mockRejectedValueOnce(new Error("Couldn't save commands.ps1: EPERM"))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Text of commands.ps1' }), { target: { value: 'b' } })
    fireEvent.click(saveButton())
    expect(await screen.findByText("Couldn't save commands.ps1: EPERM")).toBeTruthy()
    expect(getDraft(DIR, 'commands.ps1').text).toBe('b')
  })

  it('says when devenv is running', async () => {
    open('commands.ps1', { 'commands.ps1': 'a' }, { busyLabel: 'devenv start' })
    expect(await screen.findByText('devenv is running devenv start - it may have read the file before your save.')).toBeTruthy()
  })
})

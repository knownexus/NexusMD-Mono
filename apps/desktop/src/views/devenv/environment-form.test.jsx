import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { EnvironmentForm } from './environment-form.jsx'
import { MacForm } from './mac-form.jsx'
import { EXAMPLE_ENV } from './profile-test-fixtures.js'

afterEach(cleanup)

const example = () => JSON.parse(EXAMPLE_ENV)
function setup(value = example(), issues = []) {
  const onChange = vi.fn()
  render(<EnvironmentForm value={value} issues={issues} onChange={onChange} />)
  return { onChange, last: () => onChange.mock.calls.at(-1)[0] }
}
const repo = key => within(screen.getByLabelText(`Repository ${key}`))

describe('EnvironmentForm', () => {
  it('shows the repositories in file order with their fields', () => {
    setup()
    const cards = screen.getAllByLabelText(/^Repository /)
    expect(cards.map(c => c.getAttribute('aria-label'))).toEqual(['Repository orders', 'Repository mobile'])
    expect(repo('orders').getByRole('textbox', { name: 'Project' }).value).toBe('src/Orders.Api/Orders.Api.csproj')
    expect(repo('orders').getByRole('checkbox', { name: 'Docker' }).checked).toBe(true)
    expect(repo('orders').getByRole('textbox', { name: 'Test database' }).value).toBe('Orders_Local')
    expect(screen.getByRole('textbox', { name: 'Package id' }).value).toBe('com.example.app')
  })

  it('an edit changes only that value', () => {
    const { last } = setup()
    fireEvent.change(repo('orders').getByRole('textbox', { name: 'Port' }), { target: { value: '5102' } })
    const want = example()
    want.repositories.orders.port = 5102
    expect(last()).toEqual(want)
    expect(Object.keys(last().repositories.orders)).toEqual(Object.keys(example().repositories.orders))
  })

  it('shows a problem next to its field', () => {
    setup(example(), [{ at: 'repositories.orders.port', message: '"port" must be a whole number from 1 to 65535.' }])
    expect(repo('orders').getByRole('note').textContent).toBe('"port" must be a whole number from 1 to 65535.')
  })

  it('unticking a switch removes it', () => {
    const { last } = setup()
    fireEvent.click(repo('orders').getByRole('checkbox', { name: 'Docker' }))
    expect('docker' in last().repositories.orders).toBe(false)
  })

  it('renaming a repository follows it into the test settings', () => {
    const { last } = setup()
    const key = screen.getByRole('textbox', { name: 'Key of orders' })
    fireEvent.change(key, { target: { value: 'sales' } })
    fireEvent.blur(key)
    expect(Object.keys(last().repositories)).toEqual(['sales', 'mobile'])
    expect(last().test.defaultServices).toEqual(['sales'])
  })

  it('refuses a rename onto an existing key', () => {
    const { onChange } = setup()
    const key = screen.getByRole('textbox', { name: 'Key of orders' })
    fireEvent.change(key, { target: { value: 'mobile' } })
    fireEvent.blur(key)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('There is already a repository "mobile".')).toBeTruthy()
  })

  it('adds, moves and removes repositories; a new mobile app is keyed mobile', () => {
    const value = example()
    delete value.repositories.mobile
    const { last } = setup(value)
    fireEvent.change(screen.getByRole('combobox', { name: 'New repository kind' }), { target: { value: 'mobile' } })
    expect(screen.getByRole('textbox', { name: 'New repository key' }).value).toBe('mobile')
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }))
    expect(last().repositories.mobile).toEqual({ source: '', ref: 'main', project: '', kind: 'mobile' })
    cleanup()
    const s2 = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Move mobile up' }))
    expect(Object.keys(s2.last().repositories)).toEqual(['mobile', 'orders'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove orders' }))
    expect(Object.keys(s2.last().repositories)).toEqual(['mobile'])
  })

  it('edits the test stack defaults and wiring', () => {
    const { last } = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Default service orders' }))
    expect('defaultServices' in last().test).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Add wiring' }))
    expect(last().test.wiring).toEqual([{ from: '', to: '', key: '' }])
  })

  it('lists the settings it does not show, so they are known to be kept', () => {
    const value = example()
    value.notes = 'x'
    value.repositories.orders.envFile = 'orders.env'
    setup(value)
    expect(screen.getByText(/Other settings/).textContent).toMatch(/notes, repositories\.orders\.envFile/)
  })
})

describe('MacForm', () => {
  it('shows problems next to host and user, and Browse fills the key', async () => {
    const onChange = vi.fn()
    const picker = { pickFile: vi.fn(async () => 'C:\\Users\\me\\.ssh\\key') }
    render(<MacForm value={{ host: 'bad host', user: 'me', port: 22 }} onChange={onChange} picker={picker}
      issues={[{ at: 'host', message: '"host" must be the Mac\'s IP address or host name.' }]} />)
    expect(screen.getByRole('note').textContent).toMatch(/host/)
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith({ host: 'bad host', user: 'me', port: 22, sshKey: 'C:\\Users\\me\\.ssh\\key' }))
    expect(screen.getByText(/Other settings/).textContent).toMatch(/port/)
  })
})

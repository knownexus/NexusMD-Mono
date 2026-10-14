import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { EnvironmentForm } from './environment-form.jsx'

afterEach(cleanup)
const ENV = {
  name: 'example',
  repositories: {
    orders: { source: '../orders/main', ref: 'main', project: 'src/O.csproj', label: 'Orders', kind: 'api', port: 5101, docker: true, test: { port: 5201, db: 'Orders_Local' } },
    mobile: { source: '../app/main', ref: 'main', project: 'src/A.csproj', kind: 'mobile' },
  },
  database: { name: 'Orders_Local', databases: ['Orders_Local'], sourceContainer: 'sql-dev' },
  mobile: { packageId: 'com.example.app' },
  test: { defaultServices: ['orders'], collection: 'api-tests', wiring: [{ from: 'orders', to: 'orders', key: 'Self__Url' }], extraDbConn: { x: {} } },
  custom: { keep: true },
}
function setup(value = ENV) {
  const onChange = vi.fn()
  render(<EnvironmentForm value={value} onChange={onChange} />)
  return onChange
}
const last = fn => fn.mock.calls.at(-1)[0]

describe('EnvironmentForm', () => {
  it('edits repository fields, keeping keys it does not show', () => {
    const onChange = setup()
    fireEvent.change(screen.getByLabelText('orders source'), { target: { value: '../orders/feature' } })
    expect(last(onChange).repositories.orders.source).toBe('../orders/feature')
    expect(last(onChange).custom).toEqual({ keep: true })
    expect(last(onChange).test.extraDbConn).toEqual({ x: {} })
  })
  it('turns ports into numbers and removes cleared optional fields', () => {
    const onChange = setup()
    fireEvent.change(screen.getByLabelText('orders port'), { target: { value: '6000' } })
    expect(last(onChange).repositories.orders.port).toBe(6000)
    fireEvent.change(screen.getByLabelText('orders label'), { target: { value: '' } })
    expect('label' in last(onChange).repositories.orders).toBe(false)
  })
  it('ticks and unticks booleans and the test stack block', () => {
    const onChange = setup()
    fireEvent.click(screen.getByLabelText('orders runs in Docker'))
    expect('docker' in last(onChange).repositories.orders).toBe(false)
    fireEvent.click(screen.getByLabelText('mobile built by devenv start'))
    expect(last(onChange).repositories.mobile.start).toBe(true)
    fireEvent.click(screen.getByLabelText('orders runs in the test stack'))
    expect('test' in last(onChange).repositories.orders).toBe(false)
  })
  it('renames a repository on blur, with references, and refuses a taken name', () => {
    const onChange = setup()
    const name = screen.getByLabelText('orders name')
    fireEvent.change(name, { target: { value: 'mobile' } }); fireEvent.blur(name)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('"mobile" can\'t be used - lower-case letters, digits and -, not already taken.')).toBeTruthy()
    fireEvent.change(name, { target: { value: 'ordering' } }); fireEvent.blur(name)
    expect(Object.keys(last(onChange).repositories)).toEqual(['ordering', 'mobile'])
    expect(last(onChange).test.defaultServices).toEqual(['ordering'])
  })
  it('adds and removes repositories', () => {
    const onChange = setup()
    fireEvent.change(screen.getByLabelText('New repository name'), { target: { value: 'billing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }))
    expect(last(onChange).repositories.billing).toEqual({ source: '', ref: 'main', project: '', kind: 'api' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove orders' }))
    expect(Object.keys(last(onChange).repositories)).toEqual(['mobile'])
  })
  it('edits database, mobile and test settings and the wiring list', () => {
    const onChange = setup()
    fireEvent.change(screen.getByLabelText('Databases'), { target: { value: 'A, B' } })
    fireEvent.blur(screen.getByLabelText('Databases'))
    expect(last(onChange).database.databases).toEqual(['A', 'B'])
    fireEvent.change(screen.getByLabelText('Mobile package id'), { target: { value: 'com.x' } })
    expect(last(onChange).mobile.packageId).toBe('com.x')
    fireEvent.click(screen.getByLabelText('orders default test API'))
    expect(last(onChange).test.defaultServices).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Add wiring' }))
    expect(last(onChange).test.wiring).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Wiring 1 setting'), { target: { value: 'Other__Url' } })
    expect(last(onChange).test.wiring[0].key).toBe('Other__Url')
    fireEvent.click(screen.getByRole('button', { name: 'Remove wiring 1' }))
    expect(last(onChange).test.wiring).toEqual([])
  })
  it('keeps a typed comma in Databases until blur, then commits', () => {
    const onChange = setup()
    const box = screen.getByLabelText('Databases')
    fireEvent.change(box, { target: { value: 'A' } })
    fireEvent.change(box, { target: { value: 'A,' } })
    expect(box.value).toBe('A,')
    fireEvent.change(box, { target: { value: 'A, B' } })
    fireEvent.blur(box)
    expect(last(onChange).database.databases).toEqual(['A', 'B'])
    fireEvent.change(box, { target: { value: '' } })
    fireEvent.blur(box)
    expect('databases' in last(onChange).database).toBe(false)
  })
  it('works for an empty file', () => {
    const onChange = setup({})
    fireEvent.change(screen.getByLabelText('New repository name'), { target: { value: 'api' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }))
    expect(last(onChange)).toEqual({ repositories: { api: { source: '', ref: 'main', project: '', kind: 'api' } } })
  })
})

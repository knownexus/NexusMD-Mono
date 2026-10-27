// packages/ui/src/views/ViewDbManager.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { ViewDbManager } from './ViewDbManager.jsx'

// ── Fake adapter ──────────────────────────────────────────────────────────────

function makeAdapter(overrides = {}) {
  return {
    isAvailable: () => true,
    connect:    vi.fn().mockResolvedValue({ ok: true, tables: ['patients', 'staff'] }),
    getRows:    vi.fn().mockResolvedValue({
      columns: ['id', 'name'],
      rows:    [[1, 'Alice'], [2, 'Bob']],
    }),
    deleteRows: vi.fn().mockResolvedValue({ ok: true, affected: 1 }),
    updateCell: vi.fn().mockResolvedValue({ ok: true, affected: 1 }),
    runQuery:   vi.fn().mockResolvedValue({ columns: ['id'], rows: [[1]], affected: null }),
    getColumns: vi.fn().mockResolvedValue({
      ok: true,
      columns: [
        { name: 'id', dataType: 'INTEGER', isPrimaryKey: true },
        { name: 'name', dataType: 'TEXT', isPrimaryKey: false },
        { name: 'status', dataType: 'TEXT', isPrimaryKey: false },
      ],
    }),
    ...overrides,
  }
}

// Opens a table from the sidebar's table list.
function openTable(name) {
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Table list' })).getByText(name))
}
const dialog = () => within(screen.getByRole('dialog'))

// The connect dialog remembers the last database type; start every test from Demo.
beforeEach(() => { window.localStorage.clear() })

// ─────────────────────────────────────────────────────────────────────────────

describe('ViewDbManager', () => {
  let adapters

  beforeEach(() => {
    adapters = { dbManager: makeAdapter() }
  })

  afterEach(() => { cleanup() })

  it('renders the welcome pane when no session is active', () => {
    render(<ViewDbManager adapters={adapters} />)
    expect(screen.getByText('Database Manager')).toBeTruthy()
    expect(screen.getByText(/Connect to database/i)).toBeTruthy()
  })

  it('opens the connect dialog on button click', () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Demo')).toBeTruthy()
    expect(screen.getByText('SQLite')).toBeTruthy()
    expect(screen.getByText('SQL Server')).toBeTruthy()
  })

  it('closes the connect dialog on cancel', () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByRole('dialog')).not.toBeTruthy()
  })

  it('loads demo data without calling the adapter', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Load demo'))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeTruthy())
    expect(adapters.dbManager.connect).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'Demo', selected: true })).toBeTruthy()
    expect(screen.getByText('patients')).toBeTruthy()
  })

  it('connects with SQLite connection string and shows tables', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('SQLite'))

    // Switch to connection string mode
    fireEvent.click(screen.getByRole('tab', { name: 'Connection string' }))
    fireEvent.change(screen.getByLabelText(/connection string/i), {
      target: { value: 'sqlite:///test/data.db' },
    })
    fireEvent.click(screen.getByText('Connect'))

    await waitFor(() => expect(adapters.dbManager.connect).toHaveBeenCalledOnce())
    expect(adapters.dbManager.connect).toHaveBeenCalledWith('sqlite', expect.objectContaining({ filePath: 'test/data.db' }))
    await waitFor(() => expect(screen.getByText('patients')).toBeTruthy())
  })

  it('shows error toast when connection fails', async () => {
    adapters.dbManager.connect.mockRejectedValue(new Error('Connection refused'))
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('SQLite'))
    fireEvent.click(screen.getByText('Connect'))

    await waitFor(() => expect(screen.getByText('Connection refused')).toBeTruthy())
  })

  it('shows table rows when a table is selected', async () => {
    render(<ViewDbManager adapters={adapters} />)
    // Load demo for simplicity
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Load demo'))
    await waitFor(() => expect(screen.getByText('patients')).toBeTruthy())

    openTable('patients')
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
  })

  it('filters rows by search term', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Load demo'))
    await waitFor(() => screen.getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))

    fireEvent.change(screen.getByPlaceholderText('Search rows…'), { target: { value: 'Alice' } })
    expect(screen.getByText('Alice Johnson')).toBeTruthy()
    expect(screen.queryByText('Bob Smith')).not.toBeTruthy()
  })

  it('shows delete button when rows are selected', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Load demo'))
    await waitFor(() => screen.getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1])  // first data row checkbox
    expect(screen.getByText(/Delete 1 row/i)).toBeTruthy()
  })

  it('shows confirmation dialog before deleting', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Load demo'))
    await waitFor(() => screen.getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))

    fireEvent.click(screen.getAllByRole('checkbox')[1])
    fireEvent.click(screen.getByText(/Delete 1 row/i))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy()
  })

  it('disconnects and returns to welcome pane', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Load demo'))
    await waitFor(() => screen.getByText('Disconnect'))

    fireEvent.click(screen.getByText('Disconnect'))
    expect(screen.getByText('Database Manager')).toBeTruthy()
  })

  it('auto-populates SELECT * FROM <table> when a table is chosen in the Query tab', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Load demo'))
    await waitFor(() => screen.getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))

    fireEvent.click(screen.getByRole('tab', { name: 'Query' }))
    const tableSelects = screen.getAllByLabelText('Tables')
    const queryTableSelect = tableSelects[tableSelects.length - 1]
    fireEvent.change(queryTableSelect, { target: { value: 'staff' } })

    expect(screen.getByLabelText('SQL query').value).toBe('SELECT * FROM [staff]')
  })

  it('switches to query tab and runs a query', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Load demo'))
    await waitFor(() => screen.getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))

    fireEvent.click(screen.getByRole('tab', { name: 'Query' }))
    fireEvent.change(screen.getByLabelText('SQL query'), { target: { value: 'SELECT * FROM patients' } })
    fireEvent.click(screen.getByText('Run query'))

    await waitFor(() => expect(screen.getByText(/rows returned/i)).toBeTruthy())
  })

  it('shows unavailable warning when adapter is missing', () => {
    render(<ViewDbManager adapters={{ dbManager: { isAvailable: () => false } }} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    // dialog still opens so user can load demo
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('ViewDbManager — saved connections', () => {
  let adapters

  beforeEach(() => {
    adapters = { dbManager: makeAdapter() }
  })

  afterEach(() => { cleanup() })

  const savedFields = [{
    id: 'a', name: 'UAT', type: 'sqlserver', inputMode: 'fields',
    host: 'myhost', port: '1433', database: 'mydb', user: 'sa',
    encrypt: true, trustServerCertificate: false,
  }]

  it('does not show a saved-connections section when none are given', () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    expect(screen.queryByText('Saved connections')).not.toBeTruthy()
  })

  it('lists saved connections by name and type in the connect dialog', () => {
    render(<ViewDbManager adapters={adapters} savedConnections={savedFields} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    expect(screen.getByText('Saved connections')).toBeTruthy()
    const row = dialog().getByText('UAT').closest('button')
    expect(row).toBeTruthy()
    expect(row.textContent).toContain('SQL Server')
  })

  it('connects with a saved fields-mode connection using its resolved secret', async () => {
    const onResolveSecret = vi.fn().mockResolvedValue('secret-pw')
    render(<ViewDbManager adapters={adapters} savedConnections={savedFields} onResolveSecret={onResolveSecret} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(dialog().getByText('UAT'))

    await waitFor(() => expect(adapters.dbManager.connect).toHaveBeenCalledOnce())
    expect(onResolveSecret).toHaveBeenCalledWith('a')
    expect(adapters.dbManager.connect).toHaveBeenCalledWith('sqlserver', expect.objectContaining({
      server: 'myhost', database: 'mydb', user: 'sa', password: 'secret-pw',
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeTruthy())
    // Sidebar header shows the saved connection's friendly name, not the raw database name.
    expect(screen.getByRole('tab', { name: 'UAT', selected: true })).toBeTruthy()
  })

  it('connects with a saved connection-string-mode connection using its resolved secret', async () => {
    const saved = [{ id: 'b', name: 'Prod', type: 'sqlserver', inputMode: 'connstr' }]
    const onResolveSecret = vi.fn().mockResolvedValue('mssql://user:pass@prodhost:1433/proddb')
    render(<ViewDbManager adapters={adapters} savedConnections={saved} onResolveSecret={onResolveSecret} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(dialog().getByText('Prod'))

    await waitFor(() => expect(adapters.dbManager.connect).toHaveBeenCalledOnce())
    expect(adapters.dbManager.connect).toHaveBeenCalledWith('sqlserver', expect.objectContaining({
      server: 'prodhost', database: 'proddb', user: 'user', password: 'pass',
    }))
  })

  it('shows an error toast when a saved connection fails to connect', async () => {
    adapters.dbManager.connect.mockRejectedValue(new Error('Connection refused'))
    render(<ViewDbManager adapters={adapters} savedConnections={savedFields} onResolveSecret={vi.fn().mockResolvedValue('pw')} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(dialog().getByText('UAT'))

    await waitFor(() => expect(screen.getByText('Connection refused')).toBeTruthy())
  })
})

describe('ViewDbManager — table list and connection tabs', () => {
  let adapters

  beforeEach(() => {
    adapters = { dbManager: makeAdapter() }
  })

  afterEach(() => { cleanup() })

  const connectDemo = async () => {
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Load demo'))
    await waitFor(() => screen.getByText('patients'))
  }

  it('lists tables in the sidebar and opens one on click', async () => {
    render(<ViewDbManager adapters={adapters} />)
    await connectDemo()

    const list = within(screen.getByRole('navigation', { name: 'Table list' }))
    expect(list.getByText('patients')).toBeTruthy()
    expect(list.getByText('appointments')).toBeTruthy()

    openTable('staff')
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'staff' })).toBeTruthy()
    expect(list.getByText('staff').closest('.nx-db-row').getAttribute('aria-current')).toBe('true')
  })

  it('narrows the table list with the filter box, by word starts', async () => {
    render(<ViewDbManager adapters={adapters} />)
    await connectDemo()

    fireEvent.change(screen.getByLabelText('Filter tables'), { target: { value: 'app' } })
    const list = within(screen.getByRole('navigation', { name: 'Table list' }))
    expect(list.getByText('appointments')).toBeTruthy()
    expect(list.queryByText('patients')).not.toBeTruthy()

    fireEvent.change(screen.getByLabelText('Filter tables'), { target: { value: 'zzz' } })
    fireEvent.click(list.getByText('Clear filters'))
    expect(list.getByText('patients')).toBeTruthy()
  })

  it('stars a table and shows it under Starred in the list and the overview', async () => {
    render(<ViewDbManager adapters={adapters} />)
    await connectDemo()

    fireEvent.click(screen.getByRole('button', { name: 'Star staff' }))
    const list = within(screen.getByRole('navigation', { name: 'Table list' }))
    expect(list.getByText('Starred')).toBeTruthy()
    expect(list.getAllByText('staff')).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'Starred tables' })).toBeTruthy()

    fireEvent.click(within(screen.getByRole('group', { name: 'Show tables' })).getByRole('button', { name: /^Starred/ }))
    expect(list.queryByText('patients')).not.toBeTruthy()
  })

  it('hides and shows the table list', async () => {
    render(<ViewDbManager adapters={adapters} />)
    await connectDemo()

    fireEvent.click(screen.getByText('Hide tables'))
    expect(screen.queryByRole('navigation', { name: 'Table list' })).not.toBeTruthy()
    fireEvent.click(screen.getByText('Show tables'))
    expect(screen.getByRole('navigation', { name: 'Table list' })).toBeTruthy()
  })

  it('shows only the current connection as a tab when no connections are saved', async () => {
    render(<ViewDbManager adapters={adapters} />)
    await connectDemo()
    const tabs = within(screen.getByRole('tablist', { name: 'Connections' })).getAllByRole('tab')
    expect(tabs.map(t => t.textContent)).toEqual(['Demo'])
  })

  it('lists saved connections as tabs in the header once connected', async () => {
    const saved = [{ id: 'a', name: 'UAT', type: 'sqlserver' }, { id: 'b', name: 'Prod', type: 'sqlserver' }]
    render(<ViewDbManager adapters={adapters} savedConnections={saved} />)
    await connectDemo()

    const tabs = within(screen.getByRole('tablist', { name: 'Connections' }))
    expect(tabs.getByRole('tab', { name: 'Demo', selected: true })).toBeTruthy()
    expect(tabs.getByRole('tab', { name: 'UAT', selected: false })).toBeTruthy()
    expect(tabs.getByRole('tab', { name: 'Prod', selected: false })).toBeTruthy()
  })

  it('switches to a different saved database directly from the header', async () => {
    const saved = [{ id: 'a', name: 'UAT', type: 'sqlite', inputMode: 'fields', filePath: '/a.db' }]
    const onResolveSecret = vi.fn().mockResolvedValue('')
    // "Load demo" never calls db.connect (it uses in-memory demo data), so this
    // resolves the one real connect() call — switching to the saved connection.
    adapters.dbManager.connect.mockResolvedValueOnce({ ok: true, tables: ['orders'] })
    render(<ViewDbManager adapters={adapters} savedConnections={saved} onResolveSecret={onResolveSecret} />)
    await connectDemo()

    fireEvent.click(screen.getByRole('tab', { name: 'UAT' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'UAT', selected: true })).toBeTruthy())
    expect(screen.getByText('orders')).toBeTruthy()
  })

  it('offers saved connections on the welcome screen for one-click connect', async () => {
    const saved = [{ id: 'a', name: 'UAT', type: 'sqlite', inputMode: 'fields', filePath: '/a.db' }]
    render(<ViewDbManager adapters={adapters} savedConnections={saved} onResolveSecret={vi.fn().mockResolvedValue('')} />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Quick connect' })).getByText('UAT'))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'UAT', selected: true })).toBeTruthy())
    expect(adapters.dbManager.connect).toHaveBeenCalledWith('sqlite', expect.objectContaining({ filePath: '/a.db' }))
  })

  it('loads the demo straight from the welcome screen', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText('Try the demo'))
    await waitFor(() => screen.getByText('patients'))
    expect(screen.queryByRole('dialog')).not.toBeTruthy()
  })
})

describe('ViewDbManager — several open connections', () => {
  let adapters

  beforeEach(() => {
    adapters = { dbManager: makeAdapter() }
  })

  afterEach(() => { cleanup() })

  const saved = [
    { id: 'a', name: 'UAT', type: 'sqlite', inputMode: 'fields', filePath: '/a.db' },
    { id: 'b', name: 'Prod', type: 'sqlite', inputMode: 'fields', filePath: '/b.db' },
  ]
  const connTabs = () => within(screen.getByRole('tablist', { name: 'Connections' }))

  // Opens UAT from the welcome screen, then Prod from the header, so both are open.
  async function openBoth() {
    adapters.dbManager.connect
      .mockResolvedValueOnce({ ok: true, tables: ['uat_orders'] })
      .mockResolvedValueOnce({ ok: true, tables: ['prod_orders'] })
    render(<ViewDbManager adapters={adapters} savedConnections={saved} onResolveSecret={vi.fn().mockResolvedValue('')} />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Quick connect' })).getByText('UAT'))
    await waitFor(() => expect(connTabs().getByRole('tab', { name: 'UAT', selected: true })).toBeTruthy())
    fireEvent.click(connTabs().getByRole('tab', { name: 'Prod' }))
    await waitFor(() => expect(connTabs().getByRole('tab', { name: 'Prod', selected: true })).toBeTruthy())
  }

  it('keeps the first connection open when a second one connects', async () => {
    await openBoth()
    expect(adapters.dbManager.connect).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('navigation', { name: 'Table list' }).textContent).toContain('prod_orders')
    expect(screen.getByRole('button', { name: 'Close UAT' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close Prod' })).toBeTruthy()
  })

  it('switches between open connections without reconnecting, keeping the open table', async () => {
    await openBoth()
    fireEvent.click(connTabs().getByRole('tab', { name: 'UAT' }))
    openTable('uat_orders')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'uat_orders' })).toBeTruthy())

    fireEvent.click(connTabs().getByRole('tab', { name: 'Prod' }))
    expect(screen.queryByRole('heading', { name: 'uat_orders' })).not.toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Table list' }).textContent).toContain('prod_orders')

    fireEvent.click(connTabs().getByRole('tab', { name: 'UAT' }))
    expect(screen.getByRole('heading', { name: 'uat_orders' })).toBeTruthy()
    expect(adapters.dbManager.connect).toHaveBeenCalledTimes(2)
  })

  it('switches to an already-open connection picked in the connect dialog instead of connecting again', async () => {
    await openBoth()
    fireEvent.click(screen.getByRole('button', { name: 'New connection' }))
    fireEvent.click(dialog().getByText('UAT'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeTruthy())
    expect(connTabs().getByRole('tab', { name: 'UAT', selected: true })).toBeTruthy()
    expect(adapters.dbManager.connect).toHaveBeenCalledTimes(2)
  })

  it('closes one connection and shows its neighbour; closing the last shows the welcome pane', async () => {
    await openBoth()
    fireEvent.click(screen.getByRole('button', { name: 'Close Prod' }))
    expect(connTabs().getByRole('tab', { name: 'UAT', selected: true })).toBeTruthy()
    // Prod is still saved, so it stays in the strip, ready to connect again.
    expect(connTabs().getByRole('tab', { name: 'Prod', selected: false })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Close Prod' })).not.toBeTruthy()

    fireEvent.click(screen.getByText('Disconnect'))
    expect(screen.getByText('Database Manager')).toBeTruthy()
  })

  it('opens the demo alongside a real connection', async () => {
    render(<ViewDbManager adapters={adapters} savedConnections={saved} onResolveSecret={vi.fn().mockResolvedValue('')} />)
    fireEvent.click(screen.getByText('Try the demo'))
    await waitFor(() => screen.getByText('patients'))
    fireEvent.click(connTabs().getByRole('tab', { name: 'UAT' }))
    await waitFor(() => expect(connTabs().getByRole('tab', { name: 'UAT', selected: true })).toBeTruthy())
    expect(connTabs().getByRole('tab', { name: 'Demo', selected: false })).toBeTruthy()
  })
})

describe('ViewDbManager — browsing rows', () => {
  let adapters

  beforeEach(() => {
    adapters = { dbManager: makeAdapter() }
  })

  afterEach(() => { cleanup() })

  const openDemoPatients = async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText('Try the demo'))
    await waitFor(() => screen.getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))
  }
  const bodyNames = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map(r => r.children[2]?.textContent)

  it('deletes the row that was ticked while a search is active, not the one at the same position', async () => {
    await openDemoPatients()
    fireEvent.change(screen.getByPlaceholderText('Search rows…'), { target: { value: 'Carol' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    fireEvent.click(screen.getByText(/Delete 1 row/i))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Delete'))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('Search rows…'), { target: { value: '' } })
    expect(bodyNames()).toEqual(['Alice Johnson', 'Bob Smith', 'David Brown'])
  })

  it('deletes by the primary key column on a real connection', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('SQLite'))
    fireEvent.click(screen.getByRole('tab', { name: 'Connection string' }))
    fireEvent.change(screen.getByLabelText(/connection string/i), { target: { value: 'sqlite:///test/data.db' } })
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => screen.getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))

    fireEvent.change(screen.getByPlaceholderText('Search rows…'), { target: { value: 'Bob' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete row 1' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Delete'))
    await waitFor(() => expect(adapters.dbManager.deleteRows).toHaveBeenCalledWith(
      'sqlite', expect.objectContaining({ filePath: 'test/data.db' }), 'patients', 'id', [2],
    ))
  })

  it('edits the cell that was double-clicked while a search is active', async () => {
    await openDemoPatients()
    fireEvent.change(screen.getByPlaceholderText('Search rows…'), { target: { value: 'David' } })
    fireEvent.doubleClick(screen.getByText('pending'))
    const input = screen.getByLabelText('Edit status')
    fireEvent.change(input, { target: { value: 'active' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.queryByLabelText('Edit status')).not.toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('Search rows…'), { target: { value: '' } })
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows[3].textContent).toContain('David Brown')
    expect(rows[3].textContent).toContain('active')
    expect(rows[0].textContent).toContain('active')
    expect(rows[1].textContent).toContain('inactive')
  })

  it('writes nothing when a cell is left unchanged', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('SQLite'))
    fireEvent.click(screen.getByRole('tab', { name: 'Connection string' }))
    fireEvent.change(screen.getByLabelText(/connection string/i), { target: { value: 'sqlite:///test/data.db' } })
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => screen.getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))

    fireEvent.doubleClick(screen.getByText('Alice'))
    fireEvent.keyDown(screen.getByLabelText('Edit name'), { key: 'Enter' })
    await waitFor(() => expect(screen.queryByLabelText('Edit name')).not.toBeTruthy())
    expect(adapters.dbManager.updateCell).not.toHaveBeenCalled()
  })

  it('keeps demo edits when the table is opened again', async () => {
    await openDemoPatients()
    fireEvent.doubleClick(screen.getByText('Bob Smith'))
    const input = screen.getByLabelText('Edit name')
    fireEvent.change(input, { target: { value: 'Robert Smith' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => screen.getByText('Robert Smith'))

    openTable('staff')
    await waitFor(() => screen.getByText('Dr. Sarah Lee'))
    openTable('patients')
    await waitFor(() => expect(screen.getByText('Robert Smith')).toBeTruthy())
  })

  it('sorts by a column: ascending, descending, then back to the original order', async () => {
    await openDemoPatients()
    const header = screen.getByRole('button', { name: /^name/i })
    fireEvent.click(header)
    expect(bodyNames()).toEqual(['Alice Johnson', 'Bob Smith', 'Carol White', 'David Brown'])
    fireEvent.click(header)
    expect(bodyNames()).toEqual(['David Brown', 'Carol White', 'Bob Smith', 'Alice Johnson'])
    fireEvent.click(header)
    expect(bodyNames()).toEqual(['Alice Johnson', 'Bob Smith', 'Carol White', 'David Brown'])

    fireEvent.click(screen.getByRole('button', { name: /^dob/i }))
    expect(bodyNames()).toEqual(['David Brown', 'Bob Smith', 'Alice Johnson', 'Carol White'])
  })

  it('select all ticks only the rows the search shows', async () => {
    await openDemoPatients()
    fireEvent.change(screen.getByPlaceholderText('Search rows…'), { target: { value: 'active' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
    // "active" also matches "inactive" — Alice, Bob and Carol.
    expect(screen.getByText(/Delete 3 rows/i)).toBeTruthy()
  })

  it('goes back to the overview from the breadcrumb and lists the table as recently opened', async () => {
    await openDemoPatients()
    fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
    expect(screen.queryByRole('table')).not.toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Recently opened' })).getByText('patients')).toBeTruthy()
  })
})

describe('ViewDbManager — minimised columns', () => {
  let adapters

  beforeEach(() => {
    adapters = { dbManager: makeAdapter() }
  })

  afterEach(() => { cleanup() })

  const saved = [{ id: 'uat', name: 'UAT', type: 'sqlite', inputMode: 'fields', filePath: '/a.db' }]
  const openUatPatients = async () => {
    render(<ViewDbManager adapters={adapters} savedConnections={saved} onResolveSecret={vi.fn().mockResolvedValue('')} />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Quick connect' })).getByText('UAT'))
    await waitFor(() => within(screen.getByRole('navigation', { name: 'Table list' })).getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))
  }

  it('minimises a column to a sideways header; search and Copy row still use its values', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.assign(navigator, { clipboard: { writeText } })
    await openUatPatients()
    fireEvent.click(screen.getByRole('button', { name: 'Minimise name' }))

    expect(screen.getByRole('button', { name: 'Show name' }).closest('th').className).toContain('min')
    expect(screen.queryByRole('button', { name: /^name/i })).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Search rows…'), { target: { value: 'Bob' } })
    expect(screen.getByText('1 of 2 matching')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy row 1' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('2\tBob'))
  })

  it('is still minimised when the table is reopened', async () => {
    await openUatPatients()
    fireEvent.click(screen.getByRole('button', { name: 'Minimise name' }))
    fireEvent.click(screen.getByRole('button', { name: 'UAT' }))
    expect(screen.queryByRole('table')).toBeNull()
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))
    expect(screen.getByRole('button', { name: 'Show name' })).toBeTruthy()
    expect(JSON.parse(window.localStorage.getItem('nx-db:min-cols:uat:patients'))).toEqual(['name'])
  })

  it('ignores remembered names the table no longer has', async () => {
    window.localStorage.setItem('nx-db:min-cols:uat:patients', JSON.stringify(['gone', 'name']))
    await openUatPatients()
    expect(screen.getByRole('button', { name: 'Show name' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show gone' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Show all minimised columns' }).textContent).toBe('1 minimised · Show all')
  })

  it('shows every column again from the toolbar', async () => {
    await openUatPatients()
    expect(screen.queryByRole('button', { name: 'Show all minimised columns' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Minimise name' }))
    fireEvent.click(screen.getByRole('button', { name: 'Minimise id' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show all minimised columns' }))
    expect(screen.queryByRole('button', { name: /^Show (name|id)$/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^name/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show all minimised columns' })).toBeNull()
  })

  it('shows one column again by clicking its header', async () => {
    await openUatPatients()
    fireEvent.click(screen.getByRole('button', { name: 'Minimise name' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show name' }))
    expect(screen.getByRole('button', { name: /^name/i })).toBeTruthy()
  })
})

describe('ViewDbManager — query command builders', () => {
  let adapters

  beforeEach(() => {
    adapters = { dbManager: makeAdapter() }
  })

  afterEach(() => { cleanup() })

  const openQueryTabForPatients = async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Load demo'))
    await waitFor(() => screen.getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))
    fireEvent.click(screen.getByRole('tab', { name: 'Query' }))
    const tableSelects = screen.getAllByLabelText('Tables')
    fireEvent.change(tableSelects[tableSelects.length - 1], { target: { value: 'patients' } })
  }

  it('builds a SEARCH query from a condition row', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Search'))
    await waitFor(() => screen.getByLabelText('Column'))

    fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'status' } })
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: '=' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'active' } })
    fireEvent.click(screen.getByText('Build'))

    expect(screen.getByLabelText('SQL query').value).toBe("SELECT * FROM [patients]\nWHERE [status] = 'active'")
  })

  it('fetches column metadata through the adapter for a real (non-demo) connection', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('SQLite'))
    fireEvent.click(screen.getByRole('tab', { name: 'Connection string' }))
    fireEvent.change(screen.getByLabelText(/connection string/i), {
      target: { value: 'sqlite:///test/data.db' },
    })
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => screen.getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))

    fireEvent.click(screen.getByRole('tab', { name: 'Query' }))
    const tableSelects = screen.getAllByLabelText('Tables')
    fireEvent.change(tableSelects[tableSelects.length - 1], { target: { value: 'patients' } })
    fireEvent.click(screen.getByText('Search'))

    await waitFor(() => expect(adapters.dbManager.getColumns).toHaveBeenCalledWith(
      'sqlite', expect.objectContaining({ filePath: 'test/data.db' }), 'patients',
    ))
    expect(screen.getByLabelText('Column')).toBeTruthy()
  })

  it('keeps the JOIN builder mounted while loading the right table columns on a real connection', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('SQLite'))
    fireEvent.click(screen.getByRole('tab', { name: 'Connection string' }))
    fireEvent.change(screen.getByLabelText(/connection string/i), {
      target: { value: 'sqlite:///test/data.db' },
    })
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => screen.getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))

    fireEvent.click(screen.getByRole('tab', { name: 'Query' }))
    const tableSelects = screen.getAllByLabelText('Tables')
    fireEvent.change(tableSelects[tableSelects.length - 1], { target: { value: 'patients' } })
    fireEvent.click(screen.getByText('Join'))
    await waitFor(() => screen.getByLabelText('Join table'))

    fireEvent.change(screen.getByLabelText('Join table'), { target: { value: 'staff' } })

    // The right table's columns are fetched asynchronously through the
    // adapter — the builder (and its already-chosen left/right state) must
    // stay mounted through that await, not get unmounted by the panel-level
    // "Loading columns…" gate.
    await waitFor(() => expect(screen.getByLabelText('Right column')).toBeTruthy())
    expect(screen.getByLabelText('Join table').value).toBe('staff')

    fireEvent.change(screen.getByLabelText('Join type'), { target: { value: 'LEFT' } })
    fireEvent.change(screen.getByLabelText('Left column'), { target: { value: 'id' } })
    fireEvent.change(screen.getByLabelText('Right column'), { target: { value: 'name' } })
    fireEvent.click(screen.getByText('Build'))

    expect(screen.getByLabelText('SQL query').value).toBe(
      'SELECT * FROM [patients]\nLEFT JOIN [staff] ON [patients].[id] = [staff].[name]',
    )
  })

  it('builds a DELETE query from a condition row', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => screen.getByLabelText('Column'))

    fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'id' } })
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: '=' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '1' } })
    fireEvent.click(screen.getByText('Build'))

    expect(screen.getByLabelText('SQL query').value).toBe('DELETE FROM [patients]\nWHERE [id] = 1')
  })

  it('builds an INSERT query from checked columns', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Insert'))
    await waitFor(() => screen.getByLabelText('Include name'))

    fireEvent.click(screen.getByLabelText('Include name'))
    fireEvent.change(screen.getByLabelText('Value for name'), { target: { value: 'Alice' } })
    fireEvent.click(screen.getByText('Build'))

    expect(screen.getByLabelText('SQL query').value).toBe("INSERT INTO [patients] ([name]) VALUES ('Alice')")
  })

  it('builds an UPDATE query with SET and WHERE clauses', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Update'))
    await waitFor(() => screen.getByLabelText('Include status'))

    fireEvent.click(screen.getByLabelText('Include status'))
    fireEvent.change(screen.getByLabelText('Value for status'), { target: { value: 'inactive' } })
    fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'id' } })
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: '=' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '1' } })
    fireEvent.click(screen.getByText('Build'))

    expect(screen.getByLabelText('SQL query').value).toBe("UPDATE [patients] SET [status] = 'inactive'\nWHERE [id] = 1")
  })

  it('builds a JOIN query across two tables', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Join'))
    await waitFor(() => screen.getByLabelText('Join table'))

    fireEvent.change(screen.getByLabelText('Join table'), { target: { value: 'staff' } })
    await waitFor(() => screen.getByLabelText('Left column'))
    fireEvent.change(screen.getByLabelText('Join type'), { target: { value: 'LEFT' } })
    fireEvent.change(screen.getByLabelText('Left column'), { target: { value: 'id' } })
    fireEvent.change(screen.getByLabelText('Right column'), { target: { value: 'name' } })
    fireEvent.click(screen.getByText('Build'))

    expect(screen.getByLabelText('SQL query').value).toBe(
      'SELECT * FROM [patients]\nLEFT JOIN [staff] ON [patients].[id] = [staff].[name]',
    )
  })

  it('builds an AGGREGATE query with a function, column, and GROUP BY', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Aggregate'))
    await waitFor(() => screen.getByLabelText('Function'))

    fireEvent.change(screen.getByLabelText('Function'), { target: { value: 'COUNT' } })
    fireEvent.change(screen.getByLabelText('Aggregate column'), { target: { value: 'id' } })
    fireEvent.click(screen.getByLabelText('Group by status'))
    fireEvent.click(screen.getByText('Build'))

    expect(screen.getByLabelText('SQL query').value).toBe('SELECT COUNT([id]), [status] FROM [patients]\nGROUP BY [status]')
  })

  it('clears cached columns and the in-progress query when switching connections', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Search'))
    await waitFor(() => screen.getByLabelText('Column'))
    // Demo 'patients' columns include 'dob' (see DEMO.data.patients.columns).
    expect(screen.getByRole('option', { name: 'dob' })).toBeTruthy()
    fireEvent.click(screen.getByText('Cancel'))

    // Disconnect, then connect to a real (SQLite) DB whose 'patients' table
    // has a different column set (no 'dob') per the adapter mock.
    fireEvent.click(screen.getByText('Disconnect'))
    await waitFor(() => screen.getByText(/Connect to database/i))

    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('SQLite'))
    fireEvent.click(screen.getByRole('tab', { name: 'Connection string' }))
    fireEvent.change(screen.getByLabelText(/connection string/i), {
      target: { value: 'sqlite:///test/data.db' },
    })
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => screen.getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))

    fireEvent.click(screen.getByRole('tab', { name: 'Query' }))
    // The query textarea should have been reset, not still showing whatever
    // was left over from the previous connection's builder session.
    expect(screen.getByLabelText('SQL query').value).toBe('')

    const tableSelects = screen.getAllByLabelText('Tables')
    fireEvent.change(tableSelects[tableSelects.length - 1], { target: { value: 'patients' } })
    fireEvent.click(screen.getByText('Search'))

    await waitFor(() => expect(adapters.dbManager.getColumns).toHaveBeenCalledWith(
      'sqlite', expect.objectContaining({ filePath: 'test/data.db' }), 'patients',
    ))
    await waitFor(() => screen.getByLabelText('Column'))
    expect(screen.queryByRole('option', { name: 'dob' })).not.toBeTruthy()
    expect(screen.getByRole('option', { name: 'status' })).toBeTruthy()
  })

  it('closes the builder panel when its command button is clicked again', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Search'))
    await waitFor(() => screen.getByLabelText('Column'))
    fireEvent.click(screen.getByText('Search'))
    expect(screen.queryByLabelText('Column')).not.toBeTruthy()
  })

  it('cancel closes the panel without changing the textarea', async () => {
    await openQueryTabForPatients()
    const before = screen.getByLabelText('SQL query').value

    fireEvent.click(screen.getByText('Search'))
    await waitFor(() => screen.getByLabelText('Column'))
    fireEvent.click(screen.getByText('Cancel'))

    expect(screen.queryByLabelText('Column')).not.toBeTruthy()
    expect(screen.getByLabelText('SQL query').value).toBe(before)
  })
})

describe('ViewDbManager — saved queries', () => {
  let adapters

  beforeEach(() => {
    adapters = { dbManager: makeAdapter() }
  })

  afterEach(() => { cleanup() })

  const demoQueryTab = async (table = 'patients') => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText('Try the demo'))
    await waitFor(() => screen.getByRole('navigation', { name: 'Table list' }))
    openTable(table)
    await waitFor(() => screen.getByRole('table'))
    fireEvent.click(screen.getByRole('tab', { name: 'Query' }))
  }
  const saveAs = (name, { anyTable = true } = {}) => {
    fireEvent.click(screen.getByRole('button', { name: 'Save…' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
    if (!anyTable) fireEvent.click(screen.getByLabelText('Use for any table'))
    fireEvent.click(screen.getByText('Save query'))
  }

  it('saves a query for any table and runs it against another table from the header', async () => {
    await demoQueryTab()
    fireEvent.change(screen.getByLabelText('SQL query'), { target: { value: "SELECT * FROM patients WHERE status = 'active'" } })
    saveAs('Active rows')
    expect(JSON.parse(window.localStorage.getItem('nx-db:saved-queries'))[0]).toMatchObject({
      name: 'Active rows', sql: "SELECT * FROM {table} WHERE status = 'active'", conn: null,
    })

    openTable('appointments')
    await waitFor(() => screen.getByRole('heading', { name: 'appointments' }))
    const menu = within(screen.getByText('Run saved').closest('details'))
    fireEvent.click(screen.getByText('Run saved'))
    fireEvent.click(menu.getByText('Active rows'))

    await waitFor(() => expect(screen.getByText(/rows returned/i)).toBeTruthy())
    expect(screen.getByLabelText('SQL query').value).toBe("SELECT * FROM [appointments] WHERE status = 'active'")
    expect(screen.getByRole('tab', { name: 'Query', selected: true })).toBeTruthy()
  })

  it('runs a saved query against the table picked in the Query tab', async () => {
    await demoQueryTab()
    fireEvent.change(screen.getByLabelText('SQL query'), { target: { value: 'SELECT * FROM patients' } })
    saveAs('Everything')
    fireEvent.change(screen.getByLabelText('Tables'), { target: { value: 'staff' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run Everything' }))
    await waitFor(() => expect(screen.getByText(/3 rows returned/i)).toBeTruthy())
    expect(screen.getByLabelText('SQL query').value).toBe('SELECT * FROM [staff]')
  })

  it('keeps saved queries after the page is opened again, and removes them', async () => {
    await demoQueryTab()
    fireEvent.change(screen.getByLabelText('SQL query'), { target: { value: 'SELECT * FROM patients' } })
    saveAs('Everything')
    cleanup()

    await demoQueryTab('staff')
    expect(screen.getByRole('button', { name: 'Run Everything' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Everything' }))
    expect(screen.queryByRole('button', { name: 'Run Everything' })).not.toBeTruthy()
    expect(JSON.parse(window.localStorage.getItem('nx-db:saved-queries'))).toEqual([])
  })

  it('saving under an existing name replaces that query', async () => {
    await demoQueryTab()
    fireEvent.change(screen.getByLabelText('SQL query'), { target: { value: 'SELECT * FROM patients' } })
    saveAs('Mine')
    fireEvent.change(screen.getByLabelText('SQL query'), { target: { value: 'SELECT id FROM patients' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save…' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'mine' } })
    expect(screen.getByText(/Replaces the saved query/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    const saved = JSON.parse(window.localStorage.getItem('nx-db:saved-queries'))
    expect(saved).toHaveLength(1)
    expect(saved[0].sql).toBe('SELECT id FROM {table}')
  })

  it('keeps a query that is not for any table to its own connection', async () => {
    await demoQueryTab()
    fireEvent.change(screen.getByLabelText('SQL query'), { target: { value: 'SELECT * FROM patients' } })
    saveAs('Just patients', { anyTable: false })
    expect(JSON.parse(window.localStorage.getItem('nx-db:saved-queries'))[0]).toMatchObject({ sql: 'SELECT * FROM patients', conn: 'demo:/' })

    fireEvent.click(screen.getByText('Disconnect'))
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('SQLite'))
    fireEvent.click(screen.getByRole('tab', { name: 'Connection string' }))
    fireEvent.change(screen.getByLabelText(/connection string/i), { target: { value: 'sqlite:///test/data.db' } })
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => screen.getByText('patients'))
    expect(screen.queryByText('Just patients')).not.toBeTruthy()
  })

  it('runs a saved query from the overview on the table chosen there', async () => {
    window.localStorage.setItem('nx-db:saved-queries', JSON.stringify([{ id: 'q1', name: 'Count', sql: 'SELECT * FROM {table}', conn: null, at: 1 }]))
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText('Try the demo'))
    await waitFor(() => screen.getByRole('region', { name: 'Saved queries' }))
    fireEvent.change(screen.getByLabelText('Table for Count'), { target: { value: 'staff' } })
    fireEvent.click(within(screen.getByRole('region', { name: 'Saved queries' })).getByRole('button', { name: /^Run$/ }))
    await waitFor(() => expect(screen.getByText(/3 rows returned/i)).toBeTruthy())
    expect(screen.getByLabelText('SQL query').value).toBe('SELECT * FROM [staff]')
  })
})

describe('ViewDbManager — grouping, favourites and hiding tables', () => {
  let adapters

  beforeEach(() => {
    adapters = { dbManager: makeAdapter() }
  })

  afterEach(() => { cleanup() })

  const saved = [{ id: 'uat', name: 'UAT', type: 'sqlite', inputMode: 'fields', filePath: '/a.db' }]
  const list = () => within(screen.getByRole('navigation', { name: 'Table list' }))
  const prefsOf = conn => JSON.parse(window.localStorage.getItem(`nx-db:tables:${conn}`))
  // The newest open menu (a flyout opens on top of its parent).
  const topMenu = () => within(screen.getAllByRole('menu').at(-1))
  const openMenu = label => { fireEvent.click(list().getByRole('button', { name: label })); return topMenu() }
  const openSub = (menu, item) => { fireEvent.click(menu.getByRole('menuitem', { name: item })); return topMenu() }

  async function connectUat() {
    render(<ViewDbManager adapters={adapters} savedConnections={saved} onResolveSecret={vi.fn().mockResolvedValue('')} />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Quick connect' })).getByText('UAT'))
    await waitFor(() => expect(list().getAllByText('patients').length).toBeGreaterThan(0))
  }

  // Types a new group name into a table's "Move to group" flyout and adds the table to it.
  function moveToNewGroup(table, group) {
    const sub = openSub(openMenu(`More for ${table}`), /^Move to group/)
    fireEvent.change(sub.getByLabelText('New group name'), { target: { value: group } })
    fireEvent.click(sub.getByRole('button', { name: 'Add' }))
  }

  it('moves a table into a new group of its own and saves it for the connection', async () => {
    await connectUat()
    moveToNewGroup('staff', 'People')

    expect(screen.queryByRole('menu')).not.toBeTruthy()
    const group = list().getByRole('button', { name: /People/, expanded: true })
    expect(within(group.closest('.nx-db-group')).getByText('staff')).toBeTruthy()
    expect(prefsOf('uat')).toMatchObject({ groups: ['People'], assigned: { staff: 'People' } })
  })

  it('moves a table into an existing group, then back out', async () => {
    await connectUat()
    moveToNewGroup('staff', 'People')
    fireEvent.click(openSub(openMenu('More for patients'), /^Move to group/).getByRole('menuitemcheckbox', { name: 'People' }))
    expect(prefsOf('uat').assigned).toEqual({ staff: 'People', patients: 'People' })

    const sub = openSub(openMenu('More for staff'), /^Move to group · People/)
    expect(sub.getByRole('menuitemcheckbox', { name: 'People' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sub.getByRole('menuitem', { name: 'Remove from People' }))
    expect(prefsOf('uat').assigned).toEqual({ patients: 'People' })
  })

  it('renames and ungroups a group from its menu', async () => {
    await connectUat()
    moveToNewGroup('staff', 'People')
    const rename = openSub(openMenu('Edit group People'), 'Rename group')
    fireEvent.change(rename.getByLabelText('Group name'), { target: { value: 'Team' } })
    fireEvent.click(rename.getByRole('button', { name: 'Rename' }))
    expect(prefsOf('uat')).toMatchObject({ groups: ['Team'], assigned: { staff: 'Team' } })

    fireEvent.click(openMenu('Edit group Team').getByRole('menuitem', { name: 'Ungroup tables' }))
    expect(prefsOf('uat')).toMatchObject({ groups: [], assigned: {} })
    expect(list().queryByLabelText('Edit group Team')).not.toBeTruthy()
  })

  it('hides a table from the list and shows it under Hidden, then brings it back', async () => {
    await connectUat()
    fireEvent.click(openMenu('More for staff').getByRole('menuitem', { name: 'Hide from the table list' }))

    expect(list().queryByText('staff')).not.toBeTruthy()
    expect(prefsOf('uat').hidden).toEqual(['staff'])
    fireEvent.click(within(screen.getByRole('group', { name: 'Show tables' })).getByRole('button', { name: /^Hidden/ }))
    expect(list().getByText('staff')).toBeTruthy()
    expect(list().queryByText('patients')).not.toBeTruthy()

    fireEvent.click(openMenu('More for staff').getByRole('menuitem', { name: 'Show in the table list' }))
    expect(prefsOf('uat').hidden).toEqual([])
  })

  it('opens the same menu with a right-click, and closes it with Escape', async () => {
    await connectUat()
    fireEvent.contextMenu(list().getByText('staff').closest('.nx-db-row'))
    const menu = topMenu()
    expect(menu.getByText('staff')).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: /^Move to group/ }).getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeTruthy()
  })

  it('opens a section menu with a right-click on its header: fold it, fold the others, group or hide its tables', async () => {
    window.localStorage.setItem('nx-db:tables:uat', JSON.stringify({ groups: ['People'], assigned: { staff: 'People' } }))
    await connectUat()
    fireEvent.contextMenu(list().getByRole('button', { name: /People/, expanded: true }))
    fireEvent.click(topMenu().getByRole('menuitem', { name: 'Collapse the others' }))
    expect(prefsOf('uat').collapsed).toEqual(['schema:'])

    fireEvent.contextMenu(list().getByRole('button', { name: /Tables/, expanded: false }))
    fireEvent.click(topMenu().getByRole('menuitem', { name: 'Hide all 1' }))
    expect(prefsOf('uat').hidden).toEqual(['patients'])
  })

  it('moves every table in a schema section into a group at once', async () => {
    await connectUat()
    const sub = openSub(openMenu('More for Tables'), 'Move all 2 to group')
    fireEvent.change(sub.getByLabelText('New group name'), { target: { value: 'Core' } })
    fireEvent.click(sub.getByRole('button', { name: 'Add' }))
    expect(prefsOf('uat').assigned).toEqual({ patients: 'Core', staff: 'Core' })
  })

  it('copies a table’s name and a SELECT for it, and counts its rows', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.assign(navigator, { clipboard: { writeText } })
    adapters.dbManager.runQuery.mockResolvedValue({ columns: ['n'], rows: [[1234]], affected: null })
    await connectUat()
    fireEvent.click(openMenu('More for staff').getByRole('menuitem', { name: 'Copy name' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('staff'))
    fireEvent.click(openMenu('More for staff').getByRole('menuitem', { name: 'Copy SELECT statement' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('SELECT * FROM [staff] LIMIT 100'))
    fireEvent.click(openMenu('More for staff').getByRole('menuitem', { name: 'Count rows' }))
    await waitFor(() => expect(screen.getByText(/staff: 1,234 rows/)).toBeTruthy())
    expect(adapters.dbManager.runQuery).toHaveBeenCalledWith('sqlite', expect.anything(), 'SELECT COUNT(*) AS n FROM [staff]')
  })

  it('quotes a table in another schema as [schema].[table]', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.assign(navigator, { clipboard: { writeText } })
    adapters.dbManager.connect.mockResolvedValue({ ok: true, tables: ['patients', 'maintenance.DirectDebitEmailHistory'] })
    adapters.dbManager.runQuery.mockResolvedValue({ columns: ['n'], rows: [[4]], affected: null })
    await connectUat()
    const more = 'More for maintenance.DirectDebitEmailHistory'
    fireEvent.click(openMenu(more).getByRole('menuitem', { name: 'Copy SELECT statement' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('SELECT * FROM [maintenance].[DirectDebitEmailHistory] LIMIT 100'))
    fireEvent.click(openMenu(more).getByRole('menuitem', { name: 'Count rows' }))
    await waitFor(() => expect(adapters.dbManager.runQuery).toHaveBeenCalledWith('sqlite', expect.anything(), 'SELECT COUNT(*) AS n FROM [maintenance].[DirectDebitEmailHistory]'))
  })

  it('remembers favourites, groups, hidden tables and folded groups the next time the connection opens', async () => {
    window.localStorage.setItem('nx-db:tables:uat', JSON.stringify({
      starred: ['patients'], hidden: ['staff'], groups: ['Clinical'], assigned: { patients: 'Clinical' }, collapsed: [],
    }))
    await connectUat()
    expect(list().getByText('Starred')).toBeTruthy()
    expect(list().queryByText('staff')).not.toBeTruthy()

    fireEvent.click(list().getByRole('button', { name: /Clinical/, expanded: true }))
    expect(prefsOf('uat').collapsed).toEqual(['group:Clinical'])
  })

  it('picks up stars saved before groups existed', async () => {
    window.localStorage.setItem('nx-db:starred:uat', JSON.stringify(['staff']))
    await connectUat()
    expect(screen.getAllByRole('button', { name: 'Unstar staff' }).length).toBeGreaterThan(0)
  })

  it('folds every group with one button, which then unfolds them all, and remembers it', async () => {
    window.localStorage.setItem('nx-db:tables:uat', JSON.stringify({ groups: ['People'], assigned: { staff: 'People' }, collapsed: [] }))
    await connectUat()
    expect(list().queryByRole('button', { name: 'Expand all' })).not.toBeTruthy()
    fireEvent.click(list().getByRole('button', { name: 'Collapse all' }))
    expect(prefsOf('uat').collapsed).toEqual(['group:People', 'schema:'])
    expect(list().queryByText('patients')).not.toBeTruthy()

    fireEvent.click(list().getByRole('button', { name: 'Expand all' }))
    expect(prefsOf('uat').collapsed).toEqual([])
    expect(list().getByText('patients')).toBeTruthy()
  })

  it('offers no fold-all button when the list has a single section', async () => {
    await connectUat()
    expect(list().queryByRole('button', { name: /Collapse all|Expand all/ })).not.toBeTruthy()
  })

  it('keeps preferences apart per connection', async () => {
    window.localStorage.setItem('nx-db:tables:other', JSON.stringify({ hidden: ['staff'] }))
    await connectUat()
    expect(list().getByText('staff')).toBeTruthy()
  })
})

describe('ViewDbManager — creating and dropping tables and views', () => {
  let adapters
  const saved = [{ id: 'uat', name: 'UAT', type: 'sqlite', inputMode: 'fields', filePath: '/a.db' }]

  beforeEach(() => {
    adapters = { dbManager: makeAdapter({
      connect: vi.fn().mockResolvedValue({ ok: true, tables: ['active_staff', 'patients', 'staff'], views: ['active_staff'] }),
      runDdl: vi.fn().mockResolvedValue({ ok: true }),
    }) }
  })

  afterEach(() => { cleanup() })

  const list = () => within(screen.getByRole('navigation', { name: 'Table list' }))
  const topMenu = () => within(screen.getAllByRole('menu').at(-1))
  const dialog = () => within(screen.getByRole('dialog'))

  async function connectUat() {
    render(<ViewDbManager adapters={adapters} savedConnections={saved} onResolveSecret={vi.fn().mockResolvedValue('')} />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Quick connect' })).getByText('UAT'))
    await waitFor(() => expect(list().getAllByText('patients').length).toBeGreaterThan(0))
  }

  it('lists views in their own section, tagged', async () => {
    await connectUat()
    const views = list().getByRole('button', { name: /Views/, expanded: true }).closest('.nx-db-group')
    expect(within(views).getByText('active_staff')).toBeTruthy()
    expect(within(views).getByText('view')).toBeTruthy()
  })

  it('designs a table, shows the SQL it will run, creates it and opens it', async () => {
    adapters.dbManager.connect
      .mockResolvedValueOnce({ ok: true, tables: ['patients'], views: [] })
      .mockResolvedValueOnce({ ok: true, tables: ['note', 'patients'], views: [] })
    await connectUat()
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    fireEvent.click(topMenu().getByRole('menuitem', { name: 'New table…' }))
    fireEvent.change(dialog().getByLabelText('Table name'), { target: { value: 'note' } })
    fireEvent.change(dialog().getByLabelText('Column 2 name'), { target: { value: 'body' } })
    fireEvent.click(dialog().getByLabelText('Column 2 allows NULL'))
    const sql = 'CREATE TABLE [note] (\n  [id] INTEGER PRIMARY KEY AUTOINCREMENT,\n  [body] TEXT NOT NULL\n)'
    expect(dialog().getByLabelText('SQL to run').textContent).toBe(sql)

    fireEvent.click(dialog().getByRole('button', { name: 'Create table' }))
    await waitFor(() => expect(adapters.dbManager.runDdl).toHaveBeenCalledWith('sqlite', expect.anything(), sql))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'note' })).toBeTruthy())
    expect(screen.queryByRole('dialog')).not.toBeTruthy()
  })

  it('won’t create a table whose name is taken, or one with a bad design', async () => {
    await connectUat()
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    fireEvent.click(topMenu().getByRole('menuitem', { name: 'New table…' }))
    fireEvent.change(dialog().getByLabelText('Table name'), { target: { value: 'Staff' } })
    fireEvent.change(dialog().getByLabelText('Column 2 name'), { target: { value: 'id' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Create table' }))
    const errors = dialog().getByRole('alert').textContent
    expect(errors).toMatch(/already a table or view called Staff/)
    expect(errors).toMatch(/must be different: id/)
    expect(adapters.dbManager.runDdl).not.toHaveBeenCalled()
  })

  it('shows the database’s reason when creating fails, and keeps the design', async () => {
    adapters.dbManager.runDdl.mockRejectedValue(new Error('CREATE TABLE permission denied'))
    await connectUat()
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    fireEvent.click(topMenu().getByRole('menuitem', { name: 'New table…' }))
    fireEvent.change(dialog().getByLabelText('Table name'), { target: { value: 'note' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Create table' }))
    await waitFor(() => expect(dialog().getByText(/permission denied/)).toBeTruthy())
    expect(dialog().getByLabelText('Table name').value).toBe('note')
  })

  it('makes a view from a table’s menu', async () => {
    await connectUat()
    fireEvent.click(list().getByRole('button', { name: 'More for staff' }))
    fireEvent.click(topMenu().getByRole('menuitem', { name: 'New view from this…' }))
    expect(dialog().getByLabelText('SELECT query').value).toBe('SELECT * FROM [staff]')
    fireEvent.change(dialog().getByLabelText('View name'), { target: { value: 'all_staff' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Create view' }))
    await waitFor(() => expect(adapters.dbManager.runDdl).toHaveBeenCalledWith('sqlite', expect.anything(), 'CREATE VIEW [all_staff] AS\nSELECT * FROM [staff]'))
  })

  it('makes a view from the query in the Query tab', async () => {
    await connectUat()
    openTable('staff')
    await waitFor(() => screen.getByRole('table'))
    fireEvent.click(screen.getByRole('tab', { name: 'Query' }))
    fireEvent.change(screen.getByLabelText('SQL query'), { target: { value: 'SELECT [name] FROM [staff]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create view…' }))
    expect(dialog().getByLabelText('SELECT query').value).toBe('SELECT [name] FROM [staff]')
  })

  it('drops a table only once its name is typed, and forgets its stars and group', async () => {
    window.localStorage.setItem('nx-db:tables:uat', JSON.stringify({ starred: ['staff'], groups: ['People'], assigned: { staff: 'People' } }))
    await connectUat()
    fireEvent.click(list().getAllByRole('button', { name: 'More for staff' })[0])
    fireEvent.click(topMenu().getByRole('menuitem', { name: 'Drop table…' }))
    const drop = dialog().getByRole('button', { name: 'Drop table' })
    expect(drop.disabled).toBe(true)
    fireEvent.change(dialog().getByLabelText(/Type staff to confirm/), { target: { value: 'staf' } })
    expect(drop.disabled).toBe(true)
    fireEvent.change(dialog().getByLabelText(/Type staff to confirm/), { target: { value: 'staff' } })
    fireEvent.click(drop)
    await waitFor(() => expect(adapters.dbManager.runDdl).toHaveBeenCalledWith('sqlite', expect.anything(), 'DROP TABLE [staff]'))
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('nx-db:tables:uat'))).toMatchObject({ starred: [], assigned: {}, groups: [] }))
  })

  it('drops a view with DROP VIEW', async () => {
    await connectUat()
    fireEvent.click(list().getByRole('button', { name: 'More for active_staff' }))
    fireEvent.click(topMenu().getByRole('menuitem', { name: 'Drop view…' }))
    fireEvent.change(dialog().getByLabelText(/Type active_staff to confirm/), { target: { value: 'active_staff' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Drop view' }))
    await waitFor(() => expect(adapters.dbManager.runDdl).toHaveBeenCalledWith('sqlite', expect.anything(), 'DROP VIEW [active_staff]'))
  })

  it('shows a view read-only, without adding rows', async () => {
    adapters.dbManager.getColumns.mockResolvedValue({ ok: true, columns: [{ name: 'id', dataType: 'INTEGER', isPrimaryKey: false }, { name: 'name', dataType: 'TEXT', isPrimaryKey: false }] })
    await connectUat()
    openTable('active_staff')
    await waitFor(() => expect(screen.getByRole('note').textContent).toMatch(/This is a view/))
    expect(screen.getByRole('button', { name: 'Add row' }).disabled).toBe(true)
  })

  it('offers no creating or dropping in the demo', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText('Try the demo'))
    await waitFor(() => screen.getByText('patients'))
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeTruthy()
    fireEvent.click(list().getByRole('button', { name: 'More for staff' }))
    expect(topMenu().getByRole('menuitem', { name: 'Drop table…' }).disabled).toBe(true)
  })
})

describe('ViewDbManager — closing opened tables', () => {
  afterEach(() => { cleanup() })

  const list = () => within(screen.getByRole('navigation', { name: 'Table list' }))
  const openedCount = () => within(screen.getByRole('group', { name: 'Show tables' })).getByRole('button', { name: /^Opened/ }).textContent

  async function demoWithTwoOpened() {
    render(<ViewDbManager adapters={{ dbManager: makeAdapter() }} />)
    fireEvent.click(screen.getByText('Try the demo'))
    await waitFor(() => screen.getByText('patients'))
    openTable('staff')
    await waitFor(() => screen.getByRole('heading', { name: 'staff' }))
    openTable('patients')
    await waitFor(() => screen.getByRole('heading', { name: 'patients' }))
    expect(openedCount()).toBe('Opened2')
  }

  it('closes a table from its × in the list, taking it out of Opened', async () => {
    await demoWithTwoOpened()
    fireEvent.click(list().getByRole('button', { name: 'Close staff' }))
    expect(openedCount()).toBe('Opened1')
    // The open one stays open.
    expect(screen.getByRole('heading', { name: 'patients' })).toBeTruthy()
  })

  it('closing the table that’s showing goes back to the overview', async () => {
    await demoWithTwoOpened()
    fireEvent.click(screen.getByRole('button', { name: 'Close table' }))
    expect(screen.queryByRole('heading', { name: 'patients' })).not.toBeTruthy()
    expect(openedCount()).toBe('Opened1')
    expect(within(screen.getByRole('region', { name: 'Recently opened' })).queryByText('patients')).not.toBeTruthy()
  })

  it('closes the other opened tables from a table’s menu', async () => {
    await demoWithTwoOpened()
    fireEvent.click(list().getByRole('button', { name: 'More for patients' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Close other tables (1)' }))
    expect(openedCount()).toBe('Opened1')
    expect(screen.getByRole('heading', { name: 'patients' })).toBeTruthy()
  })

  it('closes them all from the Opened filter, and from Recently opened', async () => {
    await demoWithTwoOpened()
    fireEvent.click(within(screen.getByRole('group', { name: 'Show tables' })).getByRole('button', { name: /^Opened/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Close all' }))
    expect(openedCount()).toBe('Opened0')

    openTable('staff')
    await waitFor(() => screen.getByRole('heading', { name: 'staff' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close table' }))
    openTable('patients')
    await waitFor(() => screen.getByRole('heading', { name: 'patients' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close table' }))
    // Closing each took it out, so Recently opened has nothing left to show.
    expect(screen.queryByRole('region', { name: 'Recently opened' })).not.toBeTruthy()
  })
})

describe('ViewDbManager — filling fields from a connection string', () => {
  afterEach(() => { cleanup() })

  function openSqlServerConnStr(value) {
    render(<ViewDbManager adapters={{ dbManager: makeAdapter() }} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(dialog().getByText('SQL Server'))
    fireEvent.click(dialog().getByRole('tab', { name: 'Connection string' }))
    fireEvent.change(dialog().getByLabelText('Connection string'), { target: { value } })
    fireEvent.click(dialog().getByRole('button', { name: 'Fill in fields' }))
  }

  it('fills the SQL Server fields from a pasted string and shows them', () => {
    openSqlServerConnStr('Server=db.example,1500;Database=sales;User Id=app;Password=pw;Encrypt=false;TrustServerCertificate=true;')

    expect(dialog().getByRole('tab', { name: 'Fields', selected: true })).toBeTruthy()
    expect(dialog().getByLabelText('Server / Host').value).toBe('db.example')
    expect(dialog().getByLabelText('Port').value).toBe('1500')
    expect(dialog().getByLabelText('Database').value).toBe('sales')
    expect(dialog().getByLabelText('Username').value).toBe('app')
    expect(dialog().getByLabelText('Password').value).toBe('pw')
    expect(dialog().getByLabelText('Encrypt connection').checked).toBe(false)
    expect(dialog().getByLabelText('Trust server certificate').checked).toBe(true)
  })

  it('picks interactive sign-in from the string', () => {
    openSqlServerConnStr('Server=x.database.windows.net;Authentication=Active Directory Interactive;User Id=me@corp.com;')
    expect(dialog().getByLabelText('Authentication').value).toBe('azure-ad-interactive')
    expect(dialog().getByLabelText('Account (optional)').value).toBe('me@corp.com')
  })

  it('says why when the string cannot be read, and stays on it', () => {
    openSqlServerConnStr('Server=x;Authentication=Active Directory Integrated;')
    expect(dialog().getByRole('alert').textContent).toMatch(/Couldn.t read that connection string/)
    expect(dialog().getByRole('tab', { name: 'Connection string', selected: true })).toBeTruthy()
  })
})

describe('ViewDbManager — saving connections from the connect dialog', () => {
  let adapters, onSaveConnection

  beforeEach(() => {
    adapters = { dbManager: makeAdapter() }
    onSaveConnection = vi.fn().mockResolvedValue('new-id')
  })

  afterEach(() => { cleanup() })

  function fillSqlServer() {
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(within(dialog().getByRole('group', { name: 'Database type' })).getByText('SQL Server'))
    fireEvent.change(dialog().getByLabelText('Server / Host'), { target: { value: 'uat.example' } })
    fireEvent.change(dialog().getByLabelText('Database'), { target: { value: 'sales' } })
    fireEvent.change(dialog().getByLabelText('Username'), { target: { value: 'app' } })
    fireEvent.change(dialog().getByLabelText('Password'), { target: { value: 'pw' } })
  }

  it('saves the connection by default, named after its database, with the password kept as the secret', async () => {
    render(<ViewDbManager adapters={adapters} onSaveConnection={onSaveConnection} />)
    fillSqlServer()
    expect(dialog().getByLabelText('Save this connection').checked).toBe(true)
    expect(dialog().getByLabelText('Connection name').placeholder).toBe('sales')
    fireEvent.click(dialog().getByRole('button', { name: 'Connect' }))

    await waitFor(() => expect(onSaveConnection).toHaveBeenCalledOnce())
    const [meta, secret] = onSaveConnection.mock.calls[0]
    expect(meta).toMatchObject({ name: 'sales', type: 'sqlserver', inputMode: 'fields', host: 'uat.example', database: 'sales', user: 'app' })
    expect(meta.password).toBeUndefined()
    expect(secret).toBe('pw')
    await waitFor(() => expect(screen.getByRole('tab', { name: 'sales', selected: true })).toBeTruthy())
  })

  it('uses the name typed in, and replaces a saved connection with the same name', async () => {
    const saved = [{ id: 'old', name: 'UAT', type: 'sqlserver', inputMode: 'fields', host: 'old.example' }]
    render(<ViewDbManager adapters={adapters} savedConnections={saved} onSaveConnection={onSaveConnection} />)
    fillSqlServer()
    fireEvent.change(dialog().getByLabelText('Connection name'), { target: { value: 'uat' } })
    expect(dialog().getByText(/Replaces the saved connection/)).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(onSaveConnection).toHaveBeenCalledOnce())
    expect(onSaveConnection.mock.calls[0][0]).toMatchObject({ id: 'old', name: 'uat' })
  })

  it('saves a connection string whole, as the secret', async () => {
    render(<ViewDbManager adapters={adapters} onSaveConnection={onSaveConnection} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(dialog().getByText('SQL Server'))
    fireEvent.click(dialog().getByRole('tab', { name: 'Connection string' }))
    fireEvent.change(dialog().getByLabelText('Connection string'), { target: { value: 'Server=h;Database=reports;User Id=u;Password=p;' } })
    expect(dialog().getByLabelText('Connection name').placeholder).toBe('reports')
    fireEvent.click(dialog().getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(onSaveConnection).toHaveBeenCalledOnce())
    expect(onSaveConnection).toHaveBeenCalledWith(
      { name: 'reports', type: 'sqlserver', inputMode: 'connstr' },
      'Server=h;Database=reports;User Id=u;Password=p;',
    )
  })

  it('connects without saving when the box is unticked', async () => {
    render(<ViewDbManager adapters={adapters} onSaveConnection={onSaveConnection} />)
    fillSqlServer()
    fireEvent.click(dialog().getByLabelText('Save this connection'))
    fireEvent.click(dialog().getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeTruthy())
    expect(onSaveConnection).not.toHaveBeenCalled()
  })

  it('stays connected and says so when saving fails', async () => {
    onSaveConnection.mockRejectedValue(new Error('disk full'))
    render(<ViewDbManager adapters={adapters} onSaveConnection={onSaveConnection} />)
    fillSqlServer()
    fireEvent.click(dialog().getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(screen.getByText(/Connected, but couldn.t save it: disk full/)).toBeTruthy())
    expect(screen.getByRole('navigation', { name: 'Table list' })).toBeTruthy()
  })

  it('offers no save option when the host has nowhere to save', () => {
    render(<ViewDbManager adapters={adapters} />)
    fillSqlServer()
    expect(dialog().queryByLabelText('Save this connection')).not.toBeTruthy()
  })
})

describe('ViewDbManager — reopening connections from last time', () => {
  let adapters

  beforeEach(() => {
    adapters = { dbManager: makeAdapter() }
  })

  afterEach(() => { cleanup() })

  const saved = [
    { id: 'a', name: 'UAT', type: 'sqlite', inputMode: 'fields', filePath: '/a.db' },
    { id: 'b', name: 'Prod', type: 'sqlite', inputMode: 'fields', filePath: '/b.db' },
    { id: 'c', name: 'Azure', type: 'sqlserver', inputMode: 'fields', host: 'x.database.windows.net', authentication: 'azure-ad-interactive' },
  ]
  const connTabs = () => within(screen.getByRole('tablist', { name: 'Connections' }))
  const remembered = () => JSON.parse(window.localStorage.getItem('nx-db:open-connections'))
  const renderView = () => render(<ViewDbManager adapters={adapters} savedConnections={saved} onResolveSecret={vi.fn().mockResolvedValue('')} />)

  it('reconnects the saved connections that were open, showing the one that was showing', async () => {
    window.localStorage.setItem('nx-db:open-connections', JSON.stringify({ ids: ['a', 'b'], active: 'b' }))
    renderView()
    await waitFor(() => expect(connTabs().getByRole('tab', { name: 'Prod', selected: true })).toBeTruthy())
    expect(connTabs().getByRole('tab', { name: 'UAT', selected: false })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close UAT' })).toBeTruthy()
    expect(adapters.dbManager.connect).toHaveBeenCalledTimes(2)
  })

  it('leaves a browser sign-in connection waiting for a click instead of opening a sign-in window', async () => {
    window.localStorage.setItem('nx-db:open-connections', JSON.stringify({ ids: ['a', 'c'], active: 'a' }))
    renderView()
    await waitFor(() => expect(connTabs().getByRole('tab', { name: 'UAT', selected: true })).toBeTruthy())
    expect(adapters.dbManager.connect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Close Azure' })).not.toBeTruthy()
    expect(screen.getByRole('button', { name: "Don't reopen Azure" })).toBeTruthy()
    // Still remembered until it's reopened or dismissed.
    expect(remembered().ids).toEqual(['a', 'c'])

    fireEvent.click(screen.getByRole('button', { name: "Don't reopen Azure" }))
    expect(remembered().ids).toEqual(['a'])
  })

  it('marks waiting connections on the welcome screen when nothing else reopened', async () => {
    window.localStorage.setItem('nx-db:open-connections', JSON.stringify({ ids: ['c'], active: 'c' }))
    renderView()
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Quick connect' })).getByText('Was open')).toBeTruthy())
    expect(adapters.dbManager.connect).not.toHaveBeenCalled()
  })

  it('remembers saved connections as they open and close', async () => {
    renderView()
    fireEvent.click(within(screen.getByRole('region', { name: 'Quick connect' })).getByText('UAT'))
    await waitFor(() => expect(connTabs().getByRole('tab', { name: 'UAT', selected: true })).toBeTruthy())
    expect(remembered()).toEqual({ ids: ['a'], active: 'a' })

    fireEvent.click(screen.getByRole('button', { name: 'Close UAT' }))
    expect(remembered()).toEqual({ ids: [], active: null })
  })

  it('skips saved connections that no longer exist, and reports ones that fail', async () => {
    window.localStorage.setItem('nx-db:open-connections', JSON.stringify({ ids: ['gone', 'a', 'b'], active: 'a' }))
    adapters.dbManager.connect.mockImplementation(async (_type, config) => {
      if (config.filePath === '/b.db') throw new Error('file locked')
      return { ok: true, tables: ['patients'] }
    })
    renderView()
    await waitFor(() => expect(screen.getByText("Couldn't reopen Prod: file locked")).toBeTruthy())
    expect(connTabs().getByRole('tab', { name: 'UAT', selected: true })).toBeTruthy()
    expect(remembered().ids).toEqual(['a'])
  })

  it('does not reopen one-off connections', async () => {
    window.localStorage.setItem('nx-db:open-connections', JSON.stringify({ ids: [], active: null }))
    renderView()
    expect(screen.getByText('Database Manager')).toBeTruthy()
    expect(adapters.dbManager.connect).not.toHaveBeenCalled()
  })
})

describe('ViewDbManager — editing by column type, adding and deleting rows', () => {
  let adapters
  const typed = [
    { name: 'id', dataType: 'int', isPrimaryKey: true, nullable: false, isIdentity: true },
    { name: 'qty', dataType: 'tinyint', isPrimaryKey: false, nullable: true },
    { name: 'active', dataType: 'bit', isPrimaryKey: false, nullable: false },
    { name: 'name', dataType: 'nvarchar', isPrimaryKey: false, nullable: false, maxLength: 5 },
    { name: 'joined', dataType: 'date', isPrimaryKey: false, nullable: true },
  ]

  beforeEach(() => {
    adapters = { dbManager: makeAdapter({
      connect: vi.fn().mockResolvedValue({ ok: true, tables: ['members'] }),
      getRows: vi.fn().mockResolvedValue({
        columns: ['id', 'qty', 'active', 'name', 'joined'],
        rows: [[1, 5, true, 'Al', null], [2, null, false, 'Bo', null]],
      }),
      getColumns: vi.fn().mockResolvedValue({ ok: true, columns: typed }),
      insertRow: vi.fn().mockResolvedValue({ ok: true, affected: 1 }),
    }) }
  })

  afterEach(() => { cleanup() })

  async function openMembers() {
    await openMembersBare()
    await waitFor(() => expect(screen.getAllByText('tinyint').length).toBeGreaterThan(0))
  }
  async function openMembersBare() {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('SQLite'))
    fireEvent.click(screen.getByRole('tab', { name: 'Connection string' }))
    fireEvent.change(screen.getByLabelText(/connection string/i), { target: { value: '/m.db' } })
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => screen.getByText('members'))
    openTable('members')
    await waitFor(() => screen.getByRole('table'))
    await waitFor(() => expect(adapters.dbManager.getColumns).toHaveBeenCalled())
  }
  const grid = () => within(screen.getByRole('region', { name: 'Table data' }))
  const cell = (text) => grid().getByText(text).closest('td')

  it('shows each column’s type in its header', async () => {
    await openMembers()
    expect(grid().getByText('nvarchar(5)')).toBeTruthy()
    expect(grid().getByText('bit')).toBeTruthy()
  })

  it('keeps letters out of a whole-number cell and refuses a number out of range', async () => {
    await openMembers()
    fireEvent.doubleClick(cell('5'))
    const input = grid().getByLabelText('Edit qty')
    fireEvent.change(input, { target: { value: '4x' } })
    expect(input.value).toBe('5')
    fireEvent.change(input, { target: { value: '300' } })
    expect(grid().getByRole('alert').textContent).toMatch(/0 to 255/)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(adapters.dbManager.updateCell).not.toHaveBeenCalled()
    expect(grid().getByLabelText('Edit qty')).toBeTruthy()

    fireEvent.change(input, { target: { value: '42' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(adapters.dbManager.updateCell).toHaveBeenCalledWith('sqlite', expect.anything(), 'members', 'id', 1, 'qty', 42))
  })

  it('drops a value the column can’t hold when the editor is left, and says why', async () => {
    await openMembers()
    fireEvent.doubleClick(cell('5'))
    fireEvent.change(grid().getByLabelText('Edit qty'), { target: { value: '999' } })
    fireEvent.blur(grid().getByLabelText('Edit qty'))
    await waitFor(() => expect(screen.getByText(/Not saved: Must be a whole number from 0 to 255/)).toBeTruthy())
    expect(adapters.dbManager.updateCell).not.toHaveBeenCalled()
  })

  it('writes a bit straight from its checkbox', async () => {
    await openMembers()
    fireEvent.click(grid().getByLabelText('active for row 2'))
    await waitFor(() => expect(adapters.dbManager.updateCell).toHaveBeenCalledWith('sqlite', expect.anything(), 'members', 'id', 2, 'active', true))
    expect(grid().getByLabelText('active for row 2').checked).toBe(true)
  })

  it('sets a nullable cell to NULL from its editor', async () => {
    await openMembers()
    fireEvent.doubleClick(cell('5'))
    fireEvent.mouseDown(grid().getByRole('button', { name: 'NULL' }))
    await waitFor(() => expect(adapters.dbManager.updateCell).toHaveBeenCalledWith('sqlite', expect.anything(), 'members', 'id', 1, 'qty', null))
  })

  it('gives text its length limit and dates a date picker, and leaves identity columns alone', async () => {
    await openMembers()
    fireEvent.doubleClick(cell('Al'))
    expect(grid().getByLabelText('Edit name').maxLength).toBe(5)
    fireEvent.keyDown(grid().getByLabelText('Edit name'), { key: 'Escape' })

    const joined = grid().getAllByText('null')[0].closest('td')
    fireEvent.doubleClick(joined)
    expect(grid().getByLabelText('Edit joined').type).toBe('date')
    fireEvent.keyDown(grid().getByLabelText('Edit joined'), { key: 'Escape' })

    fireEvent.doubleClick(cell('1'))
    expect(grid().queryByLabelText('Edit id')).not.toBeTruthy()
  })

  it('edits and deletes by every column of a composite key', async () => {
    adapters.dbManager.getColumns.mockResolvedValue({ ok: true, columns: typed.map(c => (c.name === 'name' ? { ...c, isPrimaryKey: true } : c)) })
    await openMembers()
    fireEvent.click(grid().getByLabelText('active for row 1'))
    await waitFor(() => expect(adapters.dbManager.updateCell).toHaveBeenCalledWith('sqlite', expect.anything(), 'members', ['id', 'name'], [1, 'Al'], 'active', false))

    fireEvent.click(grid().getByRole('button', { name: 'Delete row 2' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(adapters.dbManager.deleteRows).toHaveBeenCalledWith('sqlite', expect.anything(), 'members', ['id', 'name'], [[2, 'Bo']]))
  })

  it('turns editing and deleting off for a table with no primary key, but still adds rows', async () => {
    adapters.dbManager.getColumns.mockResolvedValue({ ok: true, columns: typed.map(c => ({ ...c, isPrimaryKey: false })) })
    await openMembers()
    expect(screen.getByRole('note').textContent).toMatch(/no primary key/)
    expect(grid().getByRole('button', { name: 'Delete row 1' }).disabled).toBe(true)
    expect(grid().getByLabelText('active for row 1').disabled).toBe(true)
    fireEvent.doubleClick(cell('Al'))
    expect(grid().queryByLabelText('Edit name')).not.toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add row' }).disabled).toBe(false)
  })

  it('says when the column types could not be read, and still lets rows be added', async () => {
    adapters.dbManager.getColumns.mockResolvedValue({ ok: true, columns: [] })
    await openMembersBare()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add row' }).disabled).toBe(false))
    expect(screen.getByRole('note').textContent).toMatch(/^Couldn't read this table's column types, so editing and deleting are off/)
    expect(screen.getByRole('note').textContent).not.toMatch(/primary key/)
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText("Couldn't read this table's column types; values go in as typed")).toBeTruthy()
    expect(dialog.queryByText('text')).not.toBeTruthy()
  })

  it('shows a datetimeoffset field as text with its format, and refuses stray characters', async () => {
    const cols = [...typed, { name: 'seen', dataType: 'datetimeoffset', isPrimaryKey: false, nullable: true }]
    adapters.dbManager.getColumns.mockResolvedValue({ ok: true, columns: cols })
    adapters.dbManager.getRows.mockResolvedValue({ columns: ['id', 'qty', 'active', 'name', 'joined', 'seen'], rows: [] })
    await openMembersBare()
    await waitFor(() => expect(screen.getAllByText('datetimeoffset').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    const input = within(screen.getByRole('dialog')).getByLabelText(/^seen/)
    expect(input.type).toBe('text')
    expect(input.placeholder).toBe('YYYY-MM-DDTHH:MM:SS+HH:MM')
    fireEvent.change(input, { target: { value: 'x' } })
    expect(input.value).toBe('')
  })

  it('adds a row: identity left to the database, required fields checked, blanks left to defaults', async () => {
    await openMembers()
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    const form = within(screen.getByRole('dialog'))
    expect(form.getByLabelText(/^id/).disabled).toBe(true)

    fireEvent.click(form.getByRole('button', { name: 'Add row' }))
    expect(form.getByText('Required')).toBeTruthy()
    expect(adapters.dbManager.insertRow).not.toHaveBeenCalled()

    fireEvent.change(form.getByLabelText(/^name/), { target: { value: 'Cy' } })
    fireEvent.change(form.getByLabelText(/^qty/), { target: { value: '7' } })
    fireEvent.click(form.getByRole('button', { name: 'Add row' }))
    await waitFor(() => expect(adapters.dbManager.insertRow).toHaveBeenCalledWith('sqlite', expect.anything(), 'members', { qty: 7, active: false, name: 'Cy' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeTruthy())
    expect(adapters.dbManager.getRows).toHaveBeenCalledTimes(2)
  })

  it('keeps the add-row form open with the database’s reason when the insert fails', async () => {
    adapters.dbManager.insertRow.mockRejectedValue(new Error('Violation of UNIQUE KEY constraint'))
    await openMembers()
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    const form = within(screen.getByRole('dialog'))
    fireEvent.change(form.getByLabelText(/^name/), { target: { value: 'Al' } })
    fireEvent.click(form.getByRole('button', { name: 'Add row' }))
    await waitFor(() => expect(form.getByRole('alert').textContent).toMatch(/UNIQUE KEY/))
  })

  it('adds a row to the demo data too', async () => {
    cleanup()
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText('Try the demo'))
    await waitFor(() => screen.getByText('patients'))
    openTable('staff')
    await waitFor(() => screen.getByRole('table'))
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    const form = within(screen.getByRole('dialog'))
    fireEvent.change(form.getByLabelText(/^staff_id/), { target: { value: '9' } })
    fireEvent.change(form.getByLabelText(/^name/), { target: { value: 'New Person' } })
    fireEvent.click(form.getByRole('button', { name: 'Add row' }))
    await waitFor(() => expect(grid().getByText('New Person')).toBeTruthy())
  })
})

describe('ViewDbManager — query results', () => {
  let adapters

  beforeEach(() => {
    adapters = { dbManager: makeAdapter() }
  })

  afterEach(() => { cleanup() })

  async function queryTab() {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('SQLite'))
    fireEvent.click(screen.getByRole('tab', { name: 'Connection string' }))
    fireEvent.change(screen.getByLabelText(/connection string/i), { target: { value: '/q.db' } })
    fireEvent.click(screen.getByText('Connect'))
    await waitFor(() => screen.getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))
    fireEvent.click(screen.getByRole('tab', { name: 'Query' }))
    fireEvent.change(screen.getByLabelText('SQL query'), { target: { value: 'SELECT [id], [Key] FROM [patients] WHERE 1 = 0' } })
  }

  it('shows an empty result’s column headers and says no rows came back', async () => {
    adapters.dbManager.runQuery.mockResolvedValue({ columns: ['id', 'Key'], rows: [], sets: [{ columns: ['id', 'Key'], rows: [] }], affected: null })
    await queryTab()
    fireEvent.click(screen.getByText('Run query'))
    await waitFor(() => expect(screen.getByText('0 rows returned')).toBeTruthy())
    expect(screen.getByText('Key')).toBeTruthy()
    expect(screen.getByText('No rows')).toBeTruthy()
  })

  it('shows every result set a batch returns', async () => {
    adapters.dbManager.runQuery.mockResolvedValue({
      columns: ['a'], rows: [[1]], affected: null,
      sets: [{ columns: ['a'], rows: [[1]] }, { columns: ['b', 'c'], rows: [[2, 3], [4, 5]] }],
    })
    await queryTab()
    fireEvent.click(screen.getByText('Run query'))
    await waitFor(() => expect(screen.getByText('Result 2 of 2')).toBeTruthy())
    expect(screen.getByText('1 row returned')).toBeTruthy()
    expect(screen.getByText('2 rows returned')).toBeTruthy()
  })
})

describe('ViewDbManager — editing a saved connection', () => {
  let adapters, onSaveConnection
  const saved = [{ id: 'uat', name: 'UAT', type: 'sqlite', inputMode: 'fields', filePath: '/a.db' }]
  const dialog = () => within(screen.getByRole('dialog'))

  beforeEach(() => {
    adapters = { dbManager: makeAdapter() }
    onSaveConnection = vi.fn().mockResolvedValue('uat')
  })
  afterEach(() => { cleanup() })

  const renderView = () => render(<ViewDbManager adapters={adapters} savedConnections={saved}
    onResolveSecret={vi.fn().mockResolvedValue('')} onSaveConnection={onSaveConnection} />)

  it('edits an open connection, saves it under the same id and reconnects with the new settings', async () => {
    renderView()
    fireEvent.click(within(screen.getByRole('region', { name: 'Quick connect' })).getByText('UAT'))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'UAT', selected: true })).toBeTruthy())
    adapters.dbManager.connect.mockResolvedValueOnce({ ok: true, tables: ['orders'] })

    fireEvent.click(screen.getByRole('button', { name: 'Edit UAT' }))
    await waitFor(() => expect(dialog().getByText('Edit connection')).toBeTruthy())
    expect(dialog().getByLabelText('File path').value).toBe('/a.db')
    expect(dialog().getByLabelText('Connection name').value).toBe('UAT')
    fireEvent.change(dialog().getByLabelText('File path'), { target: { value: '/b.db' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Save and reconnect' }))

    await waitFor(() => expect(onSaveConnection).toHaveBeenCalledWith(expect.objectContaining({ id: 'uat', name: 'UAT', filePath: '/b.db' }), ''))
    await waitFor(() => expect(adapters.dbManager.connect).toHaveBeenLastCalledWith('sqlite', expect.objectContaining({ filePath: '/b.db' })))
    await waitFor(() => expect(screen.getByText('orders')).toBeTruthy())
    expect(screen.getAllByRole('tab', { name: 'UAT' })).toHaveLength(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the connection and says why when it can no longer connect', async () => {
    renderView()
    fireEvent.click(within(screen.getByRole('region', { name: 'Quick connect' })).getByText('UAT'))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'UAT', selected: true })).toBeTruthy())
    adapters.dbManager.connect.mockRejectedValueOnce(new Error('no such file'))

    fireEvent.click(screen.getByRole('button', { name: 'Edit UAT' }))
    await waitFor(() => expect(dialog().getByText('Edit connection')).toBeTruthy())
    fireEvent.change(dialog().getByLabelText('File path'), { target: { value: '/gone.db' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Save and reconnect' }))

    await waitFor(() => expect(screen.getByText(/Saved UAT, but couldn.t reconnect: no such file/)).toBeTruthy())
    expect(onSaveConnection).toHaveBeenCalled()
    expect(screen.queryByRole('tab', { name: 'UAT', selected: true })).toBeNull()
  })

  it('edits a saved connection that is not open from a right-click, without connecting', async () => {
    renderView()
    // Closed saved connections show as tabs beside an open one.
    fireEvent.click(screen.getByText('Try the demo'))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'UAT' })).toBeTruthy())
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'UAT' }))
    await waitFor(() => expect(dialog().getByText('Edit connection')).toBeTruthy())
    fireEvent.change(dialog().getByLabelText('Connection name'), { target: { value: 'UAT 2' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaveConnection).toHaveBeenCalledWith(expect.objectContaining({ id: 'uat', name: 'UAT 2' }), ''))
    expect(adapters.dbManager.connect).not.toHaveBeenCalled()
  })
})

describe('ViewDbManager — tables in other schemas', () => {
  let adapters
  const saved = [{ id: 'prod', name: 'Prod', type: 'sqlserver', inputMode: 'fields', host: 'h', port: '1433', database: 'd', user: 'u' }]
  const list = () => within(screen.getByRole('navigation', { name: 'Table list' }))

  beforeEach(() => {
    window.localStorage.clear()
    adapters = { dbManager: makeAdapter({ connect: vi.fn().mockResolvedValue({ ok: true, tables: ['Member', 'maintenance.updatemember', 'Staging.V_Site'], views: ['Staging.V_Site'] }) }) }
  })
  afterEach(() => { cleanup() })

  async function connectProd() {
    render(<ViewDbManager adapters={adapters} savedConnections={saved} onResolveSecret={vi.fn().mockResolvedValue('p')} />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Quick connect' })).getByText('Prod'))
    await waitFor(() => expect(list().getAllByText('Member').length).toBeGreaterThan(0))
  }

  it('shows other schemas until they are hidden, and remembers that for the connection', async () => {
    await connectProd()
    expect(list().getByRole('button', { name: 'More for maintenance.updatemember' })).toBeTruthy()
    const toggle = screen.getByRole('button', { name: /Other schemas/ })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    await waitFor(() => expect(list().queryByRole('button', { name: 'More for maintenance.updatemember' })).toBeNull())
    expect(list().queryByRole('button', { name: 'More for Staging.V_Site' })).toBeNull()
    expect(list().getByText('Member')).toBeTruthy()
    cleanup()
    await connectProd()
    expect(list().queryByRole('button', { name: 'More for maintenance.updatemember' })).toBeNull()
    expect(screen.getByRole('button', { name: /Other schemas/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('offers no schema toggle when every table is in the default schema', async () => {
    adapters.dbManager.connect.mockResolvedValue({ ok: true, tables: ['Member', 'Site'] })
    await connectProd()
    expect(screen.queryByRole('button', { name: /Other schemas/ })).toBeNull()
  })
})

describe('ViewDbManager — structure and foreign keys', () => {
  let adapters
  const structure = {
    ok: true,
    columns: [
      { name: 'id', dataType: 'INTEGER', isPrimaryKey: true },
      { name: 'name', dataType: 'TEXT', isPrimaryKey: false },
    ],
    foreignKeys: [{ name: 'FK_patients_name', columns: ['name'], refTable: 'staff', refColumns: ['id'], onDelete: 'NO ACTION', onUpdate: 'NO ACTION' }],
    referencedBy: [],
    indexes: [],
  }

  beforeEach(() => {
    adapters = { dbManager: makeAdapter({ getStructure: vi.fn().mockResolvedValue(structure) }) }
  })

  afterEach(() => { cleanup() })

  const saved = [{ id: 'uat', name: 'UAT', type: 'sqlite', inputMode: 'fields', filePath: '/a.db' }]
  const openUatPatients = async () => {
    render(<ViewDbManager adapters={adapters} savedConnections={saved} onResolveSecret={vi.fn().mockResolvedValue('')} />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Quick connect' })).getByText('UAT'))
    await waitFor(() => within(screen.getByRole('navigation', { name: 'Table list' })).getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))
  }

  it('marks a foreign key column in the Browse header', async () => {
    await openUatPatients()
    const marker = await waitFor(() => {
      const el = within(screen.getByRole('table')).getByText('fk')
      return el
    })
    expect(marker.getAttribute('title')).toBe('→ staff.id')
    expect(marker.closest('th').textContent).toContain('name')
  })

  it('shows the Structure tab on s, and opens a target table from it', async () => {
    await openUatPatients()
    // jsdom has no layout, so the page never counts as on screen; say it is.
    const rects = vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}])
    fireEvent.keyDown(window, { key: 's' })
    rects.mockRestore()
    expect(screen.getByRole('tab', { name: 'Structure', selected: true })).toBeTruthy()
    const fks = await waitFor(() => screen.getByRole('region', { name: 'Foreign keys' }))
    fireEvent.click(within(fks).getByRole('button', { name: 'Open staff' }))
    await waitFor(() => expect(adapters.dbManager.getRows).toHaveBeenCalledWith('sqlite', expect.anything(), 'staff'))
  })

  it('reads the structure again on refresh', async () => {
    await openUatPatients()
    await waitFor(() => expect(adapters.dbManager.getStructure).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    await waitFor(() => expect(adapters.dbManager.getStructure).toHaveBeenCalledTimes(2))
  })

  it('falls back to the columns alone in the demo', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText('Try the demo'))
    await waitFor(() => screen.getByText('patients'))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))
    fireEvent.click(screen.getByRole('tab', { name: 'Structure' }))
    const cols = await waitFor(() => screen.getByRole('region', { name: 'Columns' }))
    expect(within(cols).getByText('dob')).toBeTruthy()
    expect(adapters.dbManager.getStructure).not.toHaveBeenCalled()
    expect(within(screen.getByRole('region', { name: 'Foreign keys' })).getByText('None')).toBeTruthy()
  })
})

describe('ViewDbManager — following foreign keys', () => {
  let adapters
  const fkTo = (refTable, column = 'name', refColumn = 'id') => ({
    ok: true,
    columns: [
      { name: 'id', dataType: 'INTEGER', isPrimaryKey: true },
      { name: column, dataType: 'TEXT', isPrimaryKey: false },
    ],
    foreignKeys: [{ name: `FK_${column}`, columns: [column], refTable, refColumns: [refColumn], onDelete: 'NO ACTION', onUpdate: 'NO ACTION' }],
    referencedBy: [],
    indexes: [],
  })
  const plain = { ok: true, columns: [{ name: 'id', dataType: 'INTEGER', isPrimaryKey: true }], foreignKeys: [], referencedBy: [], indexes: [] }
  const toAlice = [{ column: 'id', value: 'Alice' }]

  beforeEach(() => {
    adapters = { dbManager: makeAdapter({
      getStructure: vi.fn().mockImplementation((type, config, table) => Promise.resolve(table === 'patients' ? fkTo('staff') : plain)),
      getRows: vi.fn().mockImplementation((type, config, table) => Promise.resolve(table === 'patients'
        ? { columns: ['id', 'name'], rows: [[1, 'Alice'], [2, 'Bob']] }
        : { columns: ['id', 'role'], rows: [['Alice', 'Physician']] })),
    }) }
  })

  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  const saved = [{ id: 'uat', name: 'UAT', type: 'sqlite', inputMode: 'fields', filePath: '/a.db' }]
  const connect = async (connections = saved, first = 'patients') => {
    render(<ViewDbManager adapters={adapters} savedConnections={connections} onResolveSecret={vi.fn().mockResolvedValue('')} />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Quick connect' })).getByText(connections[0].name))
    await waitFor(() => within(screen.getByRole('navigation', { name: 'Table list' })).getByText(first))
  }
  const openPatients = async () => {
    await connect()
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))
  }
  const follow = async (name) => fireEvent.click(await waitFor(() => screen.getByRole('button', { name })))
  const heading = () => document.querySelector('.nx-db-table-name')
  const chip = () => document.querySelector('span.nx-db-chip')
  const back = () => screen.getByRole('button', { name: 'Back' })
  // jsdom has no layout, so the page never counts as on screen; say it is.
  const onScreen = () => vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}])

  it('follows a key to its row, with a filter chip, and Back becomes available', async () => {
    await openPatients()
    expect(back().disabled).toBe(true)
    expect(back().getAttribute('title')).toBe('Back (Alt+←)')
    await follow('Follow name Alice to staff')
    await waitFor(() => expect(adapters.dbManager.getRows).toHaveBeenCalledWith('sqlite', expect.anything(), 'staff', 500, 0, toAlice))
    await waitFor(() => expect(heading().textContent).toBe('staff'))
    await waitFor(() => expect(chip()?.textContent).toContain('id = Alice'))
    expect(back().disabled).toBe(false)
  })

  it('only offers to follow a value that is there, and double-click still edits', async () => {
    adapters.dbManager.getRows.mockImplementation((type, config, table) => Promise.resolve(table === 'patients'
      ? { columns: ['id', 'name'], rows: [[1, 'Alice'], [2, null]] }
      : { columns: ['id', 'role'], rows: [] }))
    await openPatients()
    await waitFor(() => screen.getByRole('button', { name: 'Follow name Alice to staff' }))
    expect(screen.getAllByRole('button', { name: /^Follow / })).toHaveLength(1)
    fireEvent.doubleClick(screen.getByText('Alice').closest('td'))
    expect(screen.getByRole('textbox', { name: 'Edit name' })).toBeTruthy()
  })

  it('goes Back to the table it came from, with the search typed before', async () => {
    await openPatients()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search rows' }), { target: { value: 'Ali' } })
    await follow('Follow name Alice to staff')
    await waitFor(() => expect(heading().textContent).toBe('staff'))
    expect(screen.getByRole('searchbox', { name: 'Search rows' }).value).toBe('')
    adapters.dbManager.getRows.mockClear()
    fireEvent.click(back())
    await waitFor(() => expect(heading().textContent).toBe('patients'))
    expect(adapters.dbManager.getRows).toHaveBeenCalledWith('sqlite', expect.anything(), 'patients')
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search rows' }).value).toBe('Ali'))
    expect(chip()).toBeNull()
    expect(back().disabled).toBe(true)
  })

  it('opens a table in a schema the list is hiding', async () => {
    const prod = [{ id: 'prod', name: 'Prod', type: 'sqlserver', inputMode: 'fields', host: 'h', port: '1433', database: 'd', user: 'u' }]
    adapters.dbManager.connect.mockResolvedValue({ ok: true, tables: ['patients', 'maintenance.Booking'] })
    adapters.dbManager.getStructure.mockImplementation((type, config, table) => Promise.resolve(table === 'patients' ? fkTo('maintenance.Booking') : plain))
    await connect(prod)
    fireEvent.click(screen.getByRole('button', { name: /Other schemas/ }))
    openTable('patients')
    await waitFor(() => screen.getByRole('table'))
    await follow('Follow name Alice to maintenance.Booking')
    await waitFor(() => expect(adapters.dbManager.getRows).toHaveBeenCalledWith('sqlserver', expect.anything(), 'maintenance.Booking', 500, 0, toAlice))
    await waitFor(() => expect(heading().textContent).toBe('maintenance.Booking'))
  })

  it('follows a key back into the same table, and steps Back through each filter', async () => {
    adapters.dbManager.getStructure.mockResolvedValue(fkTo('patients', 'boss'))
    const all = [[1, 'Alice', null], [2, 'Bob', 1], [3, 'Cy', 2]]
    adapters.dbManager.getRows.mockImplementation((type, config, table, limit, offset, where) => Promise.resolve({
      columns: ['id', 'name', 'boss'],
      rows: where ? all.filter(r => r[0] === where[0].value) : all,
    }))
    await openPatients()
    await follow('Follow boss 2 to patients')
    await waitFor(() => expect(chip()?.textContent).toContain('id = 2'))
    await follow('Follow boss 1 to patients')
    await waitFor(() => expect(chip()?.textContent).toContain('id = 1'))
    expect(screen.queryByText('Cy')).toBeNull()
    fireEvent.click(back())
    await waitFor(() => expect(chip()?.textContent).toContain('id = 2'))
    expect(adapters.dbManager.getRows).toHaveBeenLastCalledWith('sqlite', expect.anything(), 'patients', 500, 0, [{ column: 'id', value: 2 }])
    fireEvent.click(back())
    await waitFor(() => expect(chip()).toBeNull())
    expect(adapters.dbManager.getRows).toHaveBeenLastCalledWith('sqlite', expect.anything(), 'patients')
    await waitFor(() => expect(screen.getByText('Cy')).toBeTruthy())
  })

  it('says when no row has the value followed', async () => {
    adapters.dbManager.getRows.mockImplementation((type, config, table) => Promise.resolve(table === 'patients'
      ? { columns: ['id', 'name'], rows: [[1, 'Alice']] }
      : { columns: ['id', 'role'], rows: [] }))
    await openPatients()
    await follow('Follow name Alice to staff')
    await waitFor(() => expect(screen.getByText('No row in staff has id = Alice')).toBeTruthy())
  })

  it('clearing the chip reads the table again without the filter, and adds no history', async () => {
    await openPatients()
    await follow('Follow name Alice to staff')
    await waitFor(() => expect(chip()).not.toBeNull())
    adapters.dbManager.getRows.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    await waitFor(() => expect(adapters.dbManager.getRows).toHaveBeenCalledWith('sqlite', expect.anything(), 'staff'))
    await waitFor(() => expect(chip()).toBeNull())
    expect(heading().textContent).toBe('staff')
    // Back still goes to patients, in one step.
    fireEvent.click(back())
    await waitFor(() => expect(heading().textContent).toBe('patients'))
    expect(back().disabled).toBe(true)
  })

  it('shows the error when going Back fails, and the entry is used up', async () => {
    await openPatients()
    await follow('Follow name Alice to staff')
    await waitFor(() => expect(heading().textContent).toBe('staff'))
    adapters.dbManager.getRows.mockReset()
    adapters.dbManager.getRows.mockRejectedValue(new Error('patients is locked'))
    fireEvent.click(back())
    await waitFor(() => expect(screen.getAllByText('patients is locked').length).toBeGreaterThan(0))
    expect(adapters.dbManager.getRows).toHaveBeenCalledTimes(1)
    expect(back().disabled).toBe(true)
    onScreen()
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })
    await new Promise(r => setTimeout(r, 20))
    expect(adapters.dbManager.getRows).toHaveBeenCalledTimes(1)
  })

  it('reads a filtered view again after a cell is saved, with the same filter', async () => {
    await openPatients()
    await follow('Follow name Alice to staff')
    await waitFor(() => screen.getByText('Physician'))
    const filtered = () => adapters.dbManager.getRows.mock.calls.filter(c => c[2] === 'staff' && JSON.stringify(c[5]) === JSON.stringify(toAlice)).length
    expect(filtered()).toBe(1)
    fireEvent.doubleClick(screen.getByText('Physician').closest('td'))
    const box = screen.getByRole('textbox', { name: 'Edit role' })
    fireEvent.change(box, { target: { value: 'Nurse' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(adapters.dbManager.updateCell).toHaveBeenCalled())
    await waitFor(() => expect(filtered()).toBe(2))
    expect(chip()?.textContent).toContain('id = Alice')
  })

  it('does not paint a save that finishes after following into the table now showing', async () => {
    let finish
    adapters.dbManager.updateCell.mockImplementation(() => new Promise(r => { finish = r }))
    adapters.dbManager.getRows.mockImplementation((type, config, table) => Promise.resolve(table === 'patients'
      ? { columns: ['id', 'name'], rows: [[1, 'Alice'], [2, 'Bob']] }
      : { columns: ['id', 'role'], rows: [['Alice', 'Physician'], ['Bob', 'Nurse']] }))
    await openPatients()
    fireEvent.doubleClick(screen.getByText('Bob').closest('td'))
    const box = screen.getByRole('textbox', { name: 'Edit name' })
    fireEvent.change(box, { target: { value: 'Bobby' } })
    fireEvent.blur(box)
    await waitFor(() => expect(adapters.dbManager.updateCell).toHaveBeenCalled())
    await follow('Follow name Alice to staff')
    await waitFor(() => screen.getByText('Nurse'))
    finish({ ok: true, affected: 1 })
    await waitFor(() => expect(screen.getByText('Updated name')).toBeTruthy())
    expect(screen.queryByText('Bobby')).toBeNull()
    expect(screen.getByText('Nurse')).toBeTruthy()
  })

  it('forgets the history when the table is closed', async () => {
    await openPatients()
    await follow('Follow name Alice to staff')
    await waitFor(() => expect(heading().textContent).toBe('staff'))
    fireEvent.click(screen.getByRole('button', { name: 'Close table' }))
    await waitFor(() => expect(heading()).toBeNull())
    adapters.dbManager.getRows.mockClear()
    onScreen()
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })
    await new Promise(r => setTimeout(r, 20))
    expect(adapters.dbManager.getRows).not.toHaveBeenCalled()
    expect(heading()).toBeNull()
    openTable('staff')
    await waitFor(() => expect(heading().textContent).toBe('staff'))
    expect(back().disabled).toBe(true)
  })

  it('goes Back on Alt+←', async () => {
    await openPatients()
    await follow('Follow name Alice to staff')
    await waitFor(() => expect(heading().textContent).toBe('staff'))
    onScreen()
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })
    await waitFor(() => expect(heading().textContent).toBe('patients'))
    expect(back().disabled).toBe(true)
  })
})

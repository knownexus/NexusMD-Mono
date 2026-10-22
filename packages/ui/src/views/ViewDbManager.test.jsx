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

    expect(screen.getByLabelText('SQL query').value).toBe('SELECT * FROM staff')
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

    expect(screen.getByLabelText('SQL query').value).toBe("SELECT * FROM patients\nWHERE status = 'active'")
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
      'SELECT * FROM patients\nLEFT JOIN staff ON patients.id = staff.name',
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

    expect(screen.getByLabelText('SQL query').value).toBe('DELETE FROM patients\nWHERE id = 1')
  })

  it('builds an INSERT query from checked columns', async () => {
    await openQueryTabForPatients()

    fireEvent.click(screen.getByText('Insert'))
    await waitFor(() => screen.getByLabelText('Include name'))

    fireEvent.click(screen.getByLabelText('Include name'))
    fireEvent.change(screen.getByLabelText('Value for name'), { target: { value: 'Alice' } })
    fireEvent.click(screen.getByText('Build'))

    expect(screen.getByLabelText('SQL query').value).toBe("INSERT INTO patients (name) VALUES ('Alice')")
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

    expect(screen.getByLabelText('SQL query').value).toBe("UPDATE patients SET status = 'inactive'\nWHERE id = 1")
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
      'SELECT * FROM patients\nLEFT JOIN staff ON patients.id = staff.name',
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

    expect(screen.getByLabelText('SQL query').value).toBe('SELECT COUNT(id), status FROM patients\nGROUP BY status')
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
    expect(screen.getByLabelText('SQL query').value).toBe("SELECT * FROM appointments WHERE status = 'active'")
    expect(screen.getByRole('tab', { name: 'Query', selected: true })).toBeTruthy()
  })

  it('runs a saved query against the table picked in the Query tab', async () => {
    await demoQueryTab()
    fireEvent.change(screen.getByLabelText('SQL query'), { target: { value: 'SELECT * FROM patients' } })
    saveAs('Everything')
    fireEvent.change(screen.getByLabelText('Tables'), { target: { value: 'staff' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run Everything' }))
    await waitFor(() => expect(screen.getByText(/3 rows returned/i)).toBeTruthy())
    expect(screen.getByLabelText('SQL query').value).toBe('SELECT * FROM staff')
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
    expect(screen.getByLabelText('SQL query').value).toBe('SELECT * FROM staff')
  })
})

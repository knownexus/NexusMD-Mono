// packages/ui/src/views/ViewDbManager.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
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
    expect(screen.getByText('Demo')).toBeTruthy()
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

    fireEvent.change(screen.getByLabelText('Tables'), { target: { value: 'patients' } })
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
  })

  it('filters rows by search term', async () => {
    render(<ViewDbManager adapters={adapters} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Load demo'))
    await waitFor(() => screen.getByText('patients'))
    fireEvent.change(screen.getByLabelText('Tables'), { target: { value: 'patients' } })
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
    fireEvent.change(screen.getByLabelText('Tables'), { target: { value: 'patients' } })
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
    fireEvent.change(screen.getByLabelText('Tables'), { target: { value: 'patients' } })
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
    fireEvent.change(screen.getByLabelText('Tables'), { target: { value: 'patients' } })
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
    fireEvent.change(screen.getByLabelText('Tables'), { target: { value: 'patients' } })
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
    const row = screen.getByText('UAT').closest('button')
    expect(row).toBeTruthy()
    expect(row.textContent).toContain('SQL Server')
  })

  it('connects with a saved fields-mode connection using its resolved secret', async () => {
    const onResolveSecret = vi.fn().mockResolvedValue('secret-pw')
    render(<ViewDbManager adapters={adapters} savedConnections={savedFields} onResolveSecret={onResolveSecret} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('UAT'))

    await waitFor(() => expect(adapters.dbManager.connect).toHaveBeenCalledOnce())
    expect(onResolveSecret).toHaveBeenCalledWith('a')
    expect(adapters.dbManager.connect).toHaveBeenCalledWith('sqlserver', expect.objectContaining({
      server: 'myhost', database: 'mydb', user: 'sa', password: 'secret-pw',
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeTruthy())
    // Sidebar header shows the saved connection's friendly name, not the raw database name.
    expect(document.querySelector('.db-sidebar__db-name').textContent).toBe('UAT')
  })

  it('connects with a saved connection-string-mode connection using its resolved secret', async () => {
    const saved = [{ id: 'b', name: 'Prod', type: 'sqlserver', inputMode: 'connstr' }]
    const onResolveSecret = vi.fn().mockResolvedValue('mssql://user:pass@prodhost:1433/proddb')
    render(<ViewDbManager adapters={adapters} savedConnections={saved} onResolveSecret={onResolveSecret} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('Prod'))

    await waitFor(() => expect(adapters.dbManager.connect).toHaveBeenCalledOnce())
    expect(adapters.dbManager.connect).toHaveBeenCalledWith('sqlserver', expect.objectContaining({
      server: 'prodhost', database: 'proddb', user: 'user', password: 'pass',
    }))
  })

  it('shows an error toast when a saved connection fails to connect', async () => {
    adapters.dbManager.connect.mockRejectedValue(new Error('Connection refused'))
    render(<ViewDbManager adapters={adapters} savedConnections={savedFields} onResolveSecret={vi.fn().mockResolvedValue('pw')} />)
    fireEvent.click(screen.getByText(/Connect to database/i))
    fireEvent.click(screen.getByText('UAT'))

    await waitFor(() => expect(screen.getByText('Connection refused')).toBeTruthy())
  })
})

describe('ViewDbManager — collapsible sidebar sections', () => {
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

  it('lists tables in a dropdown and selects one on change', async () => {
    render(<ViewDbManager adapters={adapters} />)
    await connectDemo()

    const select = screen.getByLabelText('Tables')
    expect(select.tagName).toBe('SELECT')
    expect(screen.getByText('patients').tagName).toBe('OPTION')

    fireEvent.change(select, { target: { value: 'staff' } })
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
    expect(select.value).toBe('staff')
  })

  it('does not show a Databases section when no connections are saved', async () => {
    render(<ViewDbManager adapters={adapters} />)
    await connectDemo()
    expect(screen.queryByText('Databases')).not.toBeTruthy()
  })

  it('shows a collapsible Databases section listing saved connections once connected', async () => {
    const saved = [{ id: 'a', name: 'UAT', type: 'sqlserver' }, { id: 'b', name: 'Prod', type: 'sqlserver' }]
    render(<ViewDbManager adapters={adapters} savedConnections={saved} />)
    await connectDemo()

    expect(screen.getByText('Databases')).toBeTruthy()
    expect(screen.getByText('UAT')).toBeTruthy()
    expect(screen.getByText('Prod')).toBeTruthy()

    fireEvent.click(screen.getByText('Databases'))
    expect(screen.queryByText('UAT')).not.toBeTruthy()
  })

  it('switches to a different saved database directly from the sidebar', async () => {
    const saved = [{ id: 'a', name: 'UAT', type: 'sqlite', inputMode: 'fields', filePath: '/a.db' }]
    const onResolveSecret = vi.fn().mockResolvedValue('')
    // "Load demo" never calls db.connect (it uses in-memory demo data), so this
    // resolves the one real connect() call — switching to the saved connection.
    adapters.dbManager.connect.mockResolvedValueOnce({ ok: true, tables: ['orders'] })
    render(<ViewDbManager adapters={adapters} savedConnections={saved} onResolveSecret={onResolveSecret} />)
    await connectDemo()

    fireEvent.click(screen.getByText('UAT'))
    await waitFor(() => expect(document.querySelector('.db-sidebar__db-name').textContent).toBe('UAT'))
    expect(screen.getByText('orders')).toBeTruthy()
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
    fireEvent.change(screen.getByLabelText('Tables'), { target: { value: 'patients' } })
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
    fireEvent.change(screen.getByLabelText('Tables'), { target: { value: 'patients' } })
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

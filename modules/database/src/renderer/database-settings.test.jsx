import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'


const mockConnect = vi.fn()
vi.mock('./db-manager-adapter.js', () => ({
  dbManagerAdapter: {
    isAvailable: () => true,
    connect: (...args) => mockConnect(...args),
  },
}))

const mockList = vi.fn(() => [])
const mockSaveConnection = vi.fn(async () => 'new-id')
const mockGetSecret = vi.fn(async () => '')
const mockDelete = vi.fn()
vi.mock('./db-manager-config.js', () => ({
  listSavedConnections: (...a) => mockList(...a),
  saveConnection: (...a) => mockSaveConnection(...a),
  getConnectionSecret: (...a) => mockGetSecret(...a),
  deleteConnection: (...a) => mockDelete(...a),
}))

vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ children }) => <div>{children}</div>,
  VsFullRow: ({ children }) => <div>{children}</div>,
  VsSeg: ({ options, onChange, value }) => (
    <div>{options.map(([v, l]) => (
      <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>
    ))}</div>
  ),
  PlToggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>{checked ? 'On' : 'Off'}</button>
  ),
  VsProfiles: () => <div>VsProfiles</div>,
  BackupRestoreCard: () => <div>BackupRestoreCard</div>,
  CloudSyncCard: () => <div>CloudSyncCard</div>,
  BoardColumnsCard: () => <div>BoardColumnsCard</div>,
  IntegrationsView: () => <div>IntegrationsView</div>,
  ThemeChipPicker: () => <div>ThemeChipPicker</div>,
  VsPasswordModal: () => null,
  loadConfidentialConfig: vi.fn(() => ({ sections: [], hash: null })),
  CardFrame: ({ title, children }) => <div><span>{title}</span>{children}</div>,
  Icon: () => null,
  SettField: ({ label, hint, children }) => <div><label>{label}</label>{children}{hint && <span>{hint}</span>}</div>,
  settInputStyle: {},
}))

// The shell hands the card its secure storage through the host.
const host = { adapters: { secureStorage: {} } }

beforeEach(() => {
  vi.clearAllMocks()
  mockList.mockReturnValue([])
  mockSaveConnection.mockResolvedValue('new-id')
  mockGetSecret.mockResolvedValue('')
})

afterEach(() => { cleanup() })

import { DatabaseConnectionCard } from './database-settings.jsx'

describe('DatabaseConnectionCard — connection list', () => {
  it('shows an empty-state message when no connections are saved', () => {
    render(<DatabaseConnectionCard host={host} />)
    expect(screen.getByText(/No saved connections yet/)).toBeTruthy()
  })

  it('lists saved connections with their name and type', () => {
    mockList.mockReturnValue([
      { id: 'a', name: 'UAT', type: 'sqlserver', inputMode: 'fields' },
      { id: 'b', name: 'Local', type: 'sqlite', inputMode: 'fields' },
    ])
    render(<DatabaseConnectionCard host={host} />)
    expect(screen.getByText('UAT')).toBeTruthy()
    expect(screen.getByText('Local')).toBeTruthy()
    expect(screen.getByText('SQLite')).toBeTruthy()
  })

  it('tests a saved connection row using its stored secret', async () => {
    mockList.mockReturnValue([{ id: 'a', name: 'UAT', type: 'sqlserver', inputMode: 'fields', host: 'h', database: 'd' }])
    mockGetSecret.mockResolvedValue('pw')
    mockConnect.mockResolvedValue({ ok: true, tables: ['t1', 't2'] })
    render(<DatabaseConnectionCard host={host} />)
    fireEvent.click(screen.getByText('Test'))
    await waitFor(() => expect(screen.getByText(/found 2 tables/)).toBeTruthy())
    expect(mockConnect).toHaveBeenCalledWith('sqlserver', expect.objectContaining({ server: 'h', database: 'd', password: 'pw' }))
  })

  it('deletes a saved connection', async () => {
    mockList.mockReturnValue([{ id: 'a', name: 'UAT', type: 'sqlserver' }])
    render(<DatabaseConnectionCard host={host} />)
    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith({}, 'a'))
  })

  it('clones a saved connection, copying its metadata and secret under a new name', async () => {
    mockList.mockReturnValue([{ id: 'a', name: 'UAT', type: 'sqlserver', inputMode: 'fields', host: 'h' }])
    mockGetSecret.mockResolvedValue('secret-a')
    render(<DatabaseConnectionCard host={host} />)
    fireEvent.click(screen.getByText('Clone'))
    await waitFor(() => expect(mockSaveConnection).toHaveBeenCalled())
    expect(mockGetSecret).toHaveBeenCalledWith({}, 'a')
    expect(mockSaveConnection).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ name: 'UAT (copy)', type: 'sqlserver', host: 'h' }),
      'secret-a',
    )
    // The clone must not carry over the original's id (a new one is generated).
    expect(mockSaveConnection.mock.calls[0][1].id).toBeUndefined()
  })

  it('opens the form in "new" mode from Add connection, and back to the list on Cancel', () => {
    render(<DatabaseConnectionCard host={host} />)
    fireEvent.click(screen.getByText('Add connection'))
    expect(screen.getByText('New Connection')).toBeTruthy()
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.getByText(/No saved connections yet/)).toBeTruthy()
  })

  it('opens the form pre-filled in "edit" mode from a row\'s Edit button', () => {
    mockList.mockReturnValue([{ id: 'a', name: 'UAT', type: 'sqlserver', inputMode: 'fields', host: 'saved-host' }])
    render(<DatabaseConnectionCard host={host} />)
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByText('Edit Connection')).toBeTruthy()
    expect(screen.getByDisplayValue('saved-host')).toBeTruthy()
  })
})

describe('DatabaseConnectionCard — connection form', () => {
  const openNewForm = () => {
    render(<DatabaseConnectionCard host={host} />)
    fireEvent.click(screen.getByText('Add connection'))
  }

  it('defaults to SQL Server with host/database/user fields', () => {
    openNewForm()
    expect(screen.getByPlaceholderText('myserver.database.windows.net')).toBeTruthy()
    expect(screen.getByPlaceholderText('my_database')).toBeTruthy()
    expect(screen.getByPlaceholderText('sa')).toBeTruthy()
  })

  it('switches to SQLite and shows a file path field instead', () => {
    openNewForm()
    fireEvent.click(screen.getByText('SQLite'))
    expect(screen.getByPlaceholderText('/absolute/path/to/file.db')).toBeTruthy()
    expect(screen.queryByPlaceholderText('my_database')).toBeNull()
  })

  it('tests the connection using the current form fields', async () => {
    mockConnect.mockResolvedValue({ ok: true, tables: ['a', 'b', 'c'] })
    openNewForm()
    fireEvent.change(screen.getByPlaceholderText('myserver.database.windows.net'), { target: { value: 'h' } })
    fireEvent.change(screen.getByPlaceholderText('my_database'), { target: { value: 'd' } })
    fireEvent.click(screen.getByText('Test connection'))
    await waitFor(() => expect(screen.getByText(/found 3 tables/)).toBeTruthy())
    expect(mockConnect).toHaveBeenCalledWith('sqlserver', expect.objectContaining({ server: 'h', database: 'd' }))
  })

  it('requires a name before saving', async () => {
    openNewForm()
    fireEvent.change(screen.getByPlaceholderText('myserver.database.windows.net'), { target: { value: 'h' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(screen.getByText(/give this connection a name/)).toBeTruthy())
    expect(mockSaveConnection).not.toHaveBeenCalled()
  })

  it('saves a new named connection with its password as the secret', async () => {
    openNewForm()
    fireEvent.change(screen.getByPlaceholderText('e.g. UAT, Production'), { target: { value: 'My Server' } })
    fireEvent.change(screen.getByPlaceholderText('myserver.database.windows.net'), { target: { value: 'h' } })
    fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(mockSaveConnection).toHaveBeenCalled())
    expect(mockSaveConnection).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ name: 'My Server', type: 'sqlserver', inputMode: 'fields', host: 'h' }),
      'secret',
    )
  })

  it('returns to the list view after a successful save and dispatches a navigate event to db-manager', async () => {
    const navSpy = vi.fn()
    window.addEventListener('nexusmd:navigate', navSpy)
    try {
      openNewForm()
      fireEvent.change(screen.getByPlaceholderText('e.g. UAT, Production'), { target: { value: 'My Server' } })
      fireEvent.click(screen.getByText('Save'))
      await waitFor(() => expect(screen.queryByText('New Connection')).toBeNull())
      expect(navSpy).toHaveBeenCalledWith(expect.objectContaining({ detail: 'db-manager' }))
    } finally {
      window.removeEventListener('nexusmd:navigate', navSpy)
    }
  })

  it('switching input mode to "Connection string" hides the field inputs and shows a textarea', () => {
    openNewForm()
    fireEvent.click(screen.getByText('Connection string'))
    expect(screen.getByPlaceholderText('mssql://username:password@host:1433/database')).toBeTruthy()
    expect(screen.queryByPlaceholderText('myserver.database.windows.net')).toBeNull()
  })

  it('keeps the connection-string tab in sync with fields entered on the Fields tab', () => {
    openNewForm()
    fireEvent.change(screen.getByPlaceholderText('myserver.database.windows.net'), { target: { value: 'myhost' } })
    fireEvent.change(screen.getByPlaceholderText('my_database'), { target: { value: 'mydb' } })
    fireEvent.click(screen.getByText('Connection string'))
    const textarea = screen.getByPlaceholderText('mssql://username:password@host:1433/database')
    expect(textarea.value).toContain('Server=myhost,1433')
    expect(textarea.value).toContain('Database=mydb')
  })

  it('tests a connection using a raw connection string', async () => {
    mockConnect.mockResolvedValue({ ok: true, tables: ['a'] })
    openNewForm()
    fireEvent.click(screen.getByText('Connection string'))
    fireEvent.change(screen.getByPlaceholderText('mssql://username:password@host:1433/database'), {
      target: { value: 'mssql://user:pass@myhost:1433/mydb' },
    })
    fireEvent.click(screen.getByText('Test connection'))
    await waitFor(() => expect(screen.getByText(/found 1 table/)).toBeTruthy())
    expect(mockConnect).toHaveBeenCalledWith('sqlserver', expect.objectContaining({
      server: 'myhost', database: 'mydb', user: 'user', password: 'pass',
    }))
  })

  it('saves a connection string as the secret', async () => {
    openNewForm()
    fireEvent.change(screen.getByPlaceholderText('e.g. UAT, Production'), { target: { value: 'My Server' } })
    fireEvent.click(screen.getByText('Connection string'))
    fireEvent.change(screen.getByPlaceholderText('mssql://username:password@host:1433/database'), {
      target: { value: 'mssql://user:pass@myhost:1433/mydb' },
    })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(mockSaveConnection).toHaveBeenCalled())
    expect(mockSaveConnection).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ name: 'My Server', inputMode: 'connstr' }),
      'mssql://user:pass@myhost:1433/mydb',
    )
  })

  it('includes the password typed on the Fields tab in the auto-generated connection string', () => {
    openNewForm()
    fireEvent.change(screen.getByPlaceholderText('myserver.database.windows.net'), { target: { value: 'myhost' } })
    fireEvent.change(screen.getByPlaceholderText('sa'), { target: { value: 'admin' } })
    const passwordInputs = document.querySelectorAll('input[type="password"]')
    fireEvent.change(passwordInputs[0], { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByText('Connection string'))
    const textarea = screen.getByPlaceholderText('mssql://username:password@host:1433/database')
    expect(textarea.value).toContain('User Id=admin')
    expect(textarea.value).toContain('Password=hunter2')
  })

  it('fills in the fields from a pasted connection string', () => {
    openNewForm()
    fireEvent.click(screen.getByText('Connection string'))
    fireEvent.change(screen.getByPlaceholderText('mssql://username:password@host:1433/database'), {
      target: { value: 'Server=pasted.example,1500;Database=sales;User Id=app;Password=pw;' },
    })
    fireEvent.click(screen.getByText('Fill in fields'))

    expect(screen.getByPlaceholderText('myserver.database.windows.net').value).toBe('pasted.example')
    expect(screen.getByPlaceholderText('1433').value).toBe('1500')
    expect(screen.getByPlaceholderText('my_database').value).toBe('sales')
    expect(screen.getByPlaceholderText('sa').value).toBe('app')
    expect(document.querySelector('input[type="password"]').value).toBe('pw')
  })

  it('says why a connection string cannot be read into the fields', () => {
    openNewForm()
    fireEvent.click(screen.getByText('Connection string'))
    fireEvent.change(screen.getByPlaceholderText('mssql://username:password@host:1433/database'), {
      target: { value: 'Server=x;Authentication=Active Directory Integrated;' },
    })
    fireEvent.click(screen.getByText('Fill in fields'))
    expect(screen.getByText(/couldn.t read that connection string/)).toBeTruthy()
    expect(screen.getByPlaceholderText('mssql://username:password@host:1433/database')).toBeTruthy()
  })
})

describe('DatabaseConnectionCard — editing prefills the saved secret', () => {
  const openEditForm = (entry) => {
    mockList.mockReturnValue([entry])
    render(<DatabaseConnectionCard host={host} />)
    fireEvent.click(screen.getByText('Edit'))
  }

  it('loads the saved password into the Password field so it can be seen/edited', async () => {
    mockGetSecret.mockResolvedValue('hunter2')
    openEditForm({ id: 'a', name: 'UAT', type: 'sqlserver', inputMode: 'fields', host: 'h' })
    await waitFor(() => expect(mockGetSecret).toHaveBeenCalledWith({}, 'a'))
    const passwordInputs = document.querySelectorAll('input[type="password"]')
    await waitFor(() => expect(passwordInputs[0].value).toBe('hunter2'))
  })

  it('includes the loaded password in the connection-string preview once fetched', async () => {
    mockGetSecret.mockResolvedValue('hunter2')
    openEditForm({ id: 'a', name: 'UAT', type: 'sqlserver', inputMode: 'fields', host: 'h', user: 'admin' })
    fireEvent.click(screen.getByText('Connection string'))
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText('mssql://username:password@host:1433/database')
      expect(textarea.value).toContain('Password=hunter2')
    })
  })

  it('loads the saved connection string (with its password) when editing a connstr-mode connection', async () => {
    mockGetSecret.mockResolvedValue('mssql://user:hunter2@h:1433/d')
    openEditForm({ id: 'a', name: 'UAT', type: 'sqlserver', inputMode: 'connstr' })
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText('mssql://username:password@host:1433/database')
      expect(textarea.value).toBe('mssql://user:hunter2@h:1433/d')
    })
  })
})

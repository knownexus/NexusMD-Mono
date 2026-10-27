// packages/ui/src/views/db-structure-panel.jsx
//
// The Structure tab: a table's columns, the foreign keys it holds, the keys that point at it and
// its indexes. Target tables are links; `focusKey` names a key whose row to scroll to and mark.

import { useEffect, useRef } from 'react'

// A column's type as the headers show it: int, nvarchar(50), decimal(8,2), nvarchar(max).
export function typeLabelOf(col) {
  const t = String(col.dataType ?? '').toLowerCase()
  if (col.maxLength === -1) return `${t}(max)`
  if (col.maxLength > 0 && /char|binary/.test(t)) return `${t}(${col.maxLength})`
  if (col.precision != null && col.scale != null) return `${t}(${col.precision},${col.scale})`
  return t
}

// Only the actions that do something; NO ACTION is the default and just noise.
function actionsOf(fk) {
  return [
    fk.onDelete && fk.onDelete !== 'NO ACTION' && `ON DELETE ${fk.onDelete}`,
    fk.onUpdate && fk.onUpdate !== 'NO ACTION' && `ON UPDATE ${fk.onUpdate}`,
  ].filter(Boolean)
}

const list = names => names.join(', ')

function TableLink({ table, onOpenTable }) {
  return (
    <button type="button" className="nx-db-structure-link" aria-label={`Open ${table}`} onClick={() => onOpenTable(table)}>{table}</button>
  )
}

function Section({ title, children }) {
  const id = `nx-db-structure-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section className="nx-db-structure-section" role="region" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  )
}

const None = () => <p className="nx-db-structure-none">None</p>

export function StructurePanel({ structure, isView = false, loading = false, error = null, onOpenTable, onRefresh, focusKey = null }) {
  const rootRef = useRef(null)

  useEffect(() => {
    if (!focusKey || !structure) return
    const row = [...(rootRef.current?.querySelectorAll('[data-key]') ?? [])].find(el => el.dataset.key === focusKey)
    row?.scrollIntoView?.({ block: 'center' })
  }, [focusKey, structure])

  if (!structure) {
    return (
      <div className="nx-db-state">
        {error ? (
          <>
            <div className="nx-db-alert" role="alert">{error}</div>
            {onRefresh && <button type="button" className="btn sm" onClick={onRefresh}>Try again</button>}
          </>
        ) : (
          <><span className="nx-db-spinner" aria-hidden="true" />{loading ? 'Reading structure…' : 'No structure to show.'}</>
        )}
      </div>
    )
  }

  const { columns = [], foreignKeys = [], referencedBy = [], indexes = [] } = structure
  // A column's foreign keys, so it can link to the table it points at.
  const fksOf = name => foreignKeys.filter(fk => fk.columns.includes(name))
  const row = key => ({ 'data-key': key, 'data-focus': key === focusKey ? 'true' : undefined })

  return (
    <div className="nx-db-structure" ref={rootRef}>
      <Section title="Columns">
        <table className="nx-db-structure-table">
          <thead><tr><th>Name</th><th>Type</th><th>Flags</th><th>References</th></tr></thead>
          <tbody>
            {columns.map(col => (
              <tr key={col.name}>
                <td className="name">{col.name}</td>
                <td className="type">{typeLabelOf(col)}</td>
                <td className="flags">
                  {col.isPrimaryKey && <span className="pk">key</span>}
                  {col.nullable ? <span className="flag">null</span> : <span className="flag">required</span>}
                  {col.isIdentity && <span className="flag">identity</span>}
                  {col.isComputed && <span className="flag">computed</span>}
                </td>
                <td className="refs">
                  {fksOf(col.name).map(fk => (
                    <span key={fk.name}>→ <TableLink table={fk.refTable} onOpenTable={onOpenTable} />{fk.refColumns[fk.columns.indexOf(col.name)] ? `.${fk.refColumns[fk.columns.indexOf(col.name)]}` : ''}</span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {isView ? (
        <p className="nx-db-structure-none">Views have no keys or indexes of their own.</p>
      ) : (
        <>
          <Section title="Foreign keys">
            {foreignKeys.length === 0 ? <None /> : foreignKeys.map(fk => (
              <div key={fk.name} className="nx-db-structure-row" {...row(fk.name)}>
                <span className="key-name">{fk.name}</span>
                <span>
                  {list(fk.columns)} → <TableLink table={fk.refTable} onOpenTable={onOpenTable} />
                  {fk.refColumns.length > 0 && ` (${list(fk.refColumns)})`}
                </span>
                {actionsOf(fk).map(a => <span key={a} className="flag">{a}</span>)}
              </div>
            ))}
          </Section>

          <Section title="Referenced by">
            {referencedBy.length === 0 ? <None /> : referencedBy.map(ref => (
              <div key={`${ref.table}/${ref.name}`} className="nx-db-structure-row" {...row(ref.name)}>
                <span className="key-name">{ref.name}</span>
                <span>
                  <TableLink table={ref.table} onOpenTable={onOpenTable} /> ({list(ref.columns)}) → ({list(ref.refColumns)})
                </span>
                {actionsOf(ref).map(a => <span key={a} className="flag">{a}</span>)}
              </div>
            ))}
          </Section>

          <Section title="Indexes">
            {indexes.length === 0 ? <None /> : indexes.map(ix => (
              <div key={ix.name} className="nx-db-structure-row" {...row(ix.name)}>
                <span className="key-name">{ix.name}</span>
                <span>{ix.columns.map(c => `${c.name ?? '(expression)'}${c.desc ? ' desc' : ''}`).join(', ')}</span>
                {ix.primaryKey && <span className="pk">primary key</span>}
                {ix.unique && <span className="flag">unique</span>}
                {ix.filter && <span className="flag">where {ix.filter}</span>}
              </div>
            ))}
          </Section>
        </>
      )}
    </div>
  )
}

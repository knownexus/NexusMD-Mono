// packages/core/src/modules/db-manager/cell-types.js
//
// What a table cell may hold, by its column type, so the grid can offer the right editor and
// refuse a value the database would reject. Pure — works on the column metadata getColumns()
// returns ({ name, dataType, nullable, maxLength, precision, scale, isIdentity, isComputed }).

// Whole-number ranges, as BigInt so bigint's limits are exact.
const INT_RANGES = {
  tinyint:  [0n, 255n],
  smallint: [-32768n, 32767n],
  int:      [-2147483648n, 2147483647n],
  bigint:   [-9223372036854775808n, 9223372036854775807n],
}
// Types a person can't sensibly type a value for: the database writes them, or they're bytes.
const READONLY_TYPES = /^(timestamp|rowversion|binary|varbinary|image|blob|geography|geometry|hierarchyid|sql_variant)$/
const DECIMAL_TYPES = /^(decimal|numeric|money|smallmoney|float|real|double|double precision)$/

const baseType = col => String(col?.dataType ?? '').toLowerCase().replace(/\(.*$/, '').trim()

/**
 * The editor a column gets.
 * @returns {'integer'|'decimal'|'boolean'|'date'|'datetime'|'datetimeoffset'|'time'|'guid'|'text'|'readonly'}
 */
export function columnKind(col) {
  if (!col) return 'text'
  if (col.isIdentity || col.isComputed) return 'readonly'
  const t = baseType(col)
  if (READONLY_TYPES.test(t)) return 'readonly'
  if (t === 'bit' || t === 'bool' || t === 'boolean') return 'boolean'
  if (t in INT_RANGES || t === 'integer' || t === 'mediumint') return 'integer'
  if (DECIMAL_TYPES.test(t)) return 'decimal'
  if (t === 'date') return 'date'
  if (t === 'datetimeoffset') return 'datetimeoffset'
  if (t === 'datetime' || t === 'datetime2' || t === 'smalldatetime') return 'datetime'
  if (t === 'time') return 'time'
  if (t === 'uniqueidentifier') return 'guid'
  return 'text'
}

/** Whether `text` may be left in the editor while typing (so letters never land in a number box). */
export function isPartialInput(kind, text) {
  if (kind === 'integer') return /^-?\d*$/.test(text)
  if (kind === 'decimal') return /^-?\d*\.?\d*$/.test(text)
  if (kind === 'datetimeoffset') return /^[\d\-T: .:+Z]*$/.test(text)
  return true
}

const pad = n => String(n).padStart(2, '0')
// Dates come back from the driver in UTC; showing their UTC parts keeps the stored value.
const isoParts = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`

/** A stored value as the text its editor shows. */
export function cellToInput(col, value) {
  if (value === null || value === undefined) return ''
  const kind = columnKind(col)
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = isoParts(value)
    if (kind === 'date') return iso.slice(0, 10)
    if (kind === 'time') return iso.slice(11)
    return kind === 'datetimeoffset' ? `${iso}+00:00` : iso
  }
  if (kind === 'datetime' && typeof value === 'string') return value.replace(' ', 'T').replace(/\.\d+$/, '').replace(/Z$/, '')
  return String(value)
}

const isRealDate = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * Checks what was typed against the column and returns the value to write, or why it can't be.
 * Exact numbers (bigint beyond JS's safe range, decimal, numeric, money) are returned as text so
 * nothing is lost on the way; the database converts them.
 * @param {object} col
 * @param {string|boolean} input
 * @param {{ isNull?: boolean }} [opts]  isNull: the person chose NULL explicitly.
 * @returns {{ value: any } | { error: string }}
 */
export function parseCellInput(col, input, { isNull = false } = {}) {
  const kind = columnKind(col)
  const nullable = !!col?.nullable
  if (kind === 'readonly') return { error: `The database sets ${col?.name ?? 'this column'}; it can't be edited.` }
  if (isNull) return nullable ? { value: null } : { error: `${col?.name ?? 'This column'} can't be NULL.` }

  if (kind === 'boolean') return { value: input === true || /^(true|1)$/i.test(String(input)) }
  const text = String(input ?? '')
  if (kind === 'text') {
    const max = col?.maxLength
    if (max > 0 && text.length > max) return { error: `At most ${max} characters (this is ${text.length}).` }
    return { value: text }
  }

  const v = text.trim()
  // An empty number, date or GUID means "no value": NULL where that's allowed.
  if (v === '') return nullable ? { value: null } : { error: `${col?.name ?? 'This column'} needs a value.` }

  if (kind === 'integer') {
    if (!/^-?\d+$/.test(v)) return { error: 'Enter a whole number.' }
    const range = INT_RANGES[baseType(col)] ?? INT_RANGES.bigint
    const n = BigInt(v)
    if (n < range[0] || n > range[1]) return { error: `Must be a whole number from ${range[0]} to ${range[1]}.` }
    return { value: Number.isSafeInteger(Number(v)) ? Number(v) : v }
  }

  if (kind === 'decimal') {
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(v)) return { error: 'Enter a number.' }
    const t = baseType(col)
    if (t === 'float' || t === 'real' || t.startsWith('double')) return { value: Number(v) }
    const [whole, frac = ''] = v.replace(/^-/, '').split('.')
    const { precision, scale } = col ?? {}
    if (scale != null && frac.length > scale) return { error: `At most ${scale} decimal places.` }
    if (precision != null && scale != null && whole.replace(/^0+(?=\d)/, '').length > precision - scale) {
      return { error: `At most ${precision - scale} digits before the decimal point.` }
    }
    return { value: v }
  }

  if (kind === 'date') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m || !isRealDate(+m[1], +m[2], +m[3])) return { error: 'Enter a real date (YYYY-MM-DD).' }
    return { value: v }
  }

  if (kind === 'datetime') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/)
    if (!m || !isRealDate(+m[1], +m[2], +m[3]) || +m[4] > 23 || +m[5] > 59 || +(m[6] ?? 0) > 59) {
      return { error: 'Enter a real date and time.' }
    }
    return { value: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${m[7] ?? ''}` }
  }

  if (kind === 'datetimeoffset') {
    // No offset (or Z) means UTC, so what's stored is never a guess at the viewer's zone.
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i)
    const off = m && (!m[8] || /^z$/i.test(m[8]) ? '+00:00' : m[8].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2'))
    if (!m || !isRealDate(+m[1], +m[2], +m[3]) || +m[4] > 23 || +m[5] > 59 || +(m[6] ?? 0) > 59
      || +off.slice(1, 3) > 14 || +off.slice(4) > 59) {
      return { error: 'Enter a real date, time and offset (YYYY-MM-DDTHH:MM:SS+HH:MM).' }
    }
    return { value: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${m[7] ?? ''}${off}` }
  }

  if (kind === 'time') {
    const m = v.match(/^(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/)
    if (!m || +m[1] > 23 || +m[2] > 59 || +(m[3] ?? 0) > 59) return { error: 'Enter a real time (HH:MM:SS).' }
    return { value: `${m[1]}:${m[2]}:${m[3] ?? '00'}${m[4] ?? ''}` }
  }

  if (kind === 'guid') {
    if (!/^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(v)) {
      return { error: 'Enter a GUID like 6F9619FF-8B86-D011-B42D-00C04FC964FF.' }
    }
    return { value: v.replace(/[{}]/g, '') }
  }

  return { value: text }
}

// packages/ui/src/views/db-sql-format.js
//
// A light SQL formatter for the Query tab's Format button: keywords upper-cased, each clause on a
// line of its own, SELECT/SET lists one item per line, AND/OR in a WHERE on lines of their own and
// subqueries indented. Strings, [names], "names", `names` and comments are kept exactly as written.
// It changes only whitespace and keyword case, so the formatted SQL means the same thing.

const KEYWORDS = new Set(`
  ADD ALL ALTER AND ANY AS ASC BETWEEN BY CASE CAST CHECK COLUMN CONSTRAINT CREATE CROSS DATABASE
  DECLARE DEFAULT DELETE DESC DISTINCT DROP ELSE END EXCEPT EXEC EXECUTE EXISTS FETCH FOREIGN FROM
  FULL GROUP HAVING IF IN INDEX INNER INSERT INTERSECT INTO IS JOIN KEY LEFT LIKE LIMIT MERGE NEXT
  NOT NULL OFFSET ON ONLY OR ORDER OUTER OVER PARTITION PERCENT PRIMARY PROCEDURE REFERENCES RETURNING RIGHT
  ROWS SELECT SET TABLE THEN TOP TRUNCATE UNION UNIQUE UPDATE USING VALUES VIEW WHEN WHERE WITH
  APPLY MATCHED OUTPUT ROW
`.trim().split(/\s+/))

// Clauses that start a line of their own.
const CLAUSES = new Set(['SELECT', 'FROM', 'WHERE', 'HAVING', 'LIMIT', 'OFFSET', 'VALUES', 'SET',
  'UNION', 'EXCEPT', 'INTERSECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH', 'MERGE', 'OUTPUT', 'RETURNING', 'USING'])
// Words that start a JOIN clause (LEFT OUTER JOIN, CROSS APPLY, …).
const JOIN_START = new Set(['JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER'])

const TOKEN = new RegExp([
  /(--[^\n]*)/,                         // 1 line comment
  /(\/\*[\s\S]*?(?:\*\/|$))/,           // 2 block comment
  /([Nn]?'(?:[^']|'')*'?)/,             // 3 string
  /(\[(?:[^\]]|\]\])*\]?|"(?:[^"]|"")*"?|`[^`]*`?)/, // 4 quoted name
  /(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)/, // 5 number
  /([@#$]*[A-Za-z_À-￿][\w$#@À-￿]*|@@?\w+)/, // 6 word, @variable, #temp
  /(<>|<=|>=|!=|!<|!>|::|\|\||[-+*/%=<>&|^~!])/, // 7 operator
  /([(),.;])/,                          // 8 punctuation
  /(\s+)/,                              // 9 whitespace
  /([\s\S])/,                           // 10 anything else
].map(r => r.source).join('|'), 'g')

export function tokenizeSql(sql) {
  const out = []
  for (const m of String(sql).matchAll(TOKEN)) {
    const kind = m[1] ? 'line-comment' : m[2] ? 'comment' : m[3] ? 'string' : m[4] ? 'name' : m[5] ? 'number'
      : m[6] ? 'word' : m[7] ? 'op' : m[8] ? 'punct' : m[9] ? 'space' : 'other'
    out.push({ kind, text: m[0] })
  }
  return out
}

const INDENT = '  '

export function formatSql(sql) {
  const tokens = tokenizeSql(sql).filter(t => t.kind !== 'space')
  if (!tokens.length) return ''
  const upper = t => (t?.kind === 'word' ? t.text.toUpperCase() : null)

  // One frame per open bracket; `clause` frames (the top level and subqueries) get line breaks.
  const stack = [{ clause: true, depth: 0, current: null, between: false }]
  const top = () => stack[stack.length - 1]
  let out = ''
  let lineStart = true

  // Starts a line at `depth`; on a line that has nothing on it yet, only its indent changes.
  const newline = (depth) => {
    out = out.replace(/[ \t]+$/, '')
    if (out && !(lineStart && out.endsWith('\n'))) out += '\n'
    out += INDENT.repeat(depth)
    lineStart = true
  }
  // Whether the list a SELECT or SET at `i` starts has more than one item (a comma at its own level).
  const isList = (i) => {
    for (let j = i + 1, depth = 0; j < tokens.length; j++) {
      const x = tokens[j], w = upper(x)
      if (x.text === '(') depth++
      else if (x.text === ')') { if (--depth < 0) return false }
      else if (x.text === ';') return false
      else if (depth === 0 && x.text === ',') return true
      else if (depth === 0 && w && (CLAUSES.has(w) || JOIN_START.has(w))) return false
    }
    return false
  }
  const emit = (text, { space = true } = {}) => {
    if (!lineStart && space && out && !/[\s(]$/.test(out) && !out.endsWith('.')) out += ' '
    out += text
    lineStart = false
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], prev = tokens[i - 1], next = tokens[i + 1]
    const word = upper(t)
    const frame = top()

    if (t.kind === 'line-comment') { emit(t.text); newline(frame.clause ? frame.depth + (frame.current ? 1 : 0) : frame.depth); continue }
    if (t.kind === 'comment') { emit(t.text); continue }

    if (t.text === ';') {
      out = out.replace(/\s+$/, '') + ';'
      stack.length = 1
      Object.assign(stack[0], { current: null, between: false })
      if (i < tokens.length - 1) { out += '\n\n'; lineStart = true }
      continue
    }

    if (t.text === '(') {
      const sub = ['SELECT', 'WITH'].includes(upper(next))
      // No space between a function (or table) name and its bracket.
      // (A table's column list after INSERT INTO keeps its space.)
      const tight = frame.current !== 'INSERT' && prev && ((prev.kind === 'word' && !KEYWORDS.has(upper(prev))) || prev.kind === 'name')
      emit('(', { space: !tight })
      stack.push({ clause: sub, depth: frame.depth + (frame.clause ? 1 : 0), current: null, between: false, sub })
      if (sub) newline(top().depth)
      continue
    }
    if (t.text === ')') {
      const closing = stack.length > 1 ? stack.pop() : null
      if (closing?.sub) newline(closing.depth - 1)
      emit(')', { space: false })
      continue
    }
    if (t.text === ',') {
      emit(',', { space: false })
      if (frame.clause && frame.list) newline(frame.depth + 1)
      continue
    }
    if (t.text === '.') { emit('.', { space: false }); continue }

    if (t.kind === 'word') {
      const isKeyword = KEYWORDS.has(word) && prev?.text !== '.' && next?.text !== '.'
      const text = isKeyword ? word : t.text

      if (frame.clause && isKeyword) {
        const startsJoin = JOIN_START.has(word) && !JOIN_START.has(upper(prev)) && next?.text !== '(' &&
          (word === 'JOIN' || ['JOIN', 'OUTER', 'APPLY'].includes(upper(next)) || (word === 'CROSS' && upper(next) === 'APPLY'))
        const startsClause = CLAUSES.has(word) &&
          !(word === 'FROM' && upper(prev) === 'DELETE') &&
          // WITH (NOLOCK) is a table hint, not a CTE.
          !(word === 'WITH' && next?.text === '(')
        const groupOrOrder = (word === 'GROUP' || word === 'ORDER') && upper(next) === 'BY'
        if (startsJoin || startsClause || groupOrOrder) {
          const after = frame.current
          if (out) newline(frame.depth)
          emit(text)
          frame.current = startsJoin ? 'JOIN' : word
          frame.between = false
          // A list of several items goes one per line under its clause; a single item stays beside it.
          frame.list = (word === 'SELECT' || (word === 'SET' && after === 'UPDATE')) && isList(i)
          if (frame.list) newline(frame.depth + 1)
          continue
        }
        if (word === 'ON' && frame.current === 'JOIN') { newline(frame.depth + 1); emit(text); continue }
        if (word === 'BETWEEN') frame.between = true
        if ((word === 'AND' || word === 'OR') && ['WHERE', 'HAVING', 'JOIN'].includes(frame.current)) {
          if (word === 'AND' && frame.between) { frame.between = false; emit(text); continue }
          newline(frame.depth + 1)
          emit(text)
          continue
        }
      }
      // N'…' and @variables stay joined to what they belong to.
      emit(text)
      continue
    }

    if (t.kind === 'string' && prev?.kind === 'word' && prev.text.toUpperCase() === 'N' && out.endsWith('N')) { emit(t.text, { space: false }); continue }

    // A unary minus or plus sits against its number.
    if (t.kind === 'number' && prev && (prev.text === '-' || prev.text === '+')) {
      const before = tokens[i - 2]
      const unary = !before || before.kind === 'op' || ['(', ',', '='].includes(before.text) || (before.kind === 'word' && KEYWORDS.has(upper(before)))
      if (unary) { emit(t.text, { space: false }); continue }
    }
    emit(t.text)
  }
  return out.replace(/[ \t]+$/gm, '').replace(/^\n+/, '').trimEnd()
}

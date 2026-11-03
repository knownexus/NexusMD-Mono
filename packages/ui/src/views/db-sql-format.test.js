import { describe, it, expect } from 'vitest'
import { formatSql, tokenizeSql } from './db-sql-format.js'

// What the SQL says, ignoring layout and keyword case: formatting must never change this.
const meaning = sql => tokenizeSql(sql).filter(t => t.kind !== 'space').map(t => (t.kind === 'word' ? t.text.toUpperCase() : t.text))

describe('formatSql', () => {
  it('puts each clause on its own line and a SELECT list one item per line', () => {
    expect(formatSql('select a.id, count(*) as n from Member a left join Booking b on b.MemberId = a.Id where a.x = 1 and a.y = 2 group by a.id order by n desc'))
      .toBe([
        'SELECT',
        '  a.id,',
        '  count(*) AS n',
        'FROM Member a',
        'LEFT JOIN Booking b',
        '  ON b.MemberId = a.Id',
        'WHERE a.x = 1',
        '  AND a.y = 2',
        'GROUP BY a.id',
        'ORDER BY n DESC',
      ].join('\n'))
  })

  it('keeps a single-item SELECT beside its keyword', () => {
    expect(formatSql('select * from t')).toBe('SELECT *\nFROM t')
  })

  it('indents a subquery and keeps BETWEEN … AND together', () => {
    expect(formatSql("delete from T where d between 1 and 5 and id in (select id from U where z = N'a')"))
      .toBe("DELETE FROM T\nWHERE d BETWEEN 1 AND 5\n  AND id IN (\n  SELECT id\n  FROM U\n  WHERE z = N'a'\n)")
  })

  it('separates statements with a blank line', () => {
    expect(formatSql("insert into T (a, b) values (1, 'x'); update T set a = 2 where b = 'x';"))
      .toBe("INSERT INTO T (a, b)\nVALUES (1, 'x');\n\nUPDATE T\nSET a = 2\nWHERE b = 'x';")
  })

  it('leaves strings, quoted names and comments exactly as written', () => {
    const sql = "select [select from], \"where\" from t -- from here\nwhere x = 'and select; from' /* or */"
    const out = formatSql(sql)
    expect(out).toContain('[select from]')
    expect(out).toContain('"where"')
    expect(out).toContain("'and select; from'")
    expect(out).toContain('-- from here\n')
    expect(out).toContain('/* or */')
  })

  it('treats WITH (NOLOCK) as a table hint and a CTE as a clause', () => {
    expect(formatSql('with r as (select * from B with (nolock)) select * from r'))
      .toBe('WITH r AS (\n  SELECT *\n  FROM B WITH (nolock)\n)\nSELECT *\nFROM r')
  })

  it('does not upper-case a column that is also a keyword when it is qualified', () => {
    expect(formatSql('select t.key, t.order from t')).toBe('SELECT\n  t.key,\n  t.order\nFROM t')
  })

  it.each([
    'select a.id, count(*) as n, b.name from [dbo].[Member] a left outer join Booking b on b.MemberId = a.Id and b.x = -1 where a.status = N\'active\' or a.vip = 1 having count(*) > 2',
    "update Member set Name = 'it''s; fine', Age = Age + 1 where Id in (select MemberId from Booking where Date > '2024-01-01') -- trailing\n",
    'with recent as (select * from Booking with (nolock) where d > getdate()) select top 10 * from recent cross apply dbo.fn(recent.id) f',
    'SELECT CASE WHEN x > 0 THEN \'pos\' ELSE \'neg\' END AS sign, @var, #temp.id FROM #temp',
  ])('changes only layout and keyword case: %s', (sql) => {
    expect(meaning(formatSql(sql))).toEqual(meaning(sql))
    // Formatting again changes nothing.
    expect(formatSql(formatSql(sql))).toBe(formatSql(sql))
  })

  it('returns an empty string for blank input', () => {
    expect(formatSql('   \n ')).toBe('')
  })
})

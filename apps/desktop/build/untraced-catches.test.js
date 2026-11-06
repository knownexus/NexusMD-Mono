// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { findUntracedCatches } from './untraced-catches.mjs'

const found = (code) => findUntracedCatches(code).map(h => h.line)

describe('findUntracedCatches: a handled error that leaves no trace', () => {
  it('finds a catch that ignores its error and carries on', () => {
    expect(found('try { a() } catch { return null }')).toEqual([1])
    expect(found('try { a() } catch (e) { return null }')).toEqual([1])
  })

  it('finds a catch that uses the error only to tell the user (the log never hears of it)', () => {
    expect(found('try { a() } catch (e) { setMessage(e.message) }')).toEqual([1])
    expect(found('try { a() } catch (e) { toast(`failed: ${e.message}`, "error") }')).toEqual([1])
  })

  it('finds a catch that throws a different error and drops the cause (the "Cannot reach the server" case)', () => {
    expect(found("try { a() } catch { throw new AccountError('offline', 0, 'Network unavailable') }")).toEqual([1])
    expect(found("try { a() } catch (err) { throw new AccountError('offline') }")).toEqual([1])
  })

  it('finds a promise handler that turns the failure into a value or nothing', () => {
    expect(found('a().catch(() => null)')).toEqual([1])
    expect(found('a().catch(() => {})')).toEqual([1])
    expect(found('a().catch((e) => ({ ok: false, error: e.message }))')).toEqual([1])
  })

  it('finds each one, with its line, even inside functions and nested handlers', () => {
    const code = ['async function f() {', '  try { a() } catch { x = 1 }', '  try { b() } catch { try { c() } catch { y = 2 } }', '}'].join('\n')
    expect(found(code)).toEqual([2, 3, 3])
  })
})

describe('findUntracedCatches: what is traced', () => {
  it('a catch that logs is traced, whatever it logs through', () => {
    expect(found("try { a() } catch (e) { log.warn('x', e) }")).toEqual([])
    expect(found("try { a() } catch (e) { modLog.error('x', e) }")).toEqual([])
    expect(found("try { a() } catch (e) { ctx.log.info('x', e) }")).toEqual([])
    expect(found("try { a() } catch (e) { log.scope('lifecycle').warn('x', e) }")).toEqual([])
    expect(found("try { a() } catch (e) { logger.warn('x') }")).toEqual([])
  })

  it('the sanctioned way to ignore an error is traced', () => {
    expect(found("try { a() } catch (e) { ignore(log, 'why', e) }")).toEqual([])
    expect(found("a().catch(ignored(log, 'why'))")).toEqual([])
    expect(found("a().catch(err => ignore(log, 'why', err))")).toEqual([])
  })

  it('a render error handed to the shell is traced', () => {
    expect(found('try { a() } catch (e) { reportRenderError(e) }')).toEqual([])
  })

  it('rethrowing the error is traced: it goes on to something that logs it', () => {
    expect(found('try { a() } catch (e) { throw e }')).toEqual([])
    expect(found("try { a() } catch (e) { throw new AccountError('offline', 0, 'x', { cause: e }) }")).toEqual([])
    expect(found("try { a() } catch (e) { cleanup(); throw Object.assign(new Error('x'), { cause: e }) }")).toEqual([])
  })

  it('passing the error on by name is traced (it is the other function\'s to handle)', () => {
    expect(found('a().catch(reject)')).toEqual([])
    expect(found('a().catch(handleError)')).toEqual([])
  })

  it('a logger call in a function the block only declares does not count: that function may never run', () => {
    expect(found("try { a() } catch (e) { const later = () => log.warn('x', e); }")).toEqual([1])
  })

  it('a rethrow inside a function the block only declares does not count either', () => {
    expect(found('try { a() } catch (e) { const later = () => { throw e }; }')).toEqual([1])
  })
})

describe('findUntracedCatches: it must not be fooled, or fail quietly', () => {
  it('takes JSX and modern syntax', () => {
    expect(found('const C = () => { try { a() } catch { return <b>oops</b> } ; return <i/> }')).toEqual([1])
    expect(found('const x = a?.b ?? c; try { await d() } catch { } finally { e() }')).toEqual([1])
  })

  it('says so when it cannot read a file, rather than skipping it', () => {
    expect(() => findUntracedCatches('try { a( catch {')).toThrow(/could not be read/)
  })

  it('gives a snippet to find it by', () => {
    const [hit] = findUntracedCatches('const a = 1\ntry { b() } catch { c = 2 }\n')
    expect(hit.line).toBe(2)
    expect(hit.snippet).toContain('catch')
  })
})

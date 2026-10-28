// bruno-prelude.sandbox.js — NOT a module. bruno-runtime.cjs reads this file as
// text and evaluates it INSIDE the script sandbox, before a Bruno-style script.
// It builds Bruno's script API (bru, req, res, test, expect, console, Buffer)
// out of the sandbox's own objects, so nothing from the host realm is ever
// handed to the script (see api-client-script.cjs for why that matters).
//
// The host talks to it only through JSON strings:
//   __input              set by the host before this file runs:
//                        { phase, env, vars, request, response }
//   __begin(fn)          starts the user's script (wrapped in an async fn)
//   __report()           -> JSON { finished, error, pending, context, logs }
//   __settle(id, json)   resolves a pending bru.runRequest with its result
/* eslint-disable no-var */
/* global __input */
(function (global) {
  'use strict'

  var input = __input || {}
  var env = input.env || {}
  var runtime = input.vars || {}
  var request = input.request || null
  var response = input.response || null
  var tests = []
  var testPromises = []
  var logs = []
  var pending = []
  var waiters = {}
  var nextId = 1
  var skipped = false
  var finished = null

  function errorMessage(e) {
    if (e && typeof e === 'object' && typeof e.message === 'string') return e.message
    return String(e)
  }

  function format(v) {
    if (typeof v === 'string') return "'" + v + "'"
    if (v === undefined) return 'undefined'
    if (typeof v === 'function') return '[Function]'
    try { var s = JSON.stringify(v); return s === undefined ? String(v) : s } catch (e) { return String(v) }
  }

  function unsupported(name) {
    return function () { throw new Error(name + ' is not supported in NexusMD yet') }
  }

  // ── console ────────────────────────────────────────────────────────────────
  function logger(level) {
    return function () {
      var parts = []
      for (var i = 0; i < arguments.length; i++) parts.push(typeof arguments[i] === 'string' ? arguments[i] : format(arguments[i]))
      logs.push({ level: level, message: parts.join(' ') })
    }
  }
  global.console = { log: logger('log'), info: logger('info'), warn: logger('warn'), error: logger('error'), debug: logger('debug') }

  // ── Buffer / atob / btoa (base64 + UTF-8 only — what JWT-decoding tests need) ─
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

  function utf8Encode(str) {
    var bytes = []
    for (var i = 0; i < str.length; i++) {
      var c = str.codePointAt(i)
      if (c > 0xffff) i++
      if (c < 0x80) bytes.push(c)
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
      else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
      else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    }
    return bytes
  }

  function utf8Decode(bytes) {
    var out = ''
    for (var i = 0; i < bytes.length;) {
      var b = bytes[i++]
      var c
      if (b < 0x80) c = b
      else if (b < 0xe0) c = ((b & 31) << 6) | (bytes[i++] & 63)
      else if (b < 0xf0) c = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63)
      else c = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63)
      out += String.fromCodePoint(c)
    }
    return out
  }

  function base64Decode(str) {
    var clean = String(str).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')
    var bytes = []
    var bits = 0
    var acc = 0
    for (var i = 0; i < clean.length; i++) {
      acc = (acc << 6) | B64.indexOf(clean[i])
      bits += 6
      if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255) }
    }
    return bytes
  }

  function base64Encode(bytes) {
    var out = ''
    for (var i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0)
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
      out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '='
      out += i + 2 < bytes.length ? B64[n & 63] : '='
    }
    return out
  }

  function makeBuffer(bytes) {
    return {
      length: bytes.length,
      toString: function (enc) {
        if (enc === 'base64') return base64Encode(bytes)
        if (enc === 'hex') return bytes.map(function (b) { return (b < 16 ? '0' : '') + b.toString(16) }).join('')
        return utf8Decode(bytes)
      },
    }
  }

  global.Buffer = {
    from: function (value, enc) {
      if (enc === 'base64' || enc === 'base64url') return makeBuffer(base64Decode(value))
      return makeBuffer(utf8Encode(String(value)))
    },
  }
  global.atob = function (s) { return base64Decode(s).map(function (b) { return String.fromCharCode(b) }).join('') }
  global.btoa = function (s) { return base64Encode(String(s).split('').map(function (ch) { return ch.charCodeAt(0) & 255 })) }

  // ── expect: the chai subset Bruno collections use ────────────────────────────
  function AssertionError(message) { this.name = 'AssertionError'; this.message = message }
  AssertionError.prototype = Object.create(Error.prototype)

  function typeOf(v) {
    if (v === null) return 'null'
    if (Array.isArray(v)) return 'array'
    return typeof v
  }

  function deepEqual(a, b) {
    if (a === b) return true
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a !== a && b !== b
    if (Array.isArray(a) !== Array.isArray(b)) return false
    var ka = Object.keys(a)
    var kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    for (var i = 0; i < ka.length; i++) if (!deepEqual(a[ka[i]], b[ka[i]])) return false
    return true
  }

  function Assertion(obj, message) { this._obj = obj; this._message = message; this._flags = {} }
  var A = Assertion.prototype

  A._assert = function (pass, msg, negatedMsg) {
    var ok = this._flags.not ? !pass : pass
    if (!ok) throw new AssertionError((this._message ? this._message + ': ' : '') + (this._flags.not ? negatedMsg : msg))
    return this
  }
  A._subject = function () { return this._flags.length ? (this._obj == null ? undefined : this._obj.length) : this._obj }
  A._what = function () { return this._flags.length ? format(this._obj) + ' to have a length' : format(this._obj) }

  ;['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'does', 'still', 'also'].forEach(function (word) {
    Object.defineProperty(A, word, { get: function () { return this } })
  })
  Object.defineProperty(A, 'not', { get: function () { this._flags.not = !this._flags.not; return this } })
  Object.defineProperty(A, 'deep', { get: function () { this._flags.deep = true; return this } })

  function compare(name, test, words) {
    return function (n, m) {
      var v = this._subject()
      return this._assert(test(v, n, m), 'expected ' + this._what() + ' ' + words + ' ' + format(n) + (m !== undefined ? '..' + format(m) : ''),
        'expected ' + this._what() + ' not ' + words + ' ' + format(n) + (m !== undefined ? '..' + format(m) : ''))
    }
  }
  A.above = A.gt = A.greaterThan = compare('above', function (v, n) { return v > n }, 'to be above')
  A.below = A.lt = A.lessThan = compare('below', function (v, n) { return v < n }, 'to be below')
  A.least = A.gte = A.greaterThanOrEqual = compare('least', function (v, n) { return v >= n }, 'to be at least')
  A.most = A.lte = A.lessThanOrEqual = compare('most', function (v, n) { return v <= n }, 'to be at most')
  A.within = compare('within', function (v, a, b) { return v >= a && v <= b }, 'to be within')

  A.equal = A.equals = A.eq = function (expected) {
    var v = this._subject()
    var pass = this._flags.deep ? deepEqual(v, expected) : v === expected
    return this._assert(pass, 'expected ' + this._what() + ' to equal ' + format(expected), 'expected ' + this._what() + ' to not equal ' + format(expected))
  }
  A.eql = function (expected) {
    return this._assert(deepEqual(this._obj, expected), 'expected ' + format(this._obj) + ' to deeply equal ' + format(expected),
      'expected ' + format(this._obj) + ' to not deeply equal ' + format(expected))
  }
  A.a = A.an = function (type) {
    var t = String(type).toLowerCase()
    return this._assert(typeOf(this._obj) === t, 'expected ' + format(this._obj) + ' to be a ' + t, 'expected ' + format(this._obj) + ' not to be a ' + t)
  }
  A.oneOf = function (list) {
    var v = this._obj
    var deep = this._flags.deep
    var pass = (list || []).some(function (x) { return deep ? deepEqual(x, v) : x === v })
    return this._assert(pass, 'expected ' + format(v) + ' to be one of ' + format(list), 'expected ' + format(v) + ' to not be one of ' + format(list))
  }
  A.include = A.includes = A.contain = A.contains = function (needle) {
    var v = this._obj
    var deep = this._flags.deep
    var pass
    if (typeof v === 'string') pass = v.indexOf(needle) !== -1
    else if (Array.isArray(v)) pass = v.some(function (x) { return deep ? deepEqual(x, needle) : x === needle })
    else if (v && typeof v === 'object' && needle && typeof needle === 'object') {
      pass = Object.keys(needle).every(function (k) { return deep ? deepEqual(v[k], needle[k]) : v[k] === needle[k] })
    } else pass = false
    return this._assert(pass, 'expected ' + format(v) + ' to include ' + format(needle), 'expected ' + format(v) + ' to not include ' + format(needle))
  }
  A.property = function (name, value) {
    var v = this._obj
    var has = v != null && name in Object(v)
    if (arguments.length > 1) {
      var matches = has && (this._flags.deep ? deepEqual(v[name], value) : v[name] === value)
      this._assert(matches, 'expected ' + format(v) + ' to have property ' + format(name) + ' of ' + format(value),
        'expected ' + format(v) + ' to not have property ' + format(name) + ' of ' + format(value))
    } else {
      this._assert(has, 'expected ' + format(v) + ' to have property ' + format(name), 'expected ' + format(v) + ' to not have property ' + format(name))
    }
    // Like chai, a positive .property() moves the chain onto the property's value.
    if (!this._flags.not) { this._obj = v[name]; this._flags = {} }
    return this
  }
  A.keys = A.key = function () {
    var wanted = Array.isArray(arguments[0]) ? arguments[0] : Array.prototype.slice.call(arguments)
    var v = this._obj
    var pass = v != null && wanted.every(function (k) { return k in Object(v) })
    return this._assert(pass, 'expected ' + format(v) + ' to have keys ' + format(wanted), 'expected ' + format(v) + ' to not have keys ' + format(wanted))
  }
  A.match = A.matches = function (re) {
    return this._assert(re.test(String(this._obj)), 'expected ' + format(this._obj) + ' to match ' + String(re), 'expected ' + format(this._obj) + ' not to match ' + String(re))
  }
  A.lengthOf = function (n) {
    var len = this._obj == null ? undefined : this._obj.length
    return this._assert(len === n, 'expected ' + format(this._obj) + ' to have a length of ' + n + ' but got ' + len,
      'expected ' + format(this._obj) + ' to not have a length of ' + n)
  }
  A.satisfy = A.satisfies = function (fn) {
    return this._assert(!!fn(this._obj), 'expected ' + format(this._obj) + ' to satisfy the given function', 'expected ' + format(this._obj) + ' to not satisfy the given function')
  }

  // .length is both a chain (.length.above(3)) and a call (.length(3)).
  Object.defineProperty(A, 'length', {
    get: function () {
      var self = this
      self._flags.length = true
      var fn = function (n) { self._flags.length = false; return self.lengthOf(n) }
      ;['above', 'gt', 'greaterThan', 'below', 'lt', 'lessThan', 'least', 'gte', 'most', 'lte', 'within', 'equal', 'eq', 'equals'].forEach(function (k) {
        fn[k] = function () { return self[k].apply(self, arguments) }
      })
      return fn
    },
  })

  function flag(name, test, words) {
    Object.defineProperty(A, name, {
      get: function () {
        return this._assert(test(this._obj), 'expected ' + format(this._obj) + ' to ' + words, 'expected ' + format(this._obj) + ' to not ' + words)
      },
    })
  }
  flag('ok', function (v) { return !!v }, 'be truthy')
  flag('true', function (v) { return v === true }, 'be true')
  flag('false', function (v) { return v === false }, 'be false')
  flag('null', function (v) { return v === null }, 'be null')
  flag('undefined', function (v) { return v === undefined }, 'be undefined')
  flag('NaN', function (v) { return v !== v }, 'be NaN')
  flag('exist', function (v) { return v != null }, 'exist')
  flag('empty', function (v) {
    if (typeof v === 'string' || Array.isArray(v)) return v.length === 0
    if (v && typeof v === 'object') return Object.keys(v).length === 0
    return false
  }, 'be empty')

  global.expect = function (obj, message) { return new Assertion(obj, message) }

  // ── test() ─────────────────────────────────────────────────────────────────
  global.test = function (name, fn) {
    var entry = { name: String(name), passed: true }
    tests.push(entry)
    function fail(e) { entry.passed = false; entry.error = errorMessage(e) }
    try {
      var result = fn()
      if (result && typeof result.then === 'function') testPromises.push(result.then(function () {}, fail))
    } catch (e) {
      fail(e)
    }
  }

  // ── req (pre-request): edits go back to the host in the report ─────────────
  function findHeader(headers, name) {
    var lower = String(name).toLowerCase()
    for (var k in headers) if (k.toLowerCase() === lower) return k
    return null
  }
  if (request) {
    request.headers = request.headers || {}
    global.req = {
      getUrl: function () { return request.url },
      setUrl: function (u) { request.url = String(u) },
      getMethod: function () { return request.method },
      setMethod: function (m) { request.method = String(m).toUpperCase() },
      getHeaders: function () { return request.headers },
      getHeader: function (name) { var k = findHeader(request.headers, name); return k === null ? undefined : request.headers[k] },
      setHeader: function (name, value) {
        var k = findHeader(request.headers, name)
        if (k !== null) delete request.headers[k]
        request.headers[String(name)] = String(value)
      },
      setHeaders: function (h) { request.headers = {}; for (var k in h) request.headers[k] = String(h[k]) },
      deleteHeader: function (name) { var k = findHeader(request.headers, name); if (k !== null) delete request.headers[k] },
      getBody: function () {
        if (typeof request.body !== 'string') return request.body
        try { return JSON.parse(request.body) } catch (e) { return request.body }
      },
      setBody: function (b) { request.body = typeof b === 'string' ? b : JSON.stringify(b) },
      getName: function () { return request.name },
    }
    global.req.url = request.url
    global.req.method = request.method
    global.req.headers = request.headers
  }

  // ── res (post-response / tests) ───────────────────────────────────────────
  if (response) {
    var parsedBody = response.body
    if (typeof parsedBody === 'string') { try { parsedBody = JSON.parse(parsedBody) } catch (e) { /* not JSON: keep the text */ } }
    var lowerHeaders = {}
    for (var hk in response.headers || {}) lowerHeaders[hk.toLowerCase()] = response.headers[hk]
    global.res = {
      status: response.status,
      statusText: response.statusText,
      headers: lowerHeaders,
      body: parsedBody,
      responseTime: response.durationMs,
      getStatus: function () { return response.status },
      getStatusText: function () { return response.statusText },
      getHeader: function (name) { return lowerHeaders[String(name).toLowerCase()] },
      getHeaders: function () { return lowerHeaders },
      getBody: function () { return parsedBody },
      getResponseTime: function () { return response.durationMs },
    }
  }

  // ── bru ────────────────────────────────────────────────────────────────────
  global.bru = {
    getEnvVar: function (k) { return env[k] },
    setEnvVar: function (k, v) { env[k] = v; runtime[k] = v },
    getEnvName: function () { return input.envName },
    getVar: function (k) { return runtime[k] },
    setVar: function (k, v) { runtime[k] = v },
    hasVar: function (k) { return Object.prototype.hasOwnProperty.call(runtime, k) },
    deleteVar: function (k) { delete runtime[k] },
    getProcessEnv: function () { return undefined },
    interpolate: function (s) {
      return String(s).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, function (m, k) {
        if (Object.prototype.hasOwnProperty.call(runtime, k)) return String(runtime[k])
        if (Object.prototype.hasOwnProperty.call(env, k)) return String(env[k])
        return m
      })
    },
    // Pauses the script; the host sends the request, then __settle resumes it.
    runRequest: function (path) {
      var id = nextId++
      pending.push({ id: id, path: String(path) })
      return new Promise(function (resolve, reject) { waiters[id] = { resolve: resolve, reject: reject } })
    },
    sleep: unsupported('bru.sleep'),
    sendRequest: unsupported('bru.sendRequest'),
    setNextRequest: unsupported('bru.setNextRequest'),
    runner: {
      skipRequest: function () { skipped = true },
      stopExecution: unsupported('bru.runner.stopExecution'),
      setNextRequest: unsupported('bru.runner.setNextRequest'),
    },
  }

  // ── host hooks ─────────────────────────────────────────────────────────────
  global.__begin = function (fn) {
    Promise.resolve()
      .then(fn)
      .then(function () { return Promise.all(testPromises) })
      .then(function () { finished = { ok: true } }, function (e) { finished = { ok: false, error: errorMessage(e) } })
  }

  global.__settle = function (id, json) {
    var w = waiters[id]
    if (!w) return
    delete waiters[id]
    var result = JSON.parse(json)
    if (result.vars) runtime = result.vars
    if (result.error) { w.reject(new Error(result.error)); return }
    var r = result.response || {}
    var data = r.body
    if (typeof data === 'string') { try { data = JSON.parse(data) } catch (e) { /* keep text */ } }
    w.resolve({ status: r.status, statusText: r.statusText, headers: r.headers || {}, data: data, responseTime: r.durationMs })
  }

  global.__report = function () {
    var taken = pending
    pending = []
    return JSON.stringify({
      finished: finished,
      pending: taken,
      context: { vars: runtime, env: env, request: request, tests: tests, skipped: skipped },
      logs: logs,
    })
  }
})(globalThis)

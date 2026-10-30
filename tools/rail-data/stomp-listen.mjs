// stomp-listen.mjs — subscribe to a Network Rail open data STOMP topic and
// print each message. No dependencies: speaks just enough STOMP 1.2 over TCP.
//
//   NR_USERNAME=you@example.com NR_PASSWORD=... node tools/rail-data/stomp-listen.mjs [topic] [filter]
//
// topic   defaults to TRAIN_MVT_ALL_TOC (train movements: arrivals, departures,
//         platform and minutes early/late). Others: TD_ALL_SIG_AREA, VSTP_ALL, RTPPM_ALL.
// filter  for movements, only print messages whose toc_id or loc_stanox equals it
//         (e.g. 25 = GWR, or a STANOX from the CORPUS download).
//
// The topic must be enabled for your account at publicdatafeeds.networkrail.co.uk.

import net from 'node:net'

const HOST = 'publicdatafeeds.networkrail.co.uk'
const PORT = 61618
const HEARTBEAT_MS = 15000

const username = process.env.NR_USERNAME
const password = process.env.NR_PASSWORD
const topic = process.argv[2] || 'TRAIN_MVT_ALL_TOC'
const filter = process.argv[3]

if (!username || !password) {
  console.error('Set NR_USERNAME and NR_PASSWORD to your Network Rail open data login.')
  process.exit(1)
}

function frame(command, headers, body = '') {
  const lines = Object.entries(headers).map(([k, v]) => `${k}:${v}`)
  return `${command}\n${lines.join('\n')}\n\n${body}\0`
}

function parseFrame(raw) {
  const split = raw.indexOf('\n\n')
  const head = split === -1 ? raw : raw.slice(0, split)
  const body = split === -1 ? '' : raw.slice(split + 2)
  const [command, ...lines] = head.split('\n')
  const headers = {}
  for (const line of lines) {
    const i = line.indexOf(':')
    if (i > 0 && !(line.slice(0, i) in headers)) headers[line.slice(0, i)] = line.slice(i + 1)
  }
  return { command, headers, body }
}

// TRUST movement (msg_type 0003) -> one readable line; other types are skipped.
function describeMovement(msg) {
  if (msg.header?.msg_type !== '0003') return null
  const b = msg.body
  if (filter && b.toc_id !== filter && b.loc_stanox !== filter) return null
  const when = new Date(Number(b.actual_timestamp)).toISOString().slice(11, 16)
  const late = b.variation_status === 'LATE' ? ` ${b.timetable_variation} min late`
    : b.variation_status === 'EARLY' ? ` ${b.timetable_variation} min early`
    : ` ${b.variation_status.toLowerCase()}`
  const platform = b.platform?.trim() ? ` plat ${b.platform.trim()}` : ''
  return `${when}Z train ${b.train_id} toc ${b.toc_id} ${b.event_type.toLowerCase()} stanox ${b.loc_stanox}${platform}${late}`
}

function handleMessage(body) {
  let parsed
  try { parsed = JSON.parse(body) } catch { console.log(body); return }
  if (topic.startsWith('TRAIN_MVT')) {
    for (const msg of parsed) {
      const line = describeMovement(msg)
      if (line) console.log(line)
    }
  } else {
    console.log(JSON.stringify(parsed))
  }
}

const socket = net.connect(PORT, HOST)
let buffer = ''
let heartbeat

socket.setEncoding('utf8')

socket.on('connect', () => {
  socket.write(frame('CONNECT', {
    'accept-version': '1.2',
    host: '/',
    login: username,
    passcode: password,
    'heart-beat': `${HEARTBEAT_MS},${HEARTBEAT_MS}`,
  }))
})

socket.on('data', chunk => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\0')) !== -1) {
    const raw = buffer.slice(0, end).replace(/^[\r\n]+/, '')
    buffer = buffer.slice(end + 1)
    if (!raw) continue
    const { command, headers, body } = parseFrame(raw)
    if (command === 'CONNECTED') {
      console.error(`Connected. Subscribing to /topic/${topic}${filter ? ` (filter ${filter})` : ''}...`)
      socket.write(frame('SUBSCRIBE', { destination: `/topic/${topic}`, id: '1', ack: 'auto' }))
      heartbeat = setInterval(() => socket.write('\n'), HEARTBEAT_MS)
    } else if (command === 'MESSAGE') {
      handleMessage(body)
    } else if (command === 'ERROR') {
      console.error(`STOMP error: ${headers.message || ''}\n${body}`)
      socket.end()
      process.exitCode = 1
    }
  }
})

socket.on('error', err => { console.error(err.message); process.exitCode = 1 })
socket.on('close', () => { clearInterval(heartbeat); console.error('Disconnected.') })
process.on('SIGINT', () => { socket.end(frame('DISCONNECT', {})); setTimeout(() => process.exit(), 500) })

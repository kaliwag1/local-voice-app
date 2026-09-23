// Types one message into a running Gateway through the same client SDK the chat
// window uses, with the microphone off, and reports what came back.
// Usage: node scripts/diagnostics/gateway-text-probe.mjs <gateway origin>
import WebSocket from 'ws'
import { GatewayClient } from '../../shared/gateway/client-sdk.mjs'
import { GatewayClientEvent } from '../../shared/protocol/realtime-events.mjs'
import { gatewayReferenceClientCapabilities } from '../../shared/gateway/client-profiles.mjs'

const origin = process.argv[2] || 'http://127.0.0.1:3199'
const sessionId = `probe-${Date.now()}`
const url = `${origin.replace(/^http/, 'ws')}/api/realtime?sessionId=${sessionId}`
const seen = {}
let transcript = ''
let sent = false

const client = new GatewayClient({
  url,
  createSocket: target => new WebSocket(target),
  clientType: 'desktop',
  clientLabel: 'probe',
  clientInstanceId: `probe-${process.pid}`,
  capabilities: gatewayReferenceClientCapabilities('desktop'),
  reconnect: false,
  configure: () => ({
    type: GatewayClientEvent.CONNECT,
    voiceEnabled: true,
    inputEnabled: false,
    outputEnabled: true,
    textOnly: false,
    wakeWordOnly: false,
    clientType: 'desktop',
    clientLabel: 'probe',
    clientInstanceId: `probe-${process.pid}`,
  }),
  onEvent: event => {
    seen[event.type] = (seen[event.type] || 0) + 1
    if (event.type === 'transcript.delta' && event.role === 'assistant') transcript += event.delta || event.content || ''
    if (event.type === 'transcript.final' && event.role === 'assistant') {
      finish('final', event.text ?? event.content ?? event.transcript)
    }
    if (event.type === 'error') console.error('error event', JSON.stringify(event))
    if (!sent && (event.type === 'voice.ready' || event.type === 'voice.connection' && event.state === 'connected')) {
      sent = true
      client.send({ type: GatewayClientEvent.INPUT_MESSAGE, parts: [{ type: 'text', text: 'Hello there' }] })
    }
  },
  onStatus: status => { seen[`status:${status.state}`] = (seen[`status:${status.state}`] || 0) + 1 },
})

const timer = setTimeout(() => finish("timeout"), Number(process.env.PROBE_TIMEOUT_MS || 45_000))
function finish(reason, finalText) {
  clearTimeout(timer)
  console.log(JSON.stringify({ reason, sent, finalText, streamed: transcript, events: seen }, null, 2))
  client.stop()
  setTimeout(() => process.exit(reason === 'final' ? 0 : 1), 100)
}
client.start()

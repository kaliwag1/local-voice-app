import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let TurnActivity

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: null, hmr: false },
  })
  TurnActivity = (await server.ssrLoadModule('/src/TurnActivity.jsx')).default
})

after(async () => { await server?.close() })

const render = activity => renderToStaticMarkup(createElement(TurnActivity, { activity }))

test('a finished turn reports its tokens, duration and rate', () => {
  const markup = render({
    turnId: 't', status: 'completed', live: false, createdAt: Date.now() - 20_000, responseCount: 1, tools: [],
    stream: { deltas: 300, characters: 1200, firstDeltaAt: Date.now() - 18_000, endedAt: Date.now() - 12_000 },
    usage: { input: 4278, output: 1504, total: 5782, reportedResponses: 1, complete: true, latest: { input: 4278, output: 1504, total: 5782 } },
  })
  assert.match(markup, /8\.0s · 1,504 tokens · 250\.7 tok\/s/)
  assert.match(markup, /Streamed 1,200 characters in 300 chunks/)
})

// The moment that looked broken: mid-turn, before any usage is reported.
test('a running turn shows progress rather than only "unavailable"', () => {
  const markup = render({
    turnId: 't', status: 'working', live: true, createdAt: Date.now() - 5_000, responseCount: 1, tools: [],
    stream: { deltas: 90, characters: 360, firstDeltaAt: Date.now() - 4_000, endedAt: null },
    usage: null,
  })
  assert.match(markup, /360 characters/)
  assert.match(markup, /5\.0s/)
  // Still no invented token figure while the runtime has reported none.
  assert.doesNotMatch(markup, /tok\/s/)
  assert.match(markup, /Token usage unavailable from this runtime so far/)
})

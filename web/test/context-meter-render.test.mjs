import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let ContextMeter

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: null, hmr: false },
  })
  ContextMeter = (await server.ssrLoadModule('/src/ContextMeter.jsx')).default
})

after(async () => { await server?.close() })

const measured = (used, extra = {}) => ({
  one: { turnId: 'one', updatedAt: 5, usage: { input: used - 100, output: 100, total: used, reportedResponses: 1, complete: true, latest: { input: used - 100, output: 100, total: used }, ...extra } },
})

const render = props => renderToStaticMarkup(createElement(ContextMeter, props))

test('draws a partly filled ring and states the numbers behind it', () => {
  const markup = render({ activities: measured(8400), contextLength: 32768 })
  // Nothing but the ring is on show; the reading is announced, not printed.
  assert.match(markup, /aria-label="26% of context used. Open for details."/)
  assert.match(markup, /<summary[^>]*><svg/)
  assert.match(markup, /context-meter-headline/)
  assert.match(markup, />26%/)
  assert.match(markup, /8,400<\/b> tokens in the last measured request/)
  assert.match(markup, /32,768<\/b> window/)
  assert.match(markup, /24,368<\/b> left/)
  // The fill is a dash pattern over the ring's circumference, not a full circle.
  const dash = markup.match(/stroke-dasharray="([\d.]+) ([\d.]+)"/)
  assert.ok(dash, 'the fill arc should be drawn')
  assert.ok(Number(dash[1]) > 0 && Number(dash[2]) > Number(dash[1]), 'about a quarter filled')
})

test('says plainly when nothing has been measured, and guesses nothing', () => {
  const markup = render({ activities: {}, contextLength: 32768 })
  assert.match(markup, /aria-label="Context unmeasured. Open for details."/)
  assert.match(markup, /No context reading yet/)
  assert.doesNotMatch(markup, /% of context used. Open/)
  assert.doesNotMatch(markup, /stroke-dasharray/)
})

test('warns when the conversation no longer fits the window', () => {
  const markup = render({ activities: measured(40500), contextLength: 32768 })
  assert.match(markup, /context-meter-critical/)
  assert.match(markup, /larger than the current window/)
  assert.match(markup, /aria-label="100% of context used/)
})

test('shows a token count alone when the window size is unknown', () => {
  const markup = render({ activities: measured(1000), contextLength: null })
  assert.match(markup, /1,000<\/b> tokens in the last measured request/)
  assert.match(markup, /aria-label="1,000 tokens used/)
  assert.match(markup, /context window size is unknown/)
})

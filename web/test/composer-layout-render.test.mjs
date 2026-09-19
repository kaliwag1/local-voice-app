import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let MultimodalComposer

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: null, hmr: false },
  })
  MultimodalComposer = (await server.ssrLoadModule('/src/composer/MultimodalComposer.jsx')).default
})

after(async () => { await server?.close() })

const render = (props = {}) => renderToStaticMarkup(
  createElement(MultimodalComposer, { onSend: () => true, ...props }),
)

test('the text field leads, with the tools and status on a row beneath it', () => {
  const markup = render({ status: createElement('span', null, '18% of context') })
  const inputRow = markup.indexOf('composer-field')
  const controls = markup.indexOf('composer-controls')
  assert.ok(inputRow > -1 && controls > inputRow, 'controls follow the input row')
  assert.ok(markup.indexOf('<textarea') < controls, 'the field is in the top row')
  // The box belongs to the field alone, so the controls sit outside it.
  assert.ok(markup.indexOf('composer-field') < markup.indexOf('<textarea'), 'the field is boxed')
  assert.ok(markup.indexOf('composer-send') < controls, 'send stays beside the field')
  // Send is the return glyph now, with no visible label.
  assert.match(markup, /class="composer-send"[^>]*aria-label="[^"]+"><svg/)
  assert.ok(markup.indexOf('composer-attach') > controls, 'the attach button moved down')
  assert.match(markup, /composer-status[^>]*><span>18% of context/)
})

// One control in one slot: it sends, or it stops what is running - never both,
// and never a separate red button competing beside the field.
test('the send button becomes the stop button while a reply is running', () => {
  const stops = []
  const idle = render()
  assert.match(idle, /class="composer-send"[^>]*type="submit"/)
  assert.doesNotMatch(idle, /aria-label="Stop"/)

  const running = render({ busy: true, onStop: () => stops.push('stopped') })
  assert.match(running, /class="composer-send stopping"[^>]*type="button"/)
  assert.match(running, /aria-label="Stop"/)
  // A square inside a ring, and no submit button left to press.
  assert.match(running, /<rect[^>]*width="7"/)
  assert.doesNotMatch(running, /type="submit"/)
  assert.equal(render({ busy: true }).includes('aria-label="Stop"'), false,
    'with nothing to stop it stays a send button')
})

test('without a status the row still holds the tools', () => {
  const markup = render()
  assert.match(markup, /composer-controls/)
  assert.match(markup, /composer-tools/)
  assert.doesNotMatch(markup, /composer-status/)
})

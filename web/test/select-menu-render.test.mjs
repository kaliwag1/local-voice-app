import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let SelectMenu

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: null, hmr: false },
  })
  SelectMenu = (await server.ssrLoadModule('/src/SelectMenu.jsx')).default
})

after(async () => { await server?.close() })

const options = [{ value: 'read', label: 'Read only' }, { value: 'write', label: 'Read & write' }]

test('closed, it shows the chosen label on a button a <label for> can target', () => {
  const html = renderToStaticMarkup(createElement(SelectMenu, { id: 'access', value: 'write', options }))
  assert.match(html, /<button id="access" type="button" class="select-menu-trigger"/)
  assert.match(html, /aria-haspopup="listbox"/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /<span class="select-menu-label">Read &amp; write<\/span>/)
  assert.doesNotMatch(html, /role="listbox"/)
  assert.doesNotMatch(html, /<select/)
})

test('disabled and unknown values render without a label rather than failing', () => {
  const html = renderToStaticMarkup(createElement(SelectMenu, { value: 'other', options, disabled: true, ariaLabel: 'Access' }))
  assert.match(html, /disabled=""/)
  assert.match(html, /aria-label="Access: "/)
  assert.match(html, /<span class="select-menu-label"><\/span>/)
})

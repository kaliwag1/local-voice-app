import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let ChatItemMenu

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: null, hmr: false },
  })
  ChatItemMenu = (await server.ssrLoadModule('/src/ChatItemMenu.jsx')).default
})

after(async () => { await server?.close() })

const render = (props = {}) => renderToStaticMarkup(createElement(ChatItemMenu, props))

test('one button holds all four actions, labelled for assistive tech', () => {
  const markup = render()
  assert.match(markup, /aria-label="Chat options"/)
  assert.match(markup, />⋮</)
  for (const action of ['Rename', 'Pin', 'Archive', 'Delete']) {
    assert.match(markup, new RegExp(`role="menuitem"[^>]*>${action}<`))
  }
  // Delete reads as destructive rather than sitting in the list unmarked.
  assert.match(markup, /class="danger"[^>]*>Delete</)
})

test('the two toggles say what they will do, not what the chat is', () => {
  const pinnedAndArchived = render({ pinned: true, archived: true })
  assert.match(pinnedAndArchived, />Unpin</)
  assert.match(pinnedAndArchived, />Restore</)
  const plain = render({ pinned: false, archived: false })
  assert.match(plain, />Pin</)
  assert.match(plain, />Archive</)
})

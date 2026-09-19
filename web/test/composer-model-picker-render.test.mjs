import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let ComposerModelPicker

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: null, hmr: false },
  })
  ComposerModelPicker = (await server.ssrLoadModule('/src/composer/ComposerModelPicker.jsx')).default
})

after(async () => { await server?.close() })

const models = [
  { modelKey: 'bonsai/crack', displayName: 'Bonsai 2 CRACK PQ2 (Prism)' },
  { modelKey: 'google/gemma-4-26b-a4b-qat', displayName: 'Gemma 4 26B' },
]
const render = props => renderToStaticMarkup(createElement(ComposerModelPicker, props))

test('names the model in the row and lists the rest to switch to', () => {
  const markup = render({ models, value: 'bonsai/crack', onChange: () => {} })
  assert.match(markup, /<summary[^>]*>Bonsai 2 CRACK PQ2 \(Prism\)</)
  assert.match(markup, /Gemma 4 26B/)
  // The one in use cannot be re-selected.
  assert.match(markup, /class="current" disabled=""/)
})

test('a switch in flight reports itself and blocks a second one', () => {
  const markup = render({ models, value: 'bonsai/crack', busy: true, progress: 'Loading Gemma 4 26B…', onChange: () => {} })
  assert.match(markup, /<summary[^>]*>Loading Gemma 4 26B…</)
  assert.match(markup, /composer-model busy/)
  const buttons = markup.match(/<button[^>]*disabled=""/g) || []
  assert.equal(buttons.length, models.length, 'every choice is disabled while switching')
})

test('falls back to the raw key, and renders nothing with no model at all', () => {
  assert.match(render({ models: [], value: 'some/model', onChange: () => {} }), /<summary[^>]*>some\/model</)
  assert.equal(render({ models: [], value: '', onChange: () => {} }), '')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { collectHealthDiagnostics, loadedModels, parseGpuMemory, localEndpoint } from '../src/health-diagnostics.mjs'

test('loaded context is distinct from the model maximum and unloaded models are excluded', () => {
  assert.deepEqual(loadedModels({ models: [
    { key: 'gemma', type: 'llm', max_context_length: 131072, loaded_instances: [{ id: 'active', config: { context_length: 32768 } }] },
    { key: 'unloaded', type: 'llm', loaded_instances: [] },
  ] }), [{ name: 'gemma', id: 'active', context: 32768, maximumContext: 131072 }])
  assert.equal(loadedModels({ data: [{ id: 'legacy', state: 'loaded', max_context_length: 131072 }] })[0].context, null)
})

test('GPU memory supports multiple devices and rejects unavailable readings', () => {
  assert.equal(parseGpuMemory('RTX 5070 Ti, 16384, 10240, 6144\nRTX 4090, 24576, 2048, 22528').length, 2)
  assert.deepEqual(parseGpuMemory('GPU, N/A, N/A, N/A'), [])
})

test('probes only local addresses', () => {
  assert.throws(() => localEndpoint('https://example.com'), /local/)
  assert.throws(() => localEndpoint('http://user:password@localhost'), /local/)
  assert.equal(localEndpoint('ws://127.0.0.1:8765/v1/realtime').port, 8765)
})

test('failed services still return a complete diagnostic snapshot', async () => {
  const snapshot = await collectHealthDiagnostics({
    probe: async target => ({ ...target, listening: false }),
    fetchImpl: async () => { throw new Error('offline') },
    run: async () => { throw new Error('not installed') },
  })
  assert.equal(snapshot.services.length, 4)
  assert.equal(snapshot.models.available, false)
  assert.equal(snapshot.openCode.healthy, null)
  assert.deepEqual(snapshot.gpu.devices, [])
})

test('older LM Studio API is used when the new endpoint is unavailable', async () => {
  const requests = []
  const snapshot = await collectHealthDiagnostics({
    probe: async target => ({ ...target, listening: true }),
    run: async () => ({ stdout: 'RTX, 16384, 8192, 8192' }),
    fetchImpl: async (url, options) => {
      requests.push(url)
      assert.equal(options.redirect, 'error')
      if (url.endsWith('/api/v1/models')) return { ok: false, status: 404 }
      return { ok: true, json: async () => url.endsWith('/global/health')
        ? { healthy: true, version: '1.0' }
        : { data: [{ id: 'gemma', state: 'loaded', loaded_context_length: 32768 }] } }
    },
  })
  assert.equal(snapshot.models.loaded[0].context, 32768)
  assert.equal(snapshot.openCode.healthy, true)
  assert.ok(requests.some(url => url.endsWith('/api/v0/models')))
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CONTEXT_LENGTH_OPTIONS,
  canPreload,
  createLocalModelSwitcher,
  ownsSpeech,
  parseContextLength,
  updateOpenCodeConfig,
} from '../src/local-model-switch.mjs'

const oldKey = 'google/gemma-4-26b-a4b-qat'
const newKey = 'test/other-model'
const speechPath = 'C:\\voice\\speech-to-speech.exe'
const GiB = 1024 ** 3
const models = [
  { type: 'llm', modelKey: oldKey, displayName: 'Gemma', sizeBytes: 14 * GiB },
  { type: 'llm', modelKey: newKey, displayName: 'Other', sizeBytes: 4 * GiB },
]

// Default: 4 GiB model, 8 GiB free → fits beside the old one (background mode).
function fixture({ failAt = '', ownership = 'owned', freeVram = 8 * GiB } = {}) {
  const paths = {
    lms: 'lms.exe', speech: speechPath, opencodeConfig: 'opencode.json',
    selection: 'selection', contextLength: 'context', workdir: 'C:\\voice',
  }
  const data = new Map([
    ['opencode.json', JSON.stringify({ model: `lmstudio/${oldKey}`, provider: {
      lmstudio: { models: { [oldKey]: { name: 'Gemma' } } },
    } })],
    ['selection', `${oldKey}\n`],
  ])
  const calls = []
  const progress = []
  let activeSpeech = { pid: 42, executablePath: speechPath, commandLine: speechPath }
  // LM Studio can hold several models at once; track them all.
  const loadedSet = new Set([oldKey])
  const fail = point => { if (point === failAt) throw new Error(`failed ${point}`) }
  const controller = createLocalModelSwitcher({
    paths,
    read: async path => {
      if (!data.has(path)) { const error = new Error('missing'); error.code = 'ENOENT'; throw error }
      return data.get(path)
    },
    write: async (path, content) => { calls.push(['write', path]); fail(`write:${path}`); data.set(path, content) },
    gpuMemory: async () => freeVram,
    onProgress: event => progress.push(event),
    lms: async (...args) => {
      calls.push(['lms', ...args])
      if (args[0] === 'ls') return JSON.stringify(models)
      if (args[0] === 'ps') return JSON.stringify([...loadedSet].map(key => ({ modelKey: key, identifier: key })))
      if (args[0] === 'unload') { fail(`unload:${args[1]}`); loadedSet.delete(args[1]); return '' }
      if (args[0] === 'load') { fail('load'); loadedSet.add(args[1]); return '' }
      return ''
    },
    listener: async () => activeSpeech,
    stopSpeech: async () => { calls.push(['stopSpeech']); activeSpeech = null },
    startSpeech: async key => { calls.push(['startSpeech', key]); fail('startSpeech'); activeSpeech = {
      pid: 43, executablePath: speechPath, commandLine: speechPath,
    } },
    gateway: {
      ownership: () => ownership,
      stop: async () => { calls.push(['gateway.stop']) },
      start: async () => { calls.push(['gateway.start']); fail('gateway.start') },
      resetBackendSessions: async () => { calls.push(['gateway.resetBackendSessions']) },
    },
  })
  return {
    controller, data, calls, progress,
    // The single loaded model, or null when none / several are loaded.
    get loaded() { return loadedSet.size === 1 ? [...loadedSet][0] : null },
    get loadedAll() { return [...loadedSet] },
  }
}

test('lists only installed LLMs, current selection and context size', async () => {
  const { controller } = fixture()
  assert.deepEqual(await controller.list(), {
    ok: true, models: models.map(({ modelKey, displayName }) => ({ modelKey, displayName })),
    selectedModelKey: oldKey,
    contextLength: 32768,
    contextLengthOptions: CONTEXT_LENGTH_OPTIONS,
  })
})

test('preloads the new model beside the old one and only then swaps services', async () => {
  const state = fixture()
  const result = await state.controller.switchModel(newKey)
  assert.deepEqual(result, { ok: true, selectedModelKey: newKey, mode: 'background' })
  const names = state.calls.map(call => call[0] === 'lms' ? `lms ${call[1]}` : call[0])
  const load = names.indexOf('lms load')
  const stop = names.indexOf('gateway.stop')
  const unloadOld = state.calls.findIndex(call => call[0] === 'lms' && call[1] === 'unload' && call[2] === oldKey)
  assert.ok(load !== -1 && stop !== -1 && unloadOld !== -1)
  assert.ok(load < stop, 'the new model is loaded before any service stops')
  assert.ok(unloadOld > names.lastIndexOf('gateway.start'), 'the old model is unloaded only after the gateway is back')
  assert.deepEqual(state.loadedAll, [newKey])
  assert.deepEqual(state.progress.map(event => event.phase), ['loading', 'swapping', 'unloading', 'done'])
  assert.equal(state.progress[0].mode, 'background')
})

test('falls back to unload-then-load when VRAM cannot hold both, still without stopping services first', async () => {
  const state = fixture({ freeVram: 1 * GiB })
  const result = await state.controller.switchModel(newKey)
  assert.deepEqual(result, { ok: true, selectedModelKey: newKey, mode: 'sequential' })
  const names = state.calls.map(call => call[0] === 'lms' ? `lms ${call[1]}` : call[0])
  assert.ok(names.indexOf('lms unload') < names.indexOf('lms load'))
  assert.ok(names.indexOf('lms load') < names.indexOf('gateway.stop'))
  assert.deepEqual(state.loadedAll, [newKey])
  assert.equal(state.progress[0].mode, 'sequential')
})

test('never preloads when GPU memory is unreadable', async () => {
  const state = fixture({ freeVram: null })
  const result = await state.controller.switchModel(newKey)
  assert.equal(result.mode, 'sequential')
})

test('a failed background load leaves the old model serving and untouched', async () => {
  const state = fixture({ failAt: 'load' })
  const result = await state.controller.switchModel(newKey)
  assert.equal(result.ok, false)
  assert.equal(result.selectedModelKey, oldKey)
  assert.deepEqual(state.loadedAll, [oldKey])
  const names = state.calls.map(call => call[0])
  assert.ok(!names.includes('gateway.stop'), 'services were never stopped')
  assert.ok(!names.includes('stopSpeech'))
})

test('keeps the switch and only warns when the old model cannot be unloaded afterwards', async () => {
  const state = fixture({ failAt: `unload:${oldKey}` })
  const result = await state.controller.switchModel(newKey)
  assert.equal(result.ok, true)
  assert.equal(result.selectedModelKey, newKey)
  assert.match(result.warning, /still loaded/)
  assert.deepEqual(state.loadedAll.sort(), [oldKey, newKey].sort())
})

test('changing the context size reloads the current model without touching services', async () => {
  const state = fixture()
  const result = await state.controller.setContextLength(65536)
  assert.deepEqual(result, { ok: true, contextLength: 65536 })
  assert.equal(state.data.get('context').trim(), '65536')
  const load = state.calls.find(call => call[0] === 'lms' && call[1] === 'load')
  assert.equal(load[2], oldKey)
  assert.equal(load[load.indexOf('--context-length') + 1], '65536')
  assert.ok(!state.calls.some(call => call[0] === 'gateway.stop' || call[0] === 'stopSpeech'))
  assert.equal((await state.controller.list()).contextLength, 65536)
  // A later model switch loads with the chosen size.
  await state.controller.switchModel(newKey)
  const switchLoad = state.calls.filter(call => call[0] === 'lms' && call[1] === 'load').at(-1)
  assert.equal(switchLoad[switchLoad.indexOf('--context-length') + 1], '65536')
})

test('rejects unknown context sizes and restores the old context on a failed reload', async () => {
  const state = fixture()
  assert.equal((await state.controller.setContextLength(12345)).ok, false)
  assert.equal(state.calls.filter(call => call[0] !== 'lms').length, 0)
  const failing = fixture({ failAt: 'load' })
  const result = await failing.controller.setContextLength(65536)
  assert.equal(result.ok, false)
  assert.equal(result.contextLength, 32768)
  assert.equal(failing.data.has('context'), false)
})

test('preload fit check needs weights plus context headroom', () => {
  assert.equal(canPreload({ sizeBytes: 4 * GiB, freeBytes: 8 * GiB, contextLength: 32768 }), true)
  assert.equal(canPreload({ sizeBytes: 4 * GiB, freeBytes: 5 * GiB, contextLength: 32768 }), false)
  assert.equal(canPreload({ sizeBytes: null, freeBytes: 16 * GiB, contextLength: 32768 }), false)
  assert.equal(parseContextLength('32768\n'), 32768)
  assert.equal(parseContextLength('9999'), null)
})

test('switches owned local services and config', async () => {
  const state = fixture({ freeVram: 0 })
  const result = await state.controller.switchModel(newKey)
  assert.deepEqual(result, { ok: true, selectedModelKey: newKey, mode: 'sequential' })
  assert.equal(state.loaded, newKey)
  assert.equal(JSON.parse(state.data.get('opencode.json')).model, `lmstudio/${newKey}`)
  assert.equal(state.data.get('selection').trim(), newKey)
  assert.ok(state.calls.some(call => call[0] === 'gateway.stop'))
  assert.ok(state.calls.some(call => call[0] === 'gateway.start'))
})

test('refuses borrowed gateway and unknown model without changes', async () => {
  const state = fixture({ ownership: 'unavailable' })
  assert.equal((await state.controller.switchModel(newKey)).ok, false)
  assert.equal((await state.controller.switchModel('unexpected/model')).ok, false)
  assert.equal(state.calls.filter(call => call[0] !== 'lms').length, 0)
})

test('recovers old model, config, speech and gateway after a failed restart', async () => {
  const state = fixture({ failAt: 'gateway.start', freeVram: 0 })
  const result = await state.controller.switchModel(newKey)
  assert.equal(result.ok, false)
  assert.equal(result.selectedModelKey, oldKey)
  assert.equal(state.loaded, oldKey)
  assert.equal(JSON.parse(state.data.get('opencode.json')).model, `lmstudio/${oldKey}`)
  assert.equal(state.data.get('selection').trim(), oldKey)
  assert.ok(state.calls.some(call => call[0] === 'startSpeech' && call[1] === oldKey))
})

test('restores the old setup if new speech fails to start', async () => {
  const state = fixture({ failAt: 'startSpeech', freeVram: 0 })
  const result = await state.controller.switchModel(newKey)
  assert.equal(result.ok, false)
  assert.equal(result.selectedModelKey, oldKey)
  assert.equal(state.loaded, oldKey)
  assert.equal(JSON.parse(state.data.get('opencode.json')).model, `lmstudio/${oldKey}`)
})

test('recognizes only the expected speech executable', () => {
  assert.equal(ownsSpeech({ pid: 5, executablePath: speechPath }, speechPath), true)
  assert.equal(ownsSpeech({ pid: 5, executablePath: 'C:\\other.exe', commandLine: 'other' }, speechPath), false)
  // The entry-point stub hands off to a Python interpreter that may live
  // anywhere; the stub's own path on the command line is the fingerprint.
  assert.equal(ownsSpeech({
    pid: 6,
    executablePath: 'C:\\Users\\x\\.cache\\codex-runtimes\\python\\python.exe',
    commandLine: `"C:\\Users\\x\\.cache\\codex-runtimes\\python\\python.exe" "${speechPath}" serve --device cpu`,
  }, speechPath), true)
  assert.equal(ownsSpeech({
    pid: 7,
    executablePath: 'C:\\elsewhere\\python.exe',
    commandLine: 'python -m some_other_server 8765',
  }, speechPath), false)
})

test('updates only OpenCode LM Studio model mapping', () => {
  const source = JSON.stringify({ model: `lmstudio/${oldKey}`, provider: {
    lmstudio: { models: { [oldKey]: { name: 'Gemma' } }, baseURL: 'http://127.0.0.1:1234/v1' },
  }, untouched: true })
  const updated = JSON.parse(updateOpenCodeConfig(source, models[1]))
  assert.equal(updated.provider.lmstudio.baseURL, 'http://127.0.0.1:1234/v1')
  assert.equal(updated.untouched, true)
  assert.deepEqual(Object.keys(updated.provider.lmstudio.models), [newKey])
})

test('tolerates a UTF-8 BOM in the OpenCode config and loads with a large context', async () => {
  const state = fixture()
  state.data.set('opencode.json', `﻿${state.data.get('opencode.json')}`)
  const result = await state.controller.switchModel(newKey)
  assert.deepEqual(result, { ok: true, selectedModelKey: newKey, mode: 'background' })
  const written = state.data.get('opencode.json')
  assert.equal(written.startsWith('﻿'), false)
  assert.equal(JSON.parse(written).model, `lmstudio/${newKey}`)
  const load = state.calls.find(call => call[0] === 'lms' && call[1] === 'load')
  assert.ok(load.includes('--context-length'), 'model is loaded with an explicit context length')
  assert.ok(Number(load[load.indexOf('--context-length') + 1]) > 8192)
})

test('reports an unreadable OpenCode config clearly instead of a raw parse error', async () => {
  const state = fixture()
  state.data.set('opencode.json', '{ not json')
  const result = await state.controller.switchModel(newKey)
  assert.equal(result.ok, false)
  assert.match(result.error, /OpenCode config is not valid JSON/)
})

test('forgets the backend coordinator session before restarting the gateway on a switch', async () => {
  const state = fixture()
  await state.controller.switchModel(newKey)
  const names = state.calls.map(call => call[0])
  const reset = names.indexOf('gateway.resetBackendSessions')
  assert.ok(reset !== -1, 'backend sessions are reset')
  assert.ok(reset > names.indexOf('gateway.stop'), 'only after the gateway stopped')
  assert.ok(reset < names.lastIndexOf('gateway.start'), 'and before it restarts')
})

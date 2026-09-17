import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createLocalModelSwitcher,
  ownsSpeech,
  updateOpenCodeConfig,
} from '../src/local-model-switch.mjs'

const oldKey = 'google/gemma-4-26b-a4b-qat'
const newKey = 'test/other-model'
const speechPath = 'C:\\voice\\speech-to-speech.exe'
const models = [
  { type: 'llm', modelKey: oldKey, displayName: 'Gemma' },
  { type: 'llm', modelKey: newKey, displayName: 'Other' },
]

function fixture({ failAt = '', ownership = 'owned' } = {}) {
  const paths = {
    lms: 'lms.exe', speech: speechPath, opencodeConfig: 'opencode.json',
    selection: 'selection', workdir: 'C:\\voice',
  }
  const data = new Map([
    ['opencode.json', JSON.stringify({ model: `lmstudio/${oldKey}`, provider: {
      lmstudio: { models: { [oldKey]: { name: 'Gemma' } } },
    } })],
    ['selection', `${oldKey}\n`],
  ])
  const calls = []
  let activeSpeech = { pid: 42, executablePath: speechPath, commandLine: speechPath }
  let loaded = oldKey
  const fail = point => { if (point === failAt) throw new Error(`failed ${point}`) }
  const controller = createLocalModelSwitcher({
    paths,
    read: async path => data.get(path),
    write: async (path, content) => { calls.push(['write', path]); fail(`write:${path}`); data.set(path, content) },
    lms: async (...args) => {
      calls.push(['lms', ...args])
      if (args[0] === 'ls') return JSON.stringify(models)
      if (args[0] === 'ps') return JSON.stringify([{ modelKey: loaded, identifier: loaded }])
      if (args[0] === 'unload') { loaded = null; return '' }
      if (args[0] === 'load') { fail('load'); loaded = args[1]; return '' }
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
  return { controller, data, calls, get loaded() { return loaded } }
}

test('lists only installed LLMs and current selection', async () => {
  const { controller } = fixture()
  assert.deepEqual(await controller.list(), {
    ok: true, models: models.map(({ modelKey, displayName }) => ({ modelKey, displayName })),
    selectedModelKey: oldKey,
  })
})

test('switches owned local services and config', async () => {
  const state = fixture()
  const result = await state.controller.switchModel(newKey)
  assert.deepEqual(result, { ok: true, selectedModelKey: newKey })
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
  const state = fixture({ failAt: 'gateway.start' })
  const result = await state.controller.switchModel(newKey)
  assert.equal(result.ok, false)
  assert.equal(result.selectedModelKey, oldKey)
  assert.equal(state.loaded, oldKey)
  assert.equal(JSON.parse(state.data.get('opencode.json')).model, `lmstudio/${oldKey}`)
  assert.equal(state.data.get('selection').trim(), oldKey)
  assert.ok(state.calls.some(call => call[0] === 'startSpeech' && call[1] === oldKey))
})

test('restores the old setup if new speech fails to start', async () => {
  const state = fixture({ failAt: 'startSpeech' })
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
  assert.deepEqual(result, { ok: true, selectedModelKey: newKey })
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

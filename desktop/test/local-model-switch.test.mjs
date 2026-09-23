import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CONTEXT_LENGTH_OPTIONS,
  VOICE_PRESETS,
  canPreload,
  createLocalModelSwitcher,
  ownsSpeech,
  parseContextLength,
  parseVoice,
  readAppModeSync,
  speechArguments,
  speechEnvironment,
  updateOpenCodeConfig,
} from '../src/local-model-switch.mjs'

const oldKey = 'google/gemma-4-26b-a4b-qat'
const newKey = 'test/other-model'
const speechPath = 'C:\\voice\\speech-to-speech.exe'
const GiB = 1024 ** 3
test('speech tokenizer uses app-local data ahead of any existing data path', () => {
  const env = speechEnvironment('C:\\voice', { NLTK_DATA: 'D:\\old', KEEP: 'yes' })
  assert.equal(env.NLTK_DATA, 'C:\\voice\\nltk_data;D:\\old')
  assert.equal(env.KEEP, 'yes')
  assert.equal(env.ZD_VOICE_REASONING_ADAPTER, '1')
  assert.equal(env.PYTHONPATH, 'C:\\voice\\qwen-audio-agent-editable\\scripts\\runtime\\speech-adapter')
})
const models = [
  { type: 'llm', modelKey: oldKey, displayName: 'Gemma', sizeBytes: 14 * GiB },
  { type: 'llm', modelKey: newKey, displayName: 'Other', sizeBytes: 4 * GiB },
]

test('Bonsai switch is sequential and config and speech use Prism; failure restores LM Studio', async () => {
  const key = 'bonsai/official'
  models.push({ type: 'llm', modelKey: key, displayName: 'Bonsai Official', sizeBytes: null })
  try {
    const state = fixture({ freeVram: 100 * GiB })
    const result = await state.controller.switchModel(key)
    assert.equal(result.ok, true)
    assert.equal(result.mode, 'sequential')
    const config = JSON.parse(state.data.get('opencode.json'))
    assert.equal(config.model, 'bonsai/bonsai')
    assert.equal(config.provider.bonsai.options.baseURL, 'http://127.0.0.1:8080/v1')
    assert.ok(config.provider.lmstudio.models[oldKey])
    const args = speechArguments(key, 'cosette')
    assert.equal(args[args.indexOf('--model_name') + 1], 'bonsai')
    assert.equal(args[args.indexOf('--responses_api_base_url') + 1], 'http://127.0.0.1:8080/v1')
    assert.equal((await state.controller.switchModel(oldKey)).mode, 'sequential')
    assert.equal(JSON.parse(state.data.get('opencode.json')).model, `lmstudio/${oldKey}`)
    const failing = fixture({ failAt: 'startSpeech' })
    assert.equal((await failing.controller.switchModel(key)).ok, false)
    assert.equal(failing.loaded, oldKey)
    assert.equal(JSON.parse(failing.data.get('opencode.json')).model, `lmstudio/${oldKey}`)
  } finally { models.pop() }
})

// Default: 4 GiB model, 8 GiB free → fits beside the old one (background mode).
function fixture({ failAt = '', ownership = 'owned', freeVram = 8 * GiB, voiceFiles = ['jake.wav', 'notes.txt'], bonsai = null } = {}) {
  const paths = {
    lms: 'lms.exe', speech: speechPath, opencodeConfig: 'opencode.json',
    selection: 'selection', contextLength: 'context', voice: 'voice', appMode: 'mode',
    voicesDir: 'C:\\voice\\voices', workdir: 'C:\\voice',
  }
  const data = new Map([
    ['opencode.json', JSON.stringify({ model: `lmstudio/${oldKey}`, provider: {
      lmstudio: { models: { [oldKey]: { name: 'Gemma' } } },
    } })],
    ['selection', `${oldKey}\n`],
  ])
  const calls = []
  const progress = []
  const speechModes = []
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
    listDir: async () => voiceFiles,
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
    startSpeech: async (key, voice, mode) => { calls.push(['startSpeech', key, voice]); speechModes.push(mode); fail('startSpeech'); activeSpeech = {
      pid: 43, executablePath: speechPath, commandLine: speechPath,
    } },
    bonsai,
    gateway: {
      ownership: () => ownership,
      stop: async () => { calls.push(['gateway.stop']) },
      start: async () => { calls.push(['gateway.start']); fail('gateway.start') },
      resetBackendSessions: async () => { calls.push(['gateway.resetBackendSessions']) },
    },
  })
  return {
    controller, data, calls, progress, speechModes,
    // The single loaded model, or null when none / several are loaded.
    get loaded() { return loadedSet.size === 1 ? [...loadedSet][0] : null },
    get loadedAll() { return [...loadedSet] },
  }
}

test('quitting releases the app-owned Bonsai server so its weights leave VRAM', async () => {
  const stops = []
  const { controller } = fixture({ bonsai: { stop: async () => { stops.push('stop') } } })
  assert.deepEqual(await controller.stopLocalRuntime(), { ok: true })
  assert.deepEqual(stops, ['stop'])
})

test('a Bonsai server the app does not own is left running and reported, not killed', async () => {
  // stop() refuses when port 8080 belongs to someone else; the quit carries on.
  const { controller } = fixture({
    bonsai: { stop: async () => { throw new Error('Bonsai did not release port 8080.') } },
  })
  assert.deepEqual(await controller.stopLocalRuntime(),
    { ok: false, error: 'Bonsai did not release port 8080.' })
})

test('with no Bonsai runtime configured there is nothing to release', async () => {
  const { controller } = fixture()
  assert.deepEqual(await controller.stopLocalRuntime(), { ok: true })
})

test('lists only installed LLMs, current selection and context size', async () => {
  const { controller } = fixture()
  assert.deepEqual(await controller.list(), {
    ok: true, models: models.map(({ modelKey, displayName }) => ({ modelKey, displayName })),
    selectedModelKey: oldKey,
    contextLength: 32768,
    contextLengthOptions: CONTEXT_LENGTH_OPTIONS,
    voice: 'jean',
    voiceOptions: [
      ...VOICE_PRESETS.map(id => ({ id, kind: 'preset', label: id[0].toUpperCase() + id.slice(1) })),
      { id: 'jake.wav', kind: 'file', label: 'jake' },
    ],
    voicesDir: 'C:\\voice\\voices',
    appMode: 'voice',
  })
})

test('changing the voice restarts only the speech service and remembers the choice', async () => {
  const state = fixture()
  assert.deepEqual(await state.controller.setVoice('alba'), { ok: true, voice: 'alba' })
  assert.equal(state.data.get('voice').trim(), 'alba')
  const names = state.calls.map(call => call[0])
  assert.ok(names.includes('stopSpeech') && names.includes('startSpeech'))
  assert.ok(!names.includes('gateway.stop') && !names.some(name => name === 'lms' && false))
  assert.ok(!state.calls.some(call => call[0] === 'lms' && ['load', 'unload'].includes(call[1])))
  const start = state.calls.find(call => call[0] === 'startSpeech')
  assert.deepEqual(start, ['startSpeech', oldKey, 'alba'])
  // A cloned voice from the voices folder is passed by full path.
  assert.deepEqual(await state.controller.setVoice('jake.wav'), { ok: true, voice: 'jake.wav' })
  assert.equal(state.calls.filter(call => call[0] === 'startSpeech').at(-1)[2], 'C:\\voice\\voices\\jake.wav')
  // Later model switches keep using it.
  await state.controller.switchModel(newKey)
  assert.equal(state.calls.filter(call => call[0] === 'startSpeech').at(-1)[2], 'C:\\voice\\voices\\jake.wav')
})

test('rejects unknown voices and paths, and restores the old voice when the new one fails', async () => {
  const state = fixture()
  for (const bad of ['robot', '..\\secret.wav', 'C:\\elsewhere\\x.wav', 'notes.txt']) {
    assert.equal((await state.controller.setVoice(bad)).ok, false, bad)
  }
  assert.ok(!state.calls.some(call => call[0] === 'stopSpeech'))
  const failing = fixture({ failAt: 'startSpeech' })
  const result = await failing.controller.setVoice('alba')
  assert.equal(result.ok, false)
  assert.equal(result.voice, 'jean')
  assert.equal(failing.data.has('voice'), false)
  assert.equal(failing.calls.filter(call => call[0] === 'startSpeech').at(-1)[2], 'jean')
})

test('voice parsing and speech arguments', () => {
  assert.deepEqual(parseVoice('marius'), { id: 'marius', kind: 'preset' })
  assert.deepEqual(parseVoice('me.wav', ['me.wav']), { id: 'me.wav', kind: 'file' })
  assert.equal(parseVoice('me.wav', []), null)
  assert.equal(parseVoice('sub/me.wav', ['sub/me.wav']), null)
  const args = speechArguments('m', 'alba')
  assert.equal(args[args.indexOf('--pocket_tts_voice') + 1], 'alba')
  assert.equal(args.at(-1), '--no_smart_turn')
  assert.equal(args[args.indexOf('--responses_api_disable_thinking') + 1], 'false')
  assert.ok(!speechArguments('m', null).includes('--pocket_tts_voice'))
})

test('text mode restarts speech without its speech models, then the Gateway, and is remembered', async () => {
  const state = fixture()
  assert.equal((await state.controller.list()).appMode, 'voice')
  assert.deepEqual(await state.controller.setAppMode('text'), { ok: true, appMode: 'text' })
  assert.equal(state.data.get('mode').trim(), 'text')
  const steps = state.calls.filter(call => call[0] !== 'lms')
  assert.deepEqual(steps.map(call => call[0] === 'write' ? `write:${call[1]}` : call[0]), [
    'gateway.stop', 'stopSpeech', 'write:mode', 'startSpeech', 'gateway.start',
  ])
  assert.deepEqual(state.speechModes, ['text'])
  assert.ok(!state.calls.some(call => call[0] === 'lms' && ['load', 'unload'].includes(call[1])))
  assert.equal((await state.controller.list()).appMode, 'text')
  assert.deepEqual(await state.controller.setAppMode('text'), { ok: true, appMode: 'text' })
  assert.equal(state.speechModes.length, 1)
})

test('in text mode a model switch keeps text and a voice change is only saved', async () => {
  const state = fixture()
  await state.controller.setAppMode('text')
  await state.controller.switchModel(newKey)
  assert.deepEqual(state.speechModes, ['text', 'text'])
  const starts = state.speechModes.length
  assert.deepEqual(await state.controller.setVoice('alba'), { ok: true, voice: 'alba' })
  assert.equal(state.data.get('voice').trim(), 'alba')
  assert.equal(state.speechModes.length, starts)
  await state.controller.setAppMode('voice')
  assert.equal(state.calls.filter(call => call[0] === 'startSpeech').at(-1)[2], 'alba')
  assert.equal(state.speechModes.at(-1), 'voice')
})

test('a failed switch to text restores voice speech, the saved mode and the Gateway', async () => {
  const state = fixture({ failAt: 'startSpeech' })
  const result = await state.controller.setAppMode('text')
  assert.equal(result.ok, false)
  assert.equal(result.appMode, 'voice')
  assert.equal(state.data.get('mode').trim(), 'voice')
  assert.deepEqual(state.speechModes, ['text', 'voice'])
  assert.equal(state.calls.at(-1)[0], 'gateway.start')
  assert.equal(state.progress.at(-1).phase, 'failed')
})

test('refuses an unknown mode or a borrowed Gateway without touching anything', async () => {
  const state = fixture()
  assert.equal((await state.controller.setAppMode('silent')).ok, false)
  const borrowed = fixture({ ownership: 'unavailable' })
  assert.equal((await borrowed.controller.setAppMode('text')).ok, false)
  for (const fixtureState of [state, borrowed]) {
    assert.ok(!fixtureState.calls.some(call => ['gateway.stop', 'stopSpeech', 'startSpeech'].includes(call[0])))
    assert.equal(fixtureState.data.has('mode'), false)
  }
})

test('text-mode speech arguments load no speech models and no voice', () => {
  const args = speechArguments('m', 'alba', 'text')
  assert.equal(args[args.indexOf('--stt') + 1], 'text-only')
  assert.equal(args[args.indexOf('--tts') + 1], 'text-only')
  assert.ok(!args.includes('--pocket_tts_voice'))
  assert.equal(args[args.indexOf('--llm_backend') + 1], 'chat-completions')
  const voice = speechArguments('m', 'alba')
  assert.equal(voice[voice.indexOf('--stt') + 1], 'parakeet-tdt')
  assert.equal(voice[voice.indexOf('--tts') + 1], 'pocket')
})

test('the saved mode is read for the Gateway, defaulting to voice', () => {
  assert.equal(readAppModeSync('mode', () => 'text\n'), 'text')
  // PowerShell writes a BOM (lesson 5); trim() drops it.
  assert.equal(readAppModeSync('mode', () => '\uFEFFTEXT'), 'text')
  assert.equal(readAppModeSync('mode', () => 'anything'), 'voice')
  assert.equal(readAppModeSync('mode', () => { throw new Error('missing') }), 'voice')
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

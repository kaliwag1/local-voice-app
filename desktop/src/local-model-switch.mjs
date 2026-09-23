import { spawn, execFile } from 'node:child_process'
import { closeSync, openSync, readFileSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path, { join, resolve } from 'node:path'
import net from 'node:net'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { bonsaiPaths, createBonsaiRuntime, withBonsai } from './bonsai-runtime.mjs'
import { isBonsai, localModelRoute } from '../../shared/local-model-route.mjs'

const execFileAsync = promisify(execFile)
const SPEECH_PORT = 8765
// OpenCode's agent prompt is ~9k tokens, so a model loaded with LM Studio's
// default 8192 context fails every agent task. Keep in step with the launcher
// script (Start My Voice App.ps1, $modelContextLength) — it also reads the
// `.selected-voice-context` file written by setContextLength below.
const DEFAULT_CONTEXT_LENGTH = Number(process.env.QWEN_AUDIO_LOCAL_MODEL_CONTEXT || 32768)
export const CONTEXT_LENGTH_OPTIONS = [16384, 32768, 65536, 131072]
// Pocket TTS ships these speaker presets; anything else is a WAV/MP3 dropped in
// the `voices` folder next to the launcher (voice cloning, fully local).
export const VOICE_PRESETS = ['jean', 'alba', 'marius', 'javert', 'fantine', 'cosette', 'eponine', 'azelma']
export const DEFAULT_VOICE = 'jean'
const VOICE_FILE_EXTENSIONS = ['.wav', '.mp3', '.flac', '.ogg']
// Voice: the full speech service. Text: the same service with its speech models
// swapped for stand-ins (speech-adapter/text_only.py), so typed chat still reaches
// the model through one route while nothing is transcribed or spoken.
export const APP_MODES = ['voice', 'text']
// Loading a second model beside the running one needs its weights plus a KV
// cache for the requested context in free VRAM. The margin covers the cache
// and CUDA workspace; below it LM Studio would spill to system RAM and crawl.
const PRELOAD_MARGIN_BYTES = 1.5 * 1024 ** 3
const PRELOAD_CONTEXT_BYTES_PER_TOKEN = 32 * 1024

// Files edited by PowerShell/Notepad often carry a UTF-8 BOM, which JSON.parse
// rejects ("Unexpected token" before the opening brace).
function stripBom(text) {
  return String(text ?? '').replace(/^﻿/, '')
}

function parseJson(text, what) {
  try {
    return JSON.parse(stripBom(text))
  } catch (error) {
    throw new Error(`${what} is not valid JSON: ${error.message}`)
  }
}

function defaultPaths(env = process.env, root = env.QWEN_AUDIO_LOCAL_VOICE_ROOT
  || resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..')) {
  const home = env.USERPROFILE || homedir()
  return {
    lms: join(home, '.lmstudio', 'bin', 'lms.exe'),
    speech: join(root, '.voice-env', 'Scripts', 'speech-to-speech.exe'),
    opencodeConfig: join(home, '.config', 'opencode', 'opencode.json'),
    selection: join(root, '.selected-voice-model'),
    contextLength: join(root, '.selected-voice-context'),
    voice: join(root, '.selected-voice'),
    appMode: join(root, '.selected-app-mode'),
    voicesDir: join(root, 'voices'),
    workdir: root,
    bonsai: bonsaiPaths(home, root),
  }
}

async function command(file, args, options = {}) {
  const { stdout } = await execFileAsync(file, args, {
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  })
  return stdout.trim()
}

async function portOpen(port) {
  return new Promise(resolvePort => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => { socket.destroy(); resolvePort(true) })
    socket.once('error', () => resolvePort(false))
    socket.setTimeout(1000, () => { socket.destroy(); resolvePort(false) })
  })
}

async function waitForPort(port, expected, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await portOpen(port) === expected) return
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
  }
  throw new Error(`Local speech service did not ${expected ? 'start' : 'stop'}.`)
}

// Inspect the actual listener before killing anything. A port alone does not
// establish ownership; another app may have started a speech service there.
async function speechListener() {
  const script = `$listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort ${SPEECH_PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($listener) { $p = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"; if ($p) { [pscustomobject]@{ pid = $p.ProcessId; commandLine = $p.CommandLine; executablePath = $p.ExecutablePath } | ConvertTo-Json -Compress } }; exit 0`
  const output = await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
  return output ? parseJson(output, 'Speech service listener info') : null
}

// Device-wide free VRAM in bytes, or null when it cannot be read (no NVIDIA
// GPU, nvidia-smi missing). Null means "do not preload", never "assume it fits".
async function freeGpuMemory() {
  try {
    const output = await command('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], { timeout: 10_000 })
    const values = output.split(/\r?\n/).map(line => Number(line.trim())).filter(Number.isFinite)
    if (!values.length) return null
    return Math.max(...values) * 1024 ** 2
  } catch {
    return null
  }
}

function normalizeWindowsPath(value) {
  return String(value || '').toLowerCase().replaceAll('/', '\\')
}

// speech-to-speech.exe is a pip entry-point stub: it launches a Python
// interpreter (the venv's, or the base interpreter the venv was created from,
// which can live anywhere, e.g. a Codex runtime cache) and that Python is what
// actually listens on the port. The one reliable fingerprint is the stub's own
// full path on that process's command line.
function ownsSpeech(listener, expectedPath) {
  if (!listener || !Number.isSafeInteger(listener.pid)) return false
  const target = normalizeWindowsPath(expectedPath)
  if (!target) return false
  if (normalizeWindowsPath(listener.executablePath) === target) return true
  return normalizeWindowsPath(listener.commandLine).includes(target)
}

function parseAppMode(value) {
  return String(value ?? '').trim().toLowerCase() === 'text' ? 'text' : 'voice'
}

// For the Gateway's environment, which is built synchronously before it starts.
export function readAppModeSync(file = defaultPaths().appMode, read = readFileSync) {
  try {
    return parseAppMode(read(file, 'utf8'))
  } catch {
    return 'voice'
  }
}

// Mirror of the argument list in Start My Voice App.ps1 — keep both in step.
function speechArguments(modelKey, voice, mode = 'voice') {
  const route = localModelRoute(modelKey)
  const text = mode === 'text'
  return [
    'serve', '--device', 'cpu', '--stt', text ? 'text-only' : 'parakeet-tdt',
    '--llm_backend', 'chat-completions', '--model_name', route.model,
    '--responses_api_base_url', route.baseUrl,
    '--responses_api_api_key', 'lm-studio', '--tts', text ? 'text-only' : 'pocket',
    '--responses_api_disable_thinking', 'false',
    ...(voice && !text ? ['--pocket_tts_voice', voice] : []),
    '--no_smart_turn',
  ]
}

// The same file the launcher writes, so the latest run is always there - including
// the speech adapters' "unavailable" diagnostics, the only sign one switched itself
// off. Stderr only: stdout is where the speech package prints "USER: <what you said>"
// and "ASSISTANT: <reply>", and reply and transcription text stay unlogged by default.
// Each start overwrites the last. A log that cannot be opened must never stop speech
// from starting, so it falls back to none.
export function openSpeechLog(workdir, open = openSync) {
  try {
    return open(join(workdir, 'Last Speech Service.log'), 'w')
  } catch {
    return null
  }
}

function launchSpeech(file, modelKey, workdir, voice, mode) {
  const log = openSpeechLog(workdir)
  try {
    const child = spawn(file, speechArguments(modelKey, voice, mode), {
      cwd: workdir, detached: true, windowsHide: true,
      stdio: ['ignore', 'ignore', log ?? 'ignore'],
      env: speechEnvironment(workdir),
    })
    child.unref()
  } finally {
    // The child holds its own handle; ours is only needed for the spawn.
    if (log !== null) closeSync(log)
  }
}

export function speechEnvironment(workdir, env = process.env) {
  // Keep tokenizer files outside Windows Store/Codex's redirected AppData.
  const paths = /^[a-z]:\\/i.test(workdir) ? path.win32 : path
  return {
    ...env,
    NLTK_DATA: [paths.join(workdir, 'nltk_data'), env.NLTK_DATA].filter(Boolean).join(paths.delimiter),
    ZD_VOICE_REASONING_ADAPTER: '1',
    PYTHONPATH: [paths.join(workdir, 'qwen-audio-agent-editable', 'scripts', 'runtime', 'speech-adapter'), env.PYTHONPATH].filter(Boolean).join(paths.delimiter),
  }
}

async function replaceFile(path, content) {
  const temp = `${path}.${process.pid}.tmp`
  await fs.writeFile(temp, content, 'utf8')
  try { await fs.rename(temp, path) } catch (error) {
    await fs.rm(temp, { force: true })
    throw error
  }
}

function updateOpenCodeConfig(content, model) {
  const config = parseJson(content, 'OpenCode config')
  if (isBonsai(model.modelKey)) {
    config.provider ||= {}
    config.provider.bonsai = {
      npm: '@ai-sdk/openai-compatible', name: 'Bonsai (local Prism)',
      options: { baseURL: localModelRoute(model.modelKey).baseUrl },
      models: { bonsai: { name: model.displayName } },
    }
    config.model = 'bonsai/bonsai'
    return `${JSON.stringify(config, null, 2)}\n`
  }
  if (!config.provider?.lmstudio?.models || typeof config.provider.lmstudio.models !== 'object') {
    throw new Error('OpenCode is not configured for LM Studio.')
  }
  config.model = `lmstudio/${model.modelKey}`
  config.provider.lmstudio.models = {
    [model.modelKey]: { name: model.displayName },
  }
  return `${JSON.stringify(config, null, 2)}\n`
}

function parseModels(output) {
  const raw = parseJson(output, 'LM Studio model list')
  if (!Array.isArray(raw)) throw new Error('LM Studio returned an invalid model list.')
  return raw.filter(item => item?.type === 'llm' && typeof item.modelKey === 'string')
    .map(({ modelKey, displayName, sizeBytes }) => ({
      modelKey,
      displayName: displayName || modelKey,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
    }))
}

function isVoiceFileName(name) {
  const lower = String(name || '').toLowerCase()
  return VOICE_FILE_EXTENSIONS.some(extension => lower.endsWith(extension))
}

// A voice choice is a preset name or the bare file name of something in the
// voices folder — never an arbitrary path, so the renderer cannot point the
// speech service at files elsewhere on disk.
function parseVoice(value, files = []) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return null
  if (VOICE_PRESETS.includes(trimmed)) return { id: trimmed, kind: 'preset' }
  if (isVoiceFileName(trimmed) && !/[\\/]/.test(trimmed) && files.includes(trimmed)) return { id: trimmed, kind: 'file' }
  return null
}

function parseContextLength(value) {
  const number = Number(String(value ?? '').trim())
  return CONTEXT_LENGTH_OPTIONS.includes(number) ? number : null
}

// Can the new model be loaded beside the running one without spilling out of
// VRAM? Unknown sizes or unreadable GPU memory mean no — the sequential path
// is slower but never worse than today.
function canPreload({ sizeBytes, freeBytes, contextLength }) {
  if (!Number.isFinite(sizeBytes) || !Number.isFinite(freeBytes)) return false
  const needed = sizeBytes + PRELOAD_MARGIN_BYTES + contextLength * PRELOAD_CONTEXT_BYTES_PER_TOKEN
  return freeBytes >= needed
}

export function createLocalModelSwitcher({
  paths = defaultPaths(),
  lms = (...args) => command(paths.lms, args),
  read = path => fs.readFile(path, 'utf8'),
  write = replaceFile,
  listener = speechListener,
  gpuMemory = freeGpuMemory,
  listDir = async dir => { try { return await fs.readdir(dir) } catch (error) { if (error.code === 'ENOENT') return []; throw error } },
  stopSpeech = async info => { process.kill(info.pid); await waitForPort(SPEECH_PORT, false) },
  startSpeech = async (modelKey, voice, mode = 'voice') => {
    launchSpeech(paths.speech, modelKey, paths.workdir, voice, mode)
    await waitForPort(SPEECH_PORT, true, 120_000)
  },
  gateway = { ownership: () => 'unavailable', stop: async () => {}, start: async () => {}, resetBackendSessions: async () => {} },
  bonsai = paths.bonsai ? createBonsaiRuntime({ paths: paths.bonsai }) : null,
  onProgress = () => {},
} = {}) {
  if (bonsai) lms = withBonsai(lms, bonsai)
  let pending = false

  function progress(event) {
    try { onProgress(event) } catch { /* progress is informational only */ }
  }

  async function readOptional(path) {
    try {
      return String(await read(path))
    } catch (error) {
      if (error.code === 'ENOENT') return ''
      throw error
    }
  }

  async function contextLength() {
    return parseContextLength(await readOptional(paths.contextLength)) || DEFAULT_CONTEXT_LENGTH
  }

  async function appMode() {
    return paths.appMode ? parseAppMode(await readOptional(paths.appMode)) : 'voice'
  }

  async function voiceFiles() {
    return (await listDir(paths.voicesDir)).filter(isVoiceFileName).sort()
  }

  async function selectedVoice(files) {
    return parseVoice(await readOptional(paths.voice), files) || { id: DEFAULT_VOICE, kind: 'preset' }
  }

  // What the speech service is told: preset names as-is, files by full path.
  function voiceArgument(voice) {
    // The speech service only runs on Windows; keep backslashes even when the
    // tests run under a POSIX Node.
    const joinVoicePath = /^[a-z]:\\/i.test(paths.voicesDir) ? path.win32.join : join
    return voice.kind === 'file' ? joinVoicePath(paths.voicesDir, voice.id) : voice.id
  }

  async function loadedModels() {
    const loaded = parseJson(await lms('ps', '--json'), 'LM Studio loaded-model list')
    if (!Array.isArray(loaded)) throw new Error('LM Studio returned an invalid loaded-model list.')
    return loaded
  }

  async function loadModel(modelKey, length) {
    await lms('load', modelKey, '-y', '--context-length', String(length))
  }

  async function list() {
    const files = await voiceFiles()
    const models = parseModels(await lms('ls', '--llm', '--json'))
    let selectedModelKey = (await readOptional(paths.selection)).trim() || null
    if (!selectedModelKey) {
      const settings = parseJson(await read(paths.opencodeConfig), 'OpenCode config')
      selectedModelKey = String(settings.model || '').replace(/^lmstudio\//, '') || null
    }
    return {
      ok: true,
      models: models.map(({ modelKey, displayName }) => ({ modelKey, displayName })),
      selectedModelKey,
      contextLength: await contextLength(),
      contextLengthOptions: CONTEXT_LENGTH_OPTIONS,
      voice: (await selectedVoice(files)).id,
      voiceOptions: [
        ...VOICE_PRESETS.map(id => ({ id, kind: 'preset', label: id[0].toUpperCase() + id.slice(1) })),
        ...files.map(id => ({ id, kind: 'file', label: id.replace(/\.[^.]+$/, '') })),
      ],
      voicesDir: paths.voicesDir,
      appMode: await appMode(),
    }
  }

  async function switchModel(modelKey) {
    if (pending) return { ok: false, error: 'A model switch is already in progress.' }
    pending = true
    try {
      const models = parseModels(await lms('ls', '--llm', '--json'))
      const { selectedModelKey: previousKey } = await list()
      const chosen = models.find(model => model.modelKey === modelKey)
      if (!chosen) return { ok: false, selectedModelKey: previousKey, error: 'Choose an installed local model.' }
      if (chosen.modelKey === previousKey) return { ok: true, selectedModelKey: previousKey }
      const ownership = gateway.ownership()
      if (ownership !== 'owned') {
        return { ok: false, selectedModelKey: previousKey,
          error: 'This app is using another Qwen gateway. Close the other Qwen app and reopen this one before changing models.' }
      }
      const before = await read(paths.opencodeConfig)
      const after = updateOpenCodeConfig(before, chosen)
      const speech = await listener()
      if (speech && !ownsSpeech(speech, paths.speech)) {
        return { ok: false, selectedModelKey: previousKey,
          error: `Another program owns the speech service (${speech.executablePath || `pid ${speech.pid}`}). Close it before changing models.` }
      }
      const length = await contextLength()
      const voice = voiceArgument(await selectedVoice(await voiceFiles()))
      const conversationMode = await appMode()
      const loaded = await loadedModels()
      const oldLoaded = loaded.find(item => item.modelKey === previousKey)
      const chosenAlreadyLoaded = loaded.some(item => item.modelKey === chosen.modelKey)
      const preload = !isBonsai(previousKey) && !isBonsai(chosen.modelKey) && !chosenAlreadyLoaded && (!oldLoaded || canPreload({
        sizeBytes: chosen.sizeBytes, freeBytes: await gpuMemory(), contextLength: length,
      }))
      const mode = chosenAlreadyLoaded ? 'already-loaded' : preload ? 'background' : 'sequential'
      let oldUnloaded = false
      let newLoaded = false
      let gatewayStopped = false
      let speechStopped = false
      let speechStartAttempted = false
      let configChanged = false
      let selectionChanged = false
      try {
        // Phase 1 — load. The Gateway and speech service keep running on the
        // old model. In background mode the old model keeps answering; in
        // sequential mode (not enough VRAM for both) replies pause while the
        // new model loads, but nothing has to be restarted afterwards.
        await lms('server', 'start')
        if (!chosenAlreadyLoaded) {
          progress({ phase: 'loading', mode, modelKey: chosen.modelKey, displayName: chosen.displayName })
          if (!preload && oldLoaded) { await lms('unload', oldLoaded.identifier); oldUnloaded = true }
          await loadModel(chosen.modelKey, length); newLoaded = true
        }
        // Phase 2 — swap. Only now do the services go down, and only for as
        // long as their restart takes.
        progress({ phase: 'swapping', mode, modelKey: chosen.modelKey, displayName: chosen.displayName })
        await gateway.stop(); gatewayStopped = true
        if (speech) { await stopSpeech(speech); speechStopped = true }
        await write(paths.opencodeConfig, after); configChanged = true
        speechStartAttempted = true
        await startSpeech(chosen.modelKey, voice, conversationMode)
        await write(paths.selection, `${chosen.modelKey}\n`); selectionChanged = true
        // The backend's remembered coordinator session is pinned to the old
        // model; OpenCode rejects prompts on it once that model is gone from
        // its config ("ProviderModelNotFoundError"). Start fresh on the new one.
        await gateway.resetBackendSessions?.()
        await gateway.start(); gatewayStopped = false
        // Phase 3 — free the old model. Failure here is not worth a rollback;
        // the app is already fully on the new model.
        let warning
        if (preload && oldLoaded) {
          progress({ phase: 'unloading', mode, modelKey: previousKey })
          try { await lms('unload', oldLoaded.identifier) } catch (error) {
            warning = `The previous model is still loaded in LM Studio (${error.message}). Unload it there to free memory.`
          }
        }
        progress({ phase: 'done', mode, modelKey: chosen.modelKey, displayName: chosen.displayName })
        return warning
          ? { ok: true, selectedModelKey: chosen.modelKey, mode, warning }
          : { ok: true, selectedModelKey: chosen.modelKey, mode }
      } catch (error) {
        progress({ phase: 'recovering', mode, modelKey: previousKey })
        const recoveryErrors = []
        async function recover(action) { try { await action() } catch (failure) { recoveryErrors.push(failure.message) } }
        if (speechStopped || speechStartAttempted) {
          const currentSpeech = await listener().catch(() => null)
          if (currentSpeech && ownsSpeech(currentSpeech, paths.speech)) await recover(() => stopSpeech(currentSpeech))
        }
        if (selectionChanged) await recover(() => write(paths.selection, `${previousKey}\n`))
        if (configChanged) await recover(() => write(paths.opencodeConfig, before))
        if (newLoaded) await recover(() => lms('unload', chosen.modelKey))
        if (oldUnloaded) await recover(() => loadModel(previousKey, length))
        if (speechStopped) await recover(() => startSpeech(previousKey, voice, conversationMode))
        if (gatewayStopped) await recover(() => gateway.start())
        progress({ phase: 'failed', mode, modelKey: previousKey })
        return { ok: false, selectedModelKey: previousKey,
          error: recoveryErrors.length
            ? `${error.message} Recovery also needs attention: ${recoveryErrors.join('; ')}`
            : error.message,
          recovered: recoveryErrors.length === 0 }
      }
    } catch (error) {
      return { ok: false, error: error.message }
    } finally {
      pending = false
    }
  }

  // Reload the current model with a different context window. Neither the
  // speech service nor OpenCode care about the context size, so nothing is
  // restarted: only LM Studio's loaded instance changes.
  async function setContextLength(value) {
    if (pending) return { ok: false, error: 'A model switch is already in progress.' }
    pending = true
    try {
      const length = parseContextLength(value)
      const current = await contextLength()
      if (!length) return { ok: false, contextLength: current, error: 'Choose one of the listed context sizes.' }
      if (length === current) return { ok: true, contextLength: current }
      const { selectedModelKey } = await list()
      const loaded = selectedModelKey ? (await loadedModels()).find(item => item.modelKey === selectedModelKey) : null
      let unloaded = false
      try {
        if (loaded) {
          progress({ phase: 'reloading', mode: 'context', modelKey: selectedModelKey, contextLength: length })
          await lms('server', 'start')
          await lms('unload', loaded.identifier); unloaded = true
          await loadModel(selectedModelKey, length)
        }
        await write(paths.contextLength, `${length}\n`)
        progress({ phase: 'done', mode: 'context', modelKey: selectedModelKey, contextLength: length })
        return { ok: true, contextLength: length }
      } catch (error) {
        const recoveryErrors = []
        if (unloaded) {
          try { await loadModel(selectedModelKey, current) } catch (failure) { recoveryErrors.push(failure.message) }
        }
        progress({ phase: 'failed', mode: 'context', modelKey: selectedModelKey, contextLength: current })
        return { ok: false, contextLength: current,
          error: recoveryErrors.length
            ? `${error.message} The model could not be reloaded either: ${recoveryErrors.join('; ')}`
            : error.message }
      }
    } catch (error) {
      return { ok: false, error: error.message }
    } finally {
      pending = false
    }
  }

  // Change the speaking voice: only the speech service restarts (10–20 s);
  // the model and Gateway are untouched.
  async function setVoice(value) {
    if (pending) return { ok: false, error: 'A model switch is already in progress.' }
    pending = true
    try {
      const files = await voiceFiles()
      const current = await selectedVoice(files)
      const chosen = parseVoice(value, files)
      if (!chosen) return { ok: false, voice: current.id, error: 'Choose a listed voice, or drop a WAV file into the voices folder and refresh.' }
      if (chosen.id === current.id) return { ok: true, voice: current.id }
      const { selectedModelKey } = await list()
      if (!selectedModelKey) return { ok: false, voice: current.id, error: 'No local model is selected yet.' }
      const speech = await listener()
      if (speech && !ownsSpeech(speech, paths.speech)) {
        return { ok: false, voice: current.id,
          error: `Another program owns the speech service (${speech.executablePath || `pid ${speech.pid}`}). Close it before changing voices.` }
      }
      // Text mode loads no voice, so the choice is only saved for the next voice start.
      if (await appMode() === 'text') {
        await write(paths.voice, `${chosen.id}\n`)
        return { ok: true, voice: chosen.id }
      }
      let speechStopped = false
      try {
        progress({ phase: 'voice', mode: 'voice', voice: chosen.id })
        if (speech) { await stopSpeech(speech); speechStopped = true }
        await startSpeech(selectedModelKey, voiceArgument(chosen))
        await write(paths.voice, `${chosen.id}\n`)
        progress({ phase: 'done', mode: 'voice', voice: chosen.id })
        return { ok: true, voice: chosen.id }
      } catch (error) {
        const recoveryErrors = []
        const stray = await listener().catch(() => null)
        if (stray && ownsSpeech(stray, paths.speech)) {
          try { await stopSpeech(stray) } catch (failure) { recoveryErrors.push(failure.message) }
        }
        if (speechStopped) {
          try { await startSpeech(selectedModelKey, voiceArgument(current)) } catch (failure) { recoveryErrors.push(failure.message) }
        }
        progress({ phase: 'failed', mode: 'voice', voice: current.id })
        return { ok: false, voice: current.id,
          error: recoveryErrors.length
            ? `${error.message} The previous voice could not be restored either: ${recoveryErrors.join('; ')}`
            : error.message }
      }
    } catch (error) {
      return { ok: false, error: error.message }
    } finally {
      pending = false
    }
  }

  // Voice <-> text. The speech service restarts with or without its speech models,
  // and the Gateway restarts so every response asks for audio or text to match: it
  // reads the saved mode when it starts, so the file is written before that.
  async function setAppMode(value) {
    if (pending) return { ok: false, error: 'A model switch is already in progress.' }
    pending = true
    try {
      const current = await appMode()
      const chosen = APP_MODES.includes(value) ? value : null
      if (!chosen) return { ok: false, appMode: current, error: 'Choose voice or text.' }
      if (chosen === current) return { ok: true, appMode: current }
      const { selectedModelKey } = await list()
      if (!selectedModelKey) return { ok: false, appMode: current, error: 'No local model is selected yet.' }
      if (gateway.ownership() !== 'owned') {
        return { ok: false, appMode: current,
          error: 'This app is using another Qwen gateway. Close the other Qwen app and reopen this one before changing modes.' }
      }
      const speech = await listener()
      if (speech && !ownsSpeech(speech, paths.speech)) {
        return { ok: false, appMode: current,
          error: `Another program owns the speech service (${speech.executablePath || `pid ${speech.pid}`}). Close it before changing modes.` }
      }
      const voice = voiceArgument(await selectedVoice(await voiceFiles()))
      let gatewayStopped = false
      let speechStopped = false
      let modeWritten = false
      try {
        progress({ phase: 'mode', mode: 'app', appMode: chosen })
        await gateway.stop(); gatewayStopped = true
        if (speech) { await stopSpeech(speech); speechStopped = true }
        await write(paths.appMode, `${chosen}\n`); modeWritten = true
        await startSpeech(selectedModelKey, voice, chosen)
        await gateway.start(); gatewayStopped = false
        progress({ phase: 'done', mode: 'app', appMode: chosen })
        return { ok: true, appMode: chosen }
      } catch (error) {
        const recoveryErrors = []
        async function recover(action) { try { await action() } catch (failure) { recoveryErrors.push(failure.message) } }
        const stray = await listener().catch(() => null)
        if (stray && ownsSpeech(stray, paths.speech)) await recover(() => stopSpeech(stray))
        if (modeWritten) await recover(() => write(paths.appMode, `${current}\n`))
        if (speechStopped) await recover(() => startSpeech(selectedModelKey, voice, current))
        if (gatewayStopped) await recover(() => gateway.start())
        progress({ phase: 'failed', mode: 'app', appMode: current })
        return { ok: false, appMode: current,
          error: recoveryErrors.length
            ? `${error.message} Recovery also needs attention: ${recoveryErrors.join('; ')}`
            : error.message }
      }
    } catch (error) {
      return { ok: false, error: error.message }
    } finally {
      pending = false
    }
  }

  // The Prism server is spawned detached so it outlives the launcher that starts
  // it, and nothing else ever closes it: quitting would leave the weights in
  // VRAM. stop() is a no-op unless the listener on port 8080 is still the
  // process recorded in our own state file, so an LM Studio server, or a
  // standalone Bonsai someone else started, is never touched.
  async function stopLocalRuntime() {
    if (!bonsai) return { ok: true }
    try {
      await bonsai.stop()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }

  return { list, switchModel, setContextLength, setVoice, setAppMode, stopLocalRuntime }
}

export { canPreload, defaultPaths, ownsSpeech, parseAppMode, parseContextLength, parseModels, parseVoice, speechArguments, updateOpenCodeConfig }

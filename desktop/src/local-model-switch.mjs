import { spawn, execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import net from 'node:net'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const SPEECH_PORT = 8765
// OpenCode's agent prompt is ~9k tokens, so a model loaded with LM Studio's
// default 8192 context fails every agent task. Keep in step with the launcher
// script (Start My Voice App.ps1, $modelContextLength).
const MODEL_CONTEXT_LENGTH = Number(process.env.QWEN_AUDIO_LOCAL_MODEL_CONTEXT || 32768)

// Files edited by PowerShell/Notepad often carry a UTF-8 BOM, which JSON.parse
// rejects ("Unexpected token" before the opening brace).
function stripBom(text) {
  return String(text ?? '').replace(/^\uFEFF/, '')
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
    workdir: root,
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
  const script = `$listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort ${SPEECH_PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($listener) { $p = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"; if ($p) { [pscustomobject]@{ pid = $p.ProcessId; commandLine = $p.CommandLine; executablePath = $p.ExecutablePath } | ConvertTo-Json -Compress } }`
  const output = await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
  return output ? parseJson(output, 'Speech service listener info') : null
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

function launchSpeech(file, modelKey, workdir) {
  const child = spawn(file, [
    'serve', '--device', 'cpu', '--stt', 'parakeet-tdt',
    '--llm_backend', 'chat-completions', '--model_name', modelKey,
    '--responses_api_base_url', 'http://127.0.0.1:1234/v1',
    '--responses_api_api_key', 'lm-studio', '--tts', 'pocket',
    '--no_smart_turn',
  ], { cwd: workdir, detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
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
    .map(({ modelKey, displayName }) => ({ modelKey, displayName: displayName || modelKey }))
}

export function createLocalModelSwitcher({
  paths = defaultPaths(),
  lms = (...args) => command(paths.lms, args),
  read = path => fs.readFile(path, 'utf8'),
  write = replaceFile,
  listener = speechListener,
  stopSpeech = async info => { process.kill(info.pid); await waitForPort(SPEECH_PORT, false) },
  startSpeech = async modelKey => {
    launchSpeech(paths.speech, modelKey, paths.workdir)
    await waitForPort(SPEECH_PORT, true, 120_000)
  },
  gateway = { ownership: () => 'unavailable', stop: async () => {}, start: async () => {}, resetBackendSessions: async () => {} },
} = {}) {
  let pending = false

  async function list() {
    const models = parseModels(await lms('ls', '--llm', '--json'))
    let selectedModelKey = null
    try {
      selectedModelKey = String(await read(paths.selection)).trim() || null
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (!selectedModelKey) {
      const settings = parseJson(await read(paths.opencodeConfig), 'OpenCode config')
      selectedModelKey = String(settings.model || '').replace(/^lmstudio\//, '') || null
    }
    return { ok: true, models, selectedModelKey }
  }

  async function switchModel(modelKey) {
    if (pending) return { ok: false, error: 'A model switch is already in progress.' }
    pending = true
    try {
      const { models, selectedModelKey: previousKey } = await list()
      const chosen = models.find(model => model.modelKey === modelKey)
      if (!chosen) return { ok: false, selectedModelKey: previousKey, error: 'Choose an installed LM Studio model.' }
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
      const loaded = parseJson(await lms('ps', '--json'), 'LM Studio loaded-model list')
      if (!Array.isArray(loaded)) throw new Error('LM Studio returned an invalid loaded-model list.')
      const oldLoaded = loaded.find(item => item.modelKey === previousKey)
      const chosenAlreadyLoaded = loaded.some(item => item.modelKey === chosen.modelKey)
      let gatewayStopped = false
      let speechStopped = false
      let speechStartAttempted = false
      let newLoaded = false
      let configChanged = false
      let selectionChanged = false
      try {
        await gateway.stop(); gatewayStopped = true
        if (speech) { await stopSpeech(speech); speechStopped = true }
        await lms('server', 'start')
        if (oldLoaded) await lms('unload', oldLoaded.identifier)
        if (!chosenAlreadyLoaded) { await lms('load', chosen.modelKey, '-y', '--context-length', String(MODEL_CONTEXT_LENGTH)); newLoaded = true }
        await write(paths.opencodeConfig, after); configChanged = true
        speechStartAttempted = true
        await startSpeech(chosen.modelKey)
        await write(paths.selection, `${chosen.modelKey}\n`); selectionChanged = true
        // The backend's remembered coordinator session is pinned to the old
        // model; OpenCode rejects prompts on it once that model is gone from
        // its config ("ProviderModelNotFoundError"). Start fresh on the new one.
        await gateway.resetBackendSessions?.()
        await gateway.start(); gatewayStopped = false
        return { ok: true, selectedModelKey: chosen.modelKey }
      } catch (error) {
        const recoveryErrors = []
        async function recover(action) { try { await action() } catch (failure) { recoveryErrors.push(failure.message) } }
        if (speechStopped || speechStartAttempted) {
          const currentSpeech = await listener().catch(() => null)
          if (currentSpeech && ownsSpeech(currentSpeech, paths.speech)) await recover(() => stopSpeech(currentSpeech))
        }
        if (selectionChanged) await recover(() => write(paths.selection, `${previousKey}\n`))
        if (configChanged) await recover(() => write(paths.opencodeConfig, before))
        if (newLoaded) await recover(() => lms('unload', chosen.modelKey))
        if (oldLoaded) await recover(() => lms('load', previousKey, '-y', '--context-length', String(MODEL_CONTEXT_LENGTH)))
        if (speechStopped) await recover(() => startSpeech(previousKey))
        if (gatewayStopped) await recover(() => gateway.start())
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

  return { list, switchModel }
}

export { defaultPaths, ownsSpeech, parseModels, updateOpenCodeConfig }

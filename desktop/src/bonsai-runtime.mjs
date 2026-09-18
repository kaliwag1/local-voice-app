import { spawn, execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { isBonsai } from '../../shared/local-model-route.mjs'

const exec = promisify(execFile)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const normalize = value => String(value || '').replaceAll('/', '\\').toLowerCase()
export function bonsaiPaths(home = process.env.USERPROFILE || homedir(), root = process.env.QWEN_AUDIO_LOCAL_VOICE_ROOT) {
  return {
    exe: join(home, 'Documents', 'Codex', 'BonsaiRunner', 'llama-server.exe'),
    state: join(root || join(home, 'Documents', 'Codex', 'BonsaiRunner'), '.voice-bonsai-runtime.json'),
    models: {
      'bonsai/official': join(home, '.lmstudio', 'models', 'prism-ml', 'Ternary-Bonsai-2-27B-gguf', 'Ternary-Bonsai-2-27B-PQ2_0.gguf'),
      'bonsai/crack': join(home, '.lmstudio', 'models', 'dealignai', 'Bonsai-2-27B-Ternary-CRACK-GGUF', 'Bonsai-2-27B-PQ2_0-CRACK.gguf'),
    },
  }
}
export function serverArguments(model, context) {
  if (![16384, 32768, 65536, 131072].includes(Number(context))) throw new Error('Unsupported Bonsai context size.')
  return ['-m', model, '-ngl', '99', '-fa', 'on', '-c', String(context), '--parallel', '1', '--jinja', '--alias', 'bonsai', '--host', '127.0.0.1', '--port', '8080']
}
export function ownsBonsai(info, record, paths) {
  return Boolean(info && record && Number.isSafeInteger(record.pid) && info.pid === record.pid
    && isBonsai(record.key) && normalize(info.executablePath) === normalize(paths.exe)
    && normalize(info.commandLine).includes(normalize(paths.models[record.key])))
}
async function listener() {
  const script = '$c = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-CimInstance Win32_Process -Filter "ProcessId = $($c.OwningProcess)"; [pscustomobject]@{pid=[int]$p.ProcessId; executablePath=$p.ExecutablePath; commandLine=$p.CommandLine} | ConvertTo-Json -Compress }; exit 0'
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 })
  return stdout.trim() ? JSON.parse(stdout.replace(/^\uFEFF/, '')) : null
}
export function createBonsaiRuntime({ paths = bonsaiPaths(), inspect = listener, fetchImpl = fetch } = {}) {
  async function record() { try { return JSON.parse(await fs.readFile(paths.state, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
  async function status(strict = false) {
    const info = await inspect()
    const saved = await record()
    if (info && !ownsBonsai(info, saved, paths)) {
      if (strict) throw new Error('Port 8080 belongs to another service. Close the standalone Bonsai server before switching models.')
      return null
    }
    return info ? saved : null
  }
  async function list() {
    try { await fs.access(paths.exe) } catch { return [] }
    const items = []
    for (const [modelKey, file] of Object.entries(paths.models)) {
      try {
        await fs.access(file)
        items.push({ type: 'llm', modelKey, displayName: modelKey.endsWith('official') ? 'Bonsai 2 Official PQ2 (Prism)' : 'Bonsai 2 CRACK PQ2 (Prism)', sizeBytes: null })
      } catch { /* only show downloaded variants */ }
    }
    return items
  }
  async function stop() {
    const current = await status()
    if (!current) return
    process.kill(current.pid)
    for (let i = 0; i < 40; i++) {
      if (!await inspect()) { await fs.rm(paths.state, { force: true }); return }
      await pause(250)
    }
    throw new Error('Bonsai did not release port 8080.')
  }
  async function start(key, context) {
    if (!isBonsai(key)) throw new Error('Unknown Bonsai variant.')
    await fs.access(paths.exe); await fs.access(paths.models[key])
    const args = serverArguments(paths.models[key], context)
    const current = await status(true)
    if (current?.key === key && current.context === Number(context)) {
      const response = await fetchImpl('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(3000) })
      if (response.ok) return
    }
    if (current) await stop()
    const log = await fs.open(`${paths.state}.log`, 'a')
    const child = spawn(paths.exe, args, { cwd: dirname(paths.exe), detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] })
    let failure
    child.on('error', error => { failure = error })
    child.on('exit', code => { failure = new Error(`Bonsai exited (${code}). See ${paths.state}.log`) })
    try {
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
      await fs.writeFile(paths.state, JSON.stringify({ pid: child.pid, key, context: Number(context) }))
      child.unref()
      for (let i = 0; i < 180; i++) {
        if (failure) throw failure
        try {
          const response = await fetchImpl('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(1000) })
          if (response.ok) return
        } catch { /* loading */ }
        await pause(1000)
      }
      throw new Error(`Bonsai startup timed out. See ${paths.state}.log`)
    } catch (error) {
      if (child.pid && child.exitCode === null) child.kill()
      await fs.rm(paths.state, { force: true })
      throw error
    } finally { await log.close() }
  }
  return { list, status, start, stop }
}

// Present both providers through the switcher's existing load/unload transaction.
// Bonsai is always sequential, including transitions back to LM Studio.
export function withBonsai(lms, runtime) {
  return async (...args) => {
    if (args[0] === 'ls') {
      const models = JSON.parse(await lms(...args))
      return JSON.stringify([...models.filter(m => !/bonsai.*(pq2|ptq1)/i.test(`${m.modelKey || ''} ${m.displayName || ''}`)), ...await runtime.list()])
    }
    if (args[0] === 'ps') {
      const models = JSON.parse(await lms(...args))
      const current = await runtime.status()
      if (current) models.push({ modelKey: current.key, identifier: current.key, contextLength: current.context })
      return JSON.stringify(models)
    }
    if (args[0] === 'unload' && isBonsai(args[1])) return runtime.stop()
    if (args[0] === 'load') {
      if (isBonsai(args[1])) {
        const loaded = JSON.parse(await lms('ps', '--json'))
        if (loaded.length) throw new Error('Other models are still loaded in LM Studio. Unload them before starting Bonsai to free VRAM.')
        return runtime.start(args[1], Number(args[args.indexOf('--context-length') + 1]))
      }
      if (await runtime.status()) throw new Error('Stop Bonsai before loading an LM Studio model.')
    }
    return lms(...args)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, key, context, root] = process.argv.slice(2)
  const runtime = createBonsaiRuntime({ paths: bonsaiPaths(undefined, root) })
  try {
    if (action === 'start') await runtime.start(key, Number(context))
    else if (action === 'stop') await runtime.stop()
    else throw new Error('Expected start or stop')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}

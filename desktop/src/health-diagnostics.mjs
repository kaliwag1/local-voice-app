import { createConnection } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { isBonsai, localModelRoute } from '../../shared/local-model-route.mjs'

const runFile = promisify(execFile)

export function localEndpoint(value) {
  const url = new URL(value)
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password) throw new Error('Only local service addresses are checked.')
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || (['https:', 'wss:'].includes(url.protocol) ? 443 : 80)) }
}

export function probePort({ host, port }, timeoutMs = 1200) {
  return new Promise(resolve => {
    const socket = createConnection({ host, port })
    let finished = false
    const finish = listening => {
      if (finished) return
      finished = true
      socket.destroy()
      resolve({ host, port, listening })
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

export function loadedModels(payload) {
  const models = payload?.models || payload?.data || []
  return models.flatMap(model => {
    if (model.type && !['llm', 'vlm'].includes(model.type)) return []
    if (Array.isArray(model.loaded_instances)) {
      return model.loaded_instances.map(instance => ({
        name: model.display_name || model.key || model.id || 'Unknown model',
        id: instance.id || model.key || model.id,
        context: instance.config?.context_length ?? null,
        maximumContext: model.max_context_length ?? null,
      }))
    }
    return model.state === 'loaded' ? [{
      name: model.id || model.display_name || 'Unknown model',
      id: model.id,
      context: model.loaded_context_length ?? null,
      maximumContext: model.max_context_length ?? null,
    }] : []
  })
}

export function parseGpuMemory(text) {
  return String(text).trim().split(/\r?\n/).filter(Boolean).map(line => {
    const fields = line.split(',').map(value => value.trim())
    const freeMiB = Number(fields.pop())
    const usedMiB = Number(fields.pop())
    const totalMiB = Number(fields.pop())
    if (![freeMiB, usedMiB, totalMiB].every(Number.isFinite)) return null
    return { name: fields.join(', '), totalMiB, usedMiB, freeMiB }
  }).filter(Boolean)
}

export async function collectHealthDiagnostics({
  lmUrl = 'http://127.0.0.1:1234/v1',
  speechUrl = 'ws://127.0.0.1:8765/v1/realtime',
  gatewayUrl = 'http://127.0.0.1:3101',
  openCodeUrl = 'http://127.0.0.1:4096',
  fetchImpl = fetch,
  probe = probePort,
  run = runFile,
  selectionFile = '',
  read = readFile,
} = {}) {
  let selection = ''
  if (selectionFile) { try { selection = (await read(selectionFile, 'utf8')).trim() } catch { /* optional */ } }
  const bonsai = isBonsai(selection)
  if (bonsai) lmUrl = localModelRoute(selection).baseUrl
  const modelProvider = bonsai ? 'Bonsai (Prism)' : 'LM Studio'
  const services = await Promise.all(Object.entries({
    [modelProvider]: lmUrl, Speech: speechUrl, Gateway: gatewayUrl, OpenCode: openCodeUrl,
  }).map(async ([name, address]) => {
    try { return { name, ...await probe(localEndpoint(address)) } }
    catch (error) { return { name, listening: null, error: error.message } }
  }))
  const json = async url => {
    localEndpoint(url)
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(2500), redirect: 'error' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }
  const [models, gpu, openCode] = await Promise.all([
    (async () => {
      try {
        localEndpoint(lmUrl)
        const origin = new URL(lmUrl).origin
        if (bonsai) {
          const payload = await json(`${lmUrl}/models`)
          let props = {}
          try { props = await json(`${origin}/props`) } catch { /* optional context details */ }
          return { available: true, loaded: (payload.data || []).map(model => ({
            id: model.id, name: selection === 'bonsai/crack' ? 'Bonsai 2 CRACK PQ2' : 'Bonsai 2 Official PQ2',
            context: props.default_generation_settings?.n_ctx ?? null, maximumContext: null,
          })) }
        }
        let payload
        try { payload = await json(`${origin}/api/v1/models`) }
        catch { payload = await json(`${origin}/api/v0/models`) }
        return { available: true, loaded: loadedModels(payload) }
      } catch { return { available: false, loaded: [], error: `${modelProvider} model details unavailable. Check that its local server is running.` } }
    })(),
    (async () => {
      try {
        const { stdout } = await run('nvidia-smi', ['--query-gpu=name,memory.total,memory.used,memory.free', '--format=csv,noheader,nounits'], {
          windowsHide: true, timeout: 3000, maxBuffer: 64 * 1024,
        })
        const devices = parseGpuMemory(stdout)
        return { devices, error: devices.length ? '' : 'GPU memory reading unavailable.' }
      } catch { return { devices: [], error: 'NVIDIA memory reading unavailable (nvidia-smi could not run).' } }
    })(),
    (async () => {
      try {
        const payload = await json(`${new URL(openCodeUrl).origin}/global/health`)
        return { healthy: payload.healthy === true, version: payload.version || '' }
      } catch { return { healthy: null, version: '' } }
    })(),
  ])
  return { checkedAt: new Date().toISOString(), services, models, gpu, openCode, modelProvider }
}

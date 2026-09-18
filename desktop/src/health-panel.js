export function installHealthPanel(bridge) {
  const panel = document.querySelector('#health-settings')
  const results = document.querySelector('#health-results')
  const updated = document.querySelector('#health-updated')
  const refreshButton = document.querySelector('#refresh-health')
  let refreshing = false
  const text = (tag, value, className) => {
    const element = document.createElement(tag)
    element.textContent = value
    if (className) element.className = className
    return element
  }
  const card = (title, rows) => {
    const section = document.createElement('section')
    section.className = 'settings-card health-card'
    section.append(text('h2', title))
    const list = document.createElement('dl')
    for (const [label, value] of rows) {
      const row = document.createElement('div')
      row.append(text('dt', label), text('dd', value))
      list.append(row)
    }
    section.append(list)
    return section
  }
  const render = data => {
    const runtime = data.runtime
    const models = data.models.loaded
    const modelRows = data.models.available
      ? models.length ? models.flatMap(model => [
        ['Loaded model', model.name],
        ['Loaded context', Number.isFinite(model.context) ? `${model.context.toLocaleString()} tokens${model.context < 32768 ? ' — below the 32k used for agent tasks' : ''}` : 'Not reported by LM Studio'],
        ...(model.maximumContext ? [['Model maximum', `${model.maximumContext.toLocaleString()} tokens`]] : []),
      ]) : [['Loaded model', 'No model loaded']]
      : [['Status', data.models.error]]
    const gpuRows = data.gpu.devices.length ? data.gpu.devices.flatMap(gpu => [
      ['GPU', gpu.name],
      ['VRAM used / total', `${(gpu.usedMiB / 1024).toFixed(1)} / ${(gpu.totalMiB / 1024).toFixed(1)} GiB`],
      ['VRAM free', `${(gpu.freeMiB / 1024).toFixed(1)} GiB`],
    ]) : [['VRAM', data.gpu.error]]
    const voice = runtime?.realtimeConnection
    const speechListening = data.services.find(service => service.name === 'Speech')?.listening
    const speechStatus = voice?.connected > 0 ? 'Connected to Gateway'
      : voice?.connecting > 0 ? 'Connecting to Gateway'
        : speechListening === true ? 'Port listening; no active voice connection reported'
          : speechListening === false ? 'Not connected' : 'Status unavailable'
    results.replaceChildren(
      card(data.modelProvider || 'LM Studio', modelRows),
      card('GPU memory', gpuRows),
      card('Services', [
        ['Gateway', runtime ? runtime.gatewayConnected ? 'Connected' : 'Not connected' : 'Status unavailable'],
        ['Speech', speechStatus],
        ['OpenCode API', data.openCode.healthy === true ? `Healthy${data.openCode.version ? ` · ${data.openCode.version}` : ''}` : data.openCode.healthy === false ? 'Reports unhealthy' : 'Health endpoint unavailable'],
        ['Agent connection', runtime?.backend ? `${runtime.backend.label || 'Backend'} · ${runtime.backend.connected ? 'Connected' : runtime.backend.status || 'Not connected'}` : 'Not reported by Gateway'],
        ...(runtime?.backend?.error ? [['Agent error', runtime.backend.error]] : []),
      ]),
      card('Local ports', data.services.map(service => [
        service.name,
        service.error || `${service.host}:${service.port} — ${service.listening ? 'Listening' : 'Not reachable'}`,
      ])),
    )
    updated.textContent = `Checked ${new Date(data.checkedAt).toLocaleTimeString()}`
  }
  const refresh = async () => {
    if (refreshing || panel.hidden || document.hidden) return
    refreshing = true
    refreshButton.disabled = true
    updated.textContent = 'Checking local services…'
    try { render(await bridge.loadHealthDiagnostics()) }
    catch { updated.textContent = 'Could not refresh. Displayed readings may be out of date.' }
    finally { refreshing = false; refreshButton.disabled = false }
  }
  refreshButton.addEventListener('click', refresh)
  const timer = setInterval(refresh, 10_000)
  document.addEventListener('visibilitychange', refresh)
  window.addEventListener('beforeunload', () => clearInterval(timer), { once: true })
  return refresh
}

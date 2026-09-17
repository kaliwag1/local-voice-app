// System-wide push-to-talk. Electron's globalShortcut only reports key presses, never
// releases, so hold-to-talk from another application needs an OS-level keyboard hook:
// uiohook-napi (libuiohook, N-API prebuilt for win32/mac/linux). The module is optional —
// when it is not installed the hook reports `available: false` and the renderer falls back
// to its own keydown/keyup handling (panel focused only).
//
// The accelerator grammar is the desktop one ("F9", "CommandOrControl+Shift+Space",
// "Alt+T"). keydown needs the exact modifier set; keyup only looks at the main key, since
// modifiers are usually released in any order.

function resolveKeycode(UiohookKey, key) {
  const candidates = [key, `Digit${key}`, `Arrow${key}`, `Num${key}`, key.toUpperCase()]
  for (const name of candidates) {
    if (Object.hasOwn(UiohookKey, name)) return UiohookKey[name]
  }
  return null
}

export function parseAccelerator(accelerator) {
  const parts = String(accelerator || '').split('+').map(part => part.trim()).filter(Boolean)
  if (!parts.length) return null
  const key = parts.pop()
  return {
    key,
    command: parts.includes('CommandOrControl') || parts.includes('Control') || parts.includes('Command'),
    alt: parts.includes('Alt'),
    shift: parts.includes('Shift'),
  }
}

export function createPushToTalkHook({ onChange, logger, load = () => import('uiohook-napi') } = {}) {
  let module = null
  let loading = null
  let accelerator = ''
  let target = null
  let held = false
  let listening = false

  const emit = next => {
    if (held === next) return
    held = next
    try { onChange?.(next) } catch (error) { logger?.warn?.('push_to_talk.handler_failed', { error: String(error) }) }
  }

  const onKeyDown = event => {
    if (!target || event.keycode !== target.keycode) return
    const command = Boolean(event.ctrlKey || event.metaKey)
    if (command !== target.command || Boolean(event.altKey) !== target.alt || Boolean(event.shiftKey) !== target.shift) return
    emit(true)
  }
  const onKeyUp = event => {
    if (!target || event.keycode !== target.keycode) return
    emit(false)
  }

  async function ensureLoaded() {
    if (module) return module
    if (!loading) {
      loading = load().then(loaded => {
        module = loaded.default?.uIOhook ? loaded.default : loaded
        return module
      }).catch(error => {
        logger?.warn?.('push_to_talk.hook_unavailable', { error: String(error?.message || error) })
        module = null
        return null
      })
    }
    return loading
  }

  function applyTarget() {
    const parsed = parseAccelerator(accelerator)
    if (!parsed || !module) { target = null; return }
    const keycode = resolveKeycode(module.UiohookKey, parsed.key)
    target = keycode == null ? null : { ...parsed, keycode }
    if (keycode == null) logger?.warn?.('push_to_talk.unsupported_key', { accelerator })
  }

  return {
    get available() { return Boolean(module) },
    get active() { return listening && Boolean(target) },
    get held() { return held },
    async setAccelerator(next) {
      accelerator = String(next || '')
      emit(false)
      if (!accelerator) { this.stop(); return false }
      const loaded = await ensureLoaded()
      if (!loaded) return false
      applyTarget()
      if (!target) { this.stop(); return false }
      if (!listening) {
        loaded.uIOhook.on('keydown', onKeyDown)
        loaded.uIOhook.on('keyup', onKeyUp)
        loaded.uIOhook.start()
        listening = true
        logger?.info?.('push_to_talk.hook_started', { accelerator })
      }
      return true
    },
    stop() {
      target = null
      emit(false)
      if (listening && module) {
        module.uIOhook.off('keydown', onKeyDown)
        module.uIOhook.off('keyup', onKeyUp)
        try { module.uIOhook.stop() } catch { /* already stopped */ }
        listening = false
        logger?.info?.('push_to_talk.hook_stopped')
      }
    },
    // test seam
    _handle(type, event) { (type === 'keydown' ? onKeyDown : onKeyUp)(event) },
  }
}

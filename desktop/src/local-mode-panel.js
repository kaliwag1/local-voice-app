// Settings → Application → Conversation: voice, or text only. Text mode runs the
// speech service without its speech models, so switching restarts it and the
// Gateway; the conversation window reloads in the new mode.
export const APP_MODE_OPTIONS = [
  { id: 'voice', label: 'Voice' },
  { id: 'text', label: 'Text only' },
]

export function appModeHint(mode) {
  return mode === 'text'
    ? 'Typed chat only: no microphone and no spoken replies. Starts faster and uses less memory.'
    : 'Talk and listen, or type. Replies are spoken.'
}

export function installLocalModePanel(bridge, { onChanged } = {}) {
  const row = document.querySelector('#local-mode-row')
  const select = document.querySelector('#local-mode')
  const hint = document.querySelector('#local-mode-hint')
  if (!row || !select || typeof bridge?.listLocalModels !== 'function') return async () => {}
  let current = 'voice'
  let busy = false

  const say = (message = '', isError = false) => {
    if (!hint) return
    hint.textContent = message
    hint.classList.toggle('error', Boolean(isError))
  }

  select.replaceChildren(...APP_MODE_OPTIONS.map(option => {
    const item = document.createElement('option')
    item.value = option.id
    item.textContent = option.label
    return item
  }))

  const refresh = async () => {
    try {
      const result = await bridge.listLocalModels()
      // Only the local runtime reports a mode; anything else keeps the row hidden.
      row.hidden = !result?.ok || typeof result.appMode !== 'string'
      if (row.hidden) return
      current = result.appMode === 'text' ? 'text' : 'voice'
      select.value = current
      if (!busy) say(appModeHint(current))
    } catch (error) {
      row.hidden = true
      console.error('local mode lookup failed', error)
    }
  }

  select.addEventListener('change', async () => {
    if (busy || typeof bridge.setLocalAppMode !== 'function') return
    const chosen = select.value
    busy = true
    select.disabled = true
    say(chosen === 'text'
      ? 'Switching to text only: restarting the speech service without speech…'
      : 'Switching to voice: restarting the speech service (about 25 seconds)…')
    try {
      const result = await bridge.setLocalAppMode(chosen)
      if (result?.ok) {
        current = result.appMode || chosen
        select.value = current
        say(appModeHint(current))
        onChanged?.(current)
      } else {
        select.value = current
        say(result?.error || 'Could not change the mode.', true)
      }
    } catch (error) {
      select.value = current
      say(error?.message || 'Could not change the mode.', true)
    } finally {
      busy = false
      select.disabled = false
    }
  })

  void refresh()
  return refresh
}

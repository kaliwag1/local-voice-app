// Settings → Application → Voice: the Pocket TTS speaker used by the local
// speech service. It lived beside the chat before, but it is a setting, not a
// per-conversation choice, and changing it restarts the speech service.
//
// Presets ship with Pocket TTS; anything else is a clip dropped into the
// launcher's `voices` folder and cloned locally.
export function voiceGroups(options = []) {
  const presets = options.filter(option => option?.kind === 'preset')
  const files = options.filter(option => option?.kind === 'file')
  return [
    ...(presets.length ? [{ label: 'Built-in', options: presets }] : []),
    ...(files.length ? [{ label: 'My voices folder', options: files }] : []),
  ]
}

export function installLocalVoicePanel(bridge) {
  const row = document.querySelector('#local-voice-row')
  const select = document.querySelector('#local-voice')
  const hint = document.querySelector('#local-voice-hint')
  if (!row || !select || typeof bridge?.listLocalModels !== 'function') return async () => {}
  let current = ''
  let busy = false

  const say = (message = '', isError = false) => {
    if (!hint) return
    hint.textContent = message
    hint.classList.toggle('error', Boolean(isError))
  }

  const render = ({ voice = '', voiceOptions = [] } = {}) => {
    const groups = voiceGroups(voiceOptions)
    // Only local runtimes report voices; without any, the row stays hidden
    // rather than showing an empty control.
    row.hidden = groups.length === 0
    if (row.hidden) return
    select.replaceChildren(...groups.map(group => {
      const element = document.createElement('optgroup')
      element.label = group.label
      element.replaceChildren(...group.options.map(option => {
        const item = document.createElement('option')
        item.value = option.id
        item.textContent = option.id === 'jean' ? `${option.label} (default)` : option.label
        return item
      }))
      return element
    }))
    current = voice || ''
    select.value = current
  }

  const refresh = async () => {
    try {
      const result = await bridge.listLocalModels()
      if (!result?.ok) {
        row.hidden = true
        return
      }
      render(result)
    } catch (error) {
      row.hidden = true
      console.error('local voice list failed', error)
    }
  }

  select.addEventListener('change', async () => {
    if (busy || typeof bridge.setLocalVoice !== 'function') return
    const chosen = select.value
    busy = true
    select.disabled = true
    say('Restarting the speech service with the new voice…')
    try {
      const result = await bridge.setLocalVoice(chosen)
      if (result?.ok) {
        current = result.voice || chosen
        select.value = current
        say('Voice updated.')
      } else {
        // Put the control back to what is actually loaded, so it never shows a
        // voice the service is not using.
        select.value = current
        say(result?.error || 'Could not change the voice.', true)
      }
    } catch (error) {
      select.value = current
      say(error?.message || 'Could not change the voice.', true)
    } finally {
      busy = false
      select.disabled = false
    }
  })

  void refresh()
  return refresh
}

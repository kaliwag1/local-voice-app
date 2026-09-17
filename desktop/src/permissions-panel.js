// Settings → Permissions: review, add and remove the Gateway's persistent
// "always allow" rules. Talks to the Gateway through the main process
// (`managePermissionRules`), which holds the access token.
export function installPermissionsPanel(bridge) {
  const panel = document.querySelector('#permissions-settings')
  const status = document.querySelector('#permissions-status')
  const list = document.querySelector('#permission-rules')
  const refreshButton = document.querySelector('#refresh-permissions')
  const form = document.querySelector('#permission-rule-form')
  const type = document.querySelector('#permission-rule-type')
  const pattern = document.querySelector('#permission-rule-pattern')
  const patternLabel = document.querySelector('#permission-rule-pattern-label')
  const accessLabel = document.querySelector('#permission-rule-access-label')
  const access = document.querySelector('#permission-rule-access')
  const note = document.querySelector('#permission-rule-note')
  const error = document.querySelector('#permission-rule-error')
  let busy = false

  const text = (tag, value, className) => {
    const element = document.createElement(tag)
    element.textContent = value
    if (className) element.className = className
    return element
  }
  const when = value => (value ? new Date(value).toLocaleString() : 'never')
  const describe = rule => (rule.type === 'command'
    ? `Command: ${rule.pattern}`
    : `Folder (${rule.access === 'write' ? 'read & write' : 'read only'}): ${rule.pattern}`)

  const render = rules => {
    if (!rules.length) {
      list.replaceChildren(text('p', 'No rules yet. Every agent action will ask. Use "Remember…" on a permission request in the chat, or add a rule above.', 'setting-hint'))
      return
    }
    const cards = rules.map(rule => {
      const card = document.createElement('section')
      card.className = 'settings-card permission-rule-card'
      const head = document.createElement('div')
      head.className = 'permission-rule-head'
      head.append(text('h2', describe(rule)))
      const remove = text('button', 'Remove', 'text-button')
      remove.type = 'button'
      remove.addEventListener('click', () => void mutate({ action: 'remove', id: rule.id }))
      head.append(remove)
      card.append(head)
      const details = document.createElement('dl')
      const rows = [
        ['Used', `${rule.useCount || 0} time${rule.useCount === 1 ? '' : 's'} · last ${when(rule.lastUsedAt)}`],
        ['Added', when(rule.createdAt)],
        ...(rule.note ? [['Note', rule.note]] : []),
      ]
      for (const [label, value] of rows) {
        const row = document.createElement('div')
        row.append(text('dt', label), text('dd', value))
        details.append(row)
      }
      card.append(details)
      return card
    })
    list.replaceChildren(...cards)
  }

  const refresh = async () => {
    if (busy || panel.hidden) return
    busy = true
    refreshButton.disabled = true
    status.textContent = 'Loading rules…'
    try {
      const result = await bridge.managePermissionRules({ action: 'list' })
      if (!result?.ok) throw new Error(result?.error || 'Gateway unavailable')
      render(result.rules || [])
      status.textContent = `${result.rules.length} rule${result.rules.length === 1 ? '' : 's'} · checked ${new Date().toLocaleTimeString()}`
    } catch (failure) {
      status.textContent = `Could not load rules: ${failure.message}`
    } finally {
      busy = false
      refreshButton.disabled = false
    }
  }

  const mutate = async request => {
    error.textContent = ''
    try {
      const result = await bridge.managePermissionRules(request)
      if (!result?.ok) throw new Error(result?.error || 'Gateway unavailable')
      if (request.action === 'add') { pattern.value = ''; note.value = '' }
      await refresh()
    } catch (failure) {
      error.textContent = failure.message
    }
  }

  const syncType = () => {
    const isPath = type.value === 'path'
    patternLabel.firstChild.textContent = isPath ? 'Folder path' : 'Command pattern'
    pattern.placeholder = isPath ? 'D:\\Footage' : 'ffprobe *'
    accessLabel.hidden = !isPath
  }
  type.addEventListener('change', syncType)
  syncType()
  form.addEventListener('submit', event => {
    event.preventDefault()
    void mutate({
      action: 'add',
      rule: {
        type: type.value,
        pattern: pattern.value,
        ...(type.value === 'path' ? { access: access.value } : {}),
        note: note.value,
      },
    })
  })
  refreshButton.addEventListener('click', refresh)
  return refresh
}

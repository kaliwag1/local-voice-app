// Windows draws the open list of a <select> itself - white, square, system font - and
// no CSS reaches it. This puts a styled button and list in front of each select while
// the native element stays the source of truth: its value, its change events, and
// every script that reads or sets it keep working untouched. Programmatic changes
// (select.value = x, new options, disabled, translation) are picked up and redrawn.

let nextId = 0

function textOf(node) {
  return (node?.textContent || '').trim()
}

// What the list shows, in order: group headings and options, as plain data.
export function selectEntries(select) {
  const entries = []
  const option = (element, group = null) => ({
    kind: 'option',
    value: element.value,
    label: textOf(element),
    selected: element.selected,
    disabled: element.disabled || Boolean(group?.disabled),
  })
  for (const child of select.children) {
    if (child.tagName === 'OPTGROUP') {
      entries.push({ kind: 'group', label: child.label || '' })
      for (const item of child.children) {
        if (item.tagName === 'OPTION' && !item.hidden) entries.push(option(item, child))
      }
    } else if (child.tagName === 'OPTION' && !child.hidden) {
      entries.push(option(child))
    }
  }
  return entries
}

// Type-ahead: the next enabled option after `from` whose label starts with `query`.
export function matchOption(options, query, from = -1) {
  const needle = query.toLocaleLowerCase()
  for (let step = 1; step <= options.length; step += 1) {
    const index = (from + step) % options.length
    const candidate = options[index]
    if (!candidate.disabled && candidate.label.toLocaleLowerCase().startsWith(needle)) return index
  }
  return -1
}

export function enhanceSelect(select) {
  if (!select || select.dataset.styled === 'true' || select.multiple) return null
  select.dataset.styled = 'true'
  const document = select.ownerDocument
  const window = document.defaultView
  const id = `styled-select-${nextId += 1}`

  const wrapper = document.createElement('span')
  wrapper.className = 'styled-select'
  select.before(wrapper)
  wrapper.append(select)
  select.tabIndex = -1
  select.setAttribute('aria-hidden', 'true')

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'styled-select-trigger'
  trigger.setAttribute('aria-haspopup', 'listbox')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-controls', `${id}-list`)
  const label = document.createElement('span')
  label.className = 'styled-select-label'
  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  chevron.setAttribute('viewBox', '0 0 12 12')
  chevron.setAttribute('aria-hidden', 'true')
  chevron.classList.add('styled-select-chevron')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M3 4.5 6 7.5l3-3')
  chevron.append(path)
  trigger.append(label, chevron)

  const list = document.createElement('div')
  list.className = 'styled-select-list'
  list.id = `${id}-list`
  list.setAttribute('role', 'listbox')
  list.hidden = true
  wrapper.append(trigger, list)

  // The <label for=...> of the select now names the button, and clicking it opens nothing
  // surprising: focus lands on the button like any other control.
  const describedBy = select.id ? document.querySelector(`label[for="${select.id}"]`) : null
  if (describedBy) {
    describedBy.id ||= `${id}-label`
    trigger.setAttribute('aria-labelledby', `${describedBy.id} ${id}-value`)
    list.setAttribute('aria-labelledby', describedBy.id)
    describedBy.addEventListener('click', event => {
      event.preventDefault()
      trigger.focus()
    })
  } else if (select.getAttribute('aria-label')) {
    list.setAttribute('aria-label', select.getAttribute('aria-label'))
  }
  label.id = `${id}-value`
  select.addEventListener('focus', () => trigger.focus())

  let optionButtons = []
  let typed = ''
  let typedTimer = null

  function renderTrigger() {
    const current = select.selectedOptions?.[0]
    label.textContent = textOf(current)
    trigger.disabled = select.disabled
    trigger.title = select.title || ''
  }

  function renderList() {
    optionButtons = []
    list.replaceChildren(...selectEntries(select).map(entry => {
      if (entry.kind === 'group') {
        const heading = document.createElement('div')
        heading.className = 'styled-select-group'
        heading.setAttribute('role', 'presentation')
        heading.textContent = entry.label
        return heading
      }
      const row = document.createElement('button')
      row.type = 'button'
      row.tabIndex = -1
      row.className = 'styled-select-option'
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(entry.selected))
      row.disabled = entry.disabled
      row.dataset.value = entry.value
      row.textContent = entry.label
      row.addEventListener('click', () => choose(entry.value))
      optionButtons.push({ element: row, ...entry })
      return row
    }))
  }

  function sync() {
    renderTrigger()
    if (list.hidden) return
    // Redrawing replaces the focused row; put focus back on the same value.
    const focused = optionButtons.find(option => option.element === document.activeElement)
    renderList()
    if (focused) focusOption(optionButtons.findIndex(option => option.value === focused.value))
  }

  function open() {
    if (select.disabled || !list.hidden) return
    renderList()
    list.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    wrapper.classList.add('open')
    // Open upwards when the window has no room below (Settings scrolls; the list must not
    // run off the bottom edge).
    list.classList.remove('up')
    const box = trigger.getBoundingClientRect()
    const below = window.innerHeight - box.bottom
    const needed = Math.min(list.scrollHeight, 300) + 12
    if (below < needed && box.top > below) list.classList.add('up')
    focusOption(optionButtons.findIndex(option => option.selected))
  }

  function close({ focus = false } = {}) {
    if (list.hidden) return
    list.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    wrapper.classList.remove('open')
    if (focus) trigger.focus()
  }

  function focusOption(index) {
    const target = optionButtons[index] || optionButtons.find(option => !option.disabled)
    if (!target) return
    target.element.focus({ preventScroll: true })
    target.element.scrollIntoView({ block: 'nearest' })
  }

  function move(step) {
    const enabled = optionButtons.filter(option => !option.disabled)
    if (!enabled.length) return
    const current = enabled.findIndex(option => option.element === document.activeElement)
    const next = current < 0
      ? (step > 0 ? 0 : enabled.length - 1)
      : Math.min(enabled.length - 1, Math.max(0, current + step))
    focusOption(optionButtons.indexOf(enabled[next]))
  }

  function choose(value) {
    close({ focus: true })
    if (select.value === value) return
    select.value = value
    select.dispatchEvent(new window.Event('input', { bubbles: true }))
    select.dispatchEvent(new window.Event('change', { bubbles: true }))
  }

  function typeAhead(key) {
    clearTimeout(typedTimer)
    typed += key
    typedTimer = setTimeout(() => { typed = '' }, 700)
    const current = optionButtons.findIndex(option => option.element === document.activeElement)
    const index = matchOption(optionButtons, typed, typed.length > 1 ? current - 1 : current)
    if (index >= 0) focusOption(index)
  }

  trigger.addEventListener('click', () => (list.hidden ? open() : close()))
  trigger.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      open()
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      open()
      typeAhead(event.key)
    }
  })
  list.addEventListener('keydown', event => {
    const active = optionButtons.find(option => option.element === document.activeElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close({ focus: true })
    } else if ((event.key === 'Enter' || event.key === ' ') && active) {
      // Explicit, so Enter can never reach the Settings form or depend on button defaults.
      event.preventDefault()
      if (!active.disabled) choose(active.value)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const enabled = optionButtons.filter(option => !option.disabled)
      const edge = event.key === 'Home' ? enabled[0] : enabled.at(-1)
      if (edge) focusOption(optionButtons.indexOf(edge))
    } else if (event.key === 'Tab') {
      close()
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      typeAhead(event.key)
    }
  })
  document.addEventListener('pointerdown', event => {
    if (!wrapper.contains(event.target)) close()
  })
  wrapper.addEventListener('focusout', event => {
    if (event.relatedTarget && !wrapper.contains(event.relatedTarget)) close()
  })
  window.addEventListener('blur', () => close())

  // Scripts set select.value / selectedIndex directly; neither fires an event, so the
  // instance forwards them to the native setter and redraws.
  const prototype = window.HTMLSelectElement.prototype
  for (const key of ['value', 'selectedIndex']) {
    const native = Object.getOwnPropertyDescriptor(prototype, key)
    Object.defineProperty(select, key, {
      configurable: true,
      get() { return native.get.call(this) },
      set(value) {
        native.set.call(this, value)
        sync()
      },
    })
  }
  new window.MutationObserver(sync).observe(select, {
    attributes: true,
    attributeFilter: ['disabled', 'title'],
    childList: true,
    subtree: true,
    characterData: true,
  })
  select.addEventListener('change', renderTrigger)

  renderTrigger()
  return { wrapper, trigger, list, open, close, sync }
}

export function enhanceSelects(root) {
  return [...root.querySelectorAll('select')].map(enhanceSelect).filter(Boolean)
}

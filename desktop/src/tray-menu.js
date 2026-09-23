// Draws the tray menu the main process sends and reports the chosen item.
const ICONS = {
  orb: ['M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16Z', 'M9 10.5a3 3 0 0 1 3-3'],
  reset: ['M4.5 12a7.5 7.5 0 1 0 2.2-5.3', 'M4.5 4.5v3.5H8'],
  settings: ['M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6Z', 'M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6'],
  quit: ['M12 4v7', 'M7.2 6.8a7 7 0 1 0 9.6 0'],
}

const list = document.getElementById('items')
const svg = 'http://www.w3.org/2000/svg'

function icon(name) {
  const element = document.createElementNS(svg, 'svg')
  element.setAttribute('viewBox', '0 0 24 24')
  element.setAttribute('aria-hidden', 'true')
  for (const d of ICONS[name] || []) {
    const path = document.createElementNS(svg, 'path')
    path.setAttribute('d', d)
    element.append(path)
  }
  return element
}

function render(items = []) {
  list.replaceChildren(...items.map(item => {
    if (item.type === 'separator') {
      const line = document.createElement('div')
      line.className = 'menu-separator'
      line.setAttribute('role', 'separator')
      return line
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `menu-item${item.danger ? ' danger' : ''}`
    button.setAttribute('role', 'menuitem')
    button.append(icon(item.icon))
    const label = document.createElement('span')
    label.textContent = item.label
    button.append(label)
    button.addEventListener('click', () => window.trayMenu.choose(item.id))
    return button
  }))
}

function buttons() {
  return [...list.querySelectorAll('.menu-item')]
}

document.addEventListener('keydown', event => {
  const all = buttons()
  const current = all.indexOf(document.activeElement)
  if (event.key === 'Escape') {
    window.trayMenu.close()
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next = current < 0 ? (step > 0 ? 0 : all.length - 1) : (current + step + all.length) % all.length
    all[next]?.focus()
  } else if ((event.key === 'Enter' || event.key === ' ') && current >= 0) {
    event.preventDefault()
    all[current].click()
  }
})

// Hovering moves keyboard focus too, so arrows continue from where the pointer is.
list.addEventListener('pointermove', event => {
  const button = event.target.closest?.('.menu-item')
  if (button && document.activeElement !== button) button.focus({ preventScroll: true })
})

window.trayMenu?.onItems(render)

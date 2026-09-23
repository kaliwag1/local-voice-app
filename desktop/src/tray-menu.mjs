// The tray icon's right-click menu, drawn by the app instead of Windows. A native
// tray menu is always the system's white/grey one; this is a small frameless window
// in the app's own style that behaves like a menu: it opens at the pointer, closes
// when it loses focus or on Escape, and runs the chosen item's action.

export const TRAY_MENU_WIDTH = 232
// Transparent margin around the card, so its shadow has somewhere to fall.
export const TRAY_MENU_MARGIN = 10
const HEADER_HEIGHT = 48 // 44 plus its 4px bottom margin
const ITEM_HEIGHT = 34
const SEPARATOR_HEIGHT = 9
const CARD_PADDING = 6

export function trayMenuSize(items = []) {
  const content = items.reduce(
    (total, item) => total + (item.type === 'separator' ? SEPARATOR_HEIGHT : ITEM_HEIGHT),
    0,
  )
  return {
    width: TRAY_MENU_WIDTH + TRAY_MENU_MARGIN * 2,
    height: HEADER_HEIGHT + content + CARD_PADDING * 2 + 2 + TRAY_MENU_MARGIN * 2,
  }
}

// Opens up and to the right of the pointer, as the Windows tray menu does with the
// taskbar at the bottom; flips down or left where that would leave the work area,
// and is then kept inside it. The card's corner, not the window's, meets the pointer.
export function trayMenuPosition({ cursor, workArea, size }) {
  const margin = TRAY_MENU_MARGIN
  let x = cursor.x - margin
  if (x + size.width - margin > workArea.x + workArea.width) x = cursor.x - size.width + margin
  let y = cursor.y - size.height + margin
  if (y + margin < workArea.y) y = cursor.y - margin
  x = Math.min(Math.max(x, workArea.x - margin), workArea.x + workArea.width - size.width + margin)
  y = Math.min(Math.max(y, workArea.y - margin), workArea.y + workArea.height - size.height + margin)
  return { x: Math.round(x), y: Math.round(y) }
}

// Only what the page needs to draw; the actions stay in the main process.
export function trayMenuView(items = []) {
  return items.map(item => (item.type === 'separator'
    ? { type: 'separator' }
    : { id: String(item.id), label: String(item.label), icon: item.icon || '', danger: Boolean(item.danger) }))
}

export function createTrayMenu({ BrowserWindow, screen, ipcMain, page, preload, logger }) {
  let window = null
  let items = []

  function build() {
    window = new BrowserWindow({
      width: TRAY_MENU_WIDTH + TRAY_MENU_MARGIN * 2,
      height: 200,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload,
      },
    })
    window.setAlwaysOnTop(true, 'pop-up-menu')
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.on('blur', hide)
    window.on('closed', () => { window = null })
    return window.loadFile(page)
  }

  function hide() {
    if (window && !window.isDestroyed() && window.isVisible()) window.hide()
  }

  async function open() {
    try {
      if (!window || window.isDestroyed()) await build()
      const size = trayMenuSize(items)
      const cursor = screen.getCursorScreenPoint()
      const { workArea } = screen.getDisplayNearestPoint(cursor)
      window.webContents.send('qwen-audio-agent:tray-menu-items', trayMenuView(items))
      window.setBounds({ ...trayMenuPosition({ cursor, workArea, size }), ...size })
      window.show()
      window.focus()
    } catch (error) {
      logger?.warn?.('tray_menu.failed', { error: String(error?.message || error) })
    }
  }

  const fromMenu = event => Boolean(window && !window.isDestroyed() && event.sender === window.webContents)
  ipcMain.on('qwen-audio-agent:tray-menu-choose', (event, id) => {
    if (!fromMenu(event)) return
    hide()
    const item = items.find(entry => entry.type !== 'separator' && entry.id === id)
    // After the menu is gone, so a window the action opens takes focus from nothing.
    if (item) setTimeout(() => item.click(), 0)
  })
  ipcMain.on('qwen-audio-agent:tray-menu-close', event => {
    if (fromMenu(event)) hide()
  })

  return {
    setItems(next) { items = next },
    open,
    hide,
    destroy() {
      if (window && !window.isDestroyed()) window.destroy()
      window = null
    },
  }
}

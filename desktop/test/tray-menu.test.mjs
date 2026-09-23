import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TRAY_MENU_MARGIN,
  TRAY_MENU_WIDTH,
  trayMenuPosition,
  trayMenuSize,
  trayMenuView,
} from '../src/tray-menu.mjs'

const items = [
  { id: 'show', label: 'Show floating orb', icon: 'orb', click() {} },
  { id: 'reset', label: 'Reset floating orb', icon: 'reset', click() {} },
  { id: 'settings', label: 'Settings…', icon: 'settings', click() {} },
  { type: 'separator' },
  { id: 'quit', label: 'Quit', icon: 'quit', danger: true, click() {} },
]
// 1920x1080 with a 48px taskbar at the bottom.
const workArea = { x: 0, y: 0, width: 1920, height: 1032 }
const size = trayMenuSize(items)
const card = position => ({
  left: position.x + TRAY_MENU_MARGIN,
  top: position.y + TRAY_MENU_MARGIN,
  right: position.x + size.width - TRAY_MENU_MARGIN,
  bottom: position.y + size.height - TRAY_MENU_MARGIN,
})

test('the window fits the card, its items and the shadow margin', () => {
  assert.equal(size.width, TRAY_MENU_WIDTH + 2 * TRAY_MENU_MARGIN)
  assert.equal(size.height, 48 + 4 * 34 + 9 + 12 + 2 + 2 * TRAY_MENU_MARGIN)
})

test('opens above a bottom taskbar with the card corner at the pointer', () => {
  const box = card(trayMenuPosition({ cursor: { x: 1500, y: 1060 }, workArea, size }))
  assert.equal(box.left, 1500)
  assert.equal(box.bottom, workArea.height)
})

test('flips left at the right edge and stays inside the work area', () => {
  const box = card(trayMenuPosition({ cursor: { x: 1910, y: 1060 }, workArea, size }))
  assert.equal(box.right, 1910)
  assert.ok(box.left >= 0 && box.bottom <= workArea.height)
})

test('opens downwards under a top taskbar', () => {
  const top = { x: 0, y: 48, width: 1920, height: 1032 }
  const box = card(trayMenuPosition({ cursor: { x: 1500, y: 20 }, workArea: top, size }))
  assert.equal(box.top, top.y)
})

test('the page gets labels and icons, never the actions', () => {
  const view = trayMenuView(items)
  assert.deepEqual(view[0], { id: 'show', label: 'Show floating orb', icon: 'orb', danger: false })
  assert.deepEqual(view[3], { type: 'separator' })
  assert.equal(view[4].danger, true)
  assert.ok(view.every(item => !('click' in item)))
})

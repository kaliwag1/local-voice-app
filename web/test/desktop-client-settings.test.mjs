import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyDesktopClientSettings,
  initialDesktopClientSettings,
} from '../src/desktop/desktop-client-settings.js'

test('desktop client settings initialize from the desktop URL', () => {
  assert.deepEqual(initialDesktopClientSettings(
    '?orbSkin=firefly&autoHideSeconds=300&wakeWordEnabled=true&micMode=push-to-talk&pushToTalkKey=F8&deafenShortcut=F7&lang=en',
  ), {
    orbSkinId: 'firefly',
    autoHideSeconds: 300,
    wakeWordEnabled: true,
    micMode: 'push-to-talk',
    pushToTalkKey: 'F8',
    pushToTalkGlobal: false,
    deafenShortcut: 'F7',
    language: 'en',
  })
})

test('desktop client settings hot-apply without replacing unrelated state', () => {
  const current = {
    orbSkinId: 'fluid',
    autoHideSeconds: 60,
    wakeWordEnabled: false,
    micMode: 'always',
    pushToTalkKey: 'F9',
    pushToTalkGlobal: false,
    deafenShortcut: 'CommandOrControl+Alt+D',
    language: 'zh-CN',
  }

  assert.deepEqual(applyDesktopClientSettings(current, {
    orbSkin: 'firefly',
    autoHideSeconds: 120,
    language: 'en',
  }), {
    orbSkinId: 'firefly',
    autoHideSeconds: 120,
    wakeWordEnabled: false,
    micMode: 'always',
    pushToTalkKey: 'F9',
    pushToTalkGlobal: false,
    deafenShortcut: 'CommandOrControl+Alt+D',
    language: 'en',
  })
})

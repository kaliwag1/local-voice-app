import { resolveOrbSkinId } from '../../../shared/orb-skin-catalog.mjs'
import {
  desktopAutoHideSeconds,
  desktopWakeWordEnabled,
} from './desktop-hide.js'

export function initialDesktopClientSettings(search = '') {
  const params = new URLSearchParams(search)
  return {
    orbSkinId: resolveOrbSkinId({
      orbSkin: params.get('orbSkin'),
      orbStyle: params.get('orbStyle'),
    }),
    autoHideSeconds: desktopAutoHideSeconds(search),
    wakeWordEnabled: desktopWakeWordEnabled(search),
    micMode: params.get('micMode') === 'push-to-talk' ? 'push-to-talk' : 'always',
    pushToTalkKey: params.get('pushToTalkKey') ?? 'F9',
    pushToTalkGlobal: params.get('pushToTalkGlobal') === 'true',
    deafenShortcut: params.get('deafenShortcut') ?? 'CommandOrControl+Alt+D',
    appMode: params.get('appMode') === 'text' ? 'text' : 'voice',
    language: params.get('lang') || '',
  }
}

export function applyDesktopClientSettings(current, update = {}) {
  return {
    orbSkinId: update.orbSkin
      ? resolveOrbSkinId({ orbSkin: update.orbSkin })
      : current.orbSkinId,
    autoHideSeconds: Number.isFinite(update.autoHideSeconds)
      ? update.autoHideSeconds
      : current.autoHideSeconds,
    wakeWordEnabled: typeof update.wakeWordEnabled === 'boolean'
      ? update.wakeWordEnabled
      : current.wakeWordEnabled,
    micMode: update.micMode === 'push-to-talk' || update.micMode === 'always'
      ? update.micMode
      : current.micMode,
    pushToTalkKey: typeof update.pushToTalkKey === 'string'
      ? update.pushToTalkKey
      : current.pushToTalkKey,
    pushToTalkGlobal: typeof update.pushToTalkGlobal === 'boolean'
      ? update.pushToTalkGlobal
      : current.pushToTalkGlobal,
    deafenShortcut: typeof update.deafenShortcut === 'string'
      ? update.deafenShortcut
      : current.deafenShortcut,
    appMode: update.appMode === 'text' || update.appMode === 'voice'
      ? update.appMode
      : current.appMode,
    language: update.language || current.language,
  }
}

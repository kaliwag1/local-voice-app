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
    pushToTalkKey: params.get('pushToTalkKey') ?? 'F9',
    pushToTalkGlobal: params.get('pushToTalkGlobal') === 'true',
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
    pushToTalkKey: typeof update.pushToTalkKey === 'string'
      ? update.pushToTalkKey
      : current.pushToTalkKey,
    pushToTalkGlobal: typeof update.pushToTalkGlobal === 'boolean'
      ? update.pushToTalkGlobal
      : current.pushToTalkGlobal,
    language: update.language || current.language,
  }
}

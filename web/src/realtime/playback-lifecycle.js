/**
 * Confirm that a tracked Web Audio response has reached playback.
 *
 * The ordinary path calls this when AudioContext.currentTime reaches the
 * scheduled start. The source-ended path calls it as a fallback because an
 * Electron background renderer may throttle timers while the audio thread
 * continues rendering. A stopped/cleared source is no longer tracked and
 * therefore cannot be acknowledged by a late onended callback.
 */
export function confirmTrackedPlaybackStart(
  playback,
  responseId,
  onStarted,
  clearTimer = clearTimeout,
) {
  if (
    !responseId
    || !playback?.sourceCounts?.has(responseId)
    || playback.startedResponses.has(responseId)
  ) return false

  const timer = playback.startTimers.get(responseId)
  if (timer !== undefined) clearTimer(timer)
  playback.startTimers.delete(responseId)
  playback.startedResponses.add(responseId)
  onStarted?.(responseId)
  return true
}

/**
 * Work out which receipts silence in-flight playback without cancelling it.
 *
 * Deafening must not send playback.cancelled: the Gateway suppresses a
 * cancelled response and drops its pending transcripts, so the rest of the
 * reply's text would vanish along with the sound. Instead every tracked
 * response is acknowledged as started (which releases its transcripts) and
 * then either ended now, when its audio is already complete, or consumed
 * silently until audio.done arrives.
 */
export function planPlaybackDeafen(playback) {
  const failed = playback?.failedResponses || new Set()
  const ids = new Set([
    ...(playback?.startTimers?.keys?.() || []),
    ...(playback?.endTimers?.keys?.() || []),
    ...(playback?.startedResponses || []),
    ...(playback?.sourceCounts?.keys?.() || []),
    ...(playback?.doneResponses || []),
    ...(playback?.queue?.responseIds?.() || []),
  ])
  const plan = { started: [], ended: [], muted: [] }
  for (const id of ids) {
    if (!id || failed.has(id)) continue
    if (!playback.startedResponses?.has(id)) plan.started.push(id)
    if (playback.doneResponses?.has(id)) plan.ended.push(id)
    else plan.muted.push(id)
  }
  return plan
}

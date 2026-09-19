// The live side of a turn: how long it has been going, how much has streamed,
// and - once the runtime reports usage - the exact tokens and the rate they
// came out at.
//
// Two clocks, because they answer different questions. `elapsedMs` is the whole
// turn, which is what "how long did that take" means. The rate is measured from
// the first streamed delta instead, so waiting for the prompt to be processed
// does not get averaged into a generation speed.
//
// Characters and deltas are counted exactly as they arrive. Tokens are never
// derived from them: a token count here is always one the runtime reported.
const ACTIVE = new Set(['working', 'tools', 'waiting'])

export function isActive(activity) {
  return Boolean(activity && ACTIVE.has(activity.status) && activity.live)
}

export function streamStats(activity, now = Date.now()) {
  if (!activity) return null
  const stream = activity.stream || {}
  const live = isActive(activity)
  const started = Number(activity.createdAt) || null
  // A settled turn must never be measured against the clock, or its duration
  // grows for as long as the chat stays open. Turns recorded before the stream
  // counters existed carry no endedAt, so fall back to the last time the turn
  // was updated - which, for a finished turn, is when it finished.
  const ended = Number(stream.endedAt) || (live ? null : Number(activity.updatedAt)) || null
  const until = live ? now : ended ?? now
  const elapsedMs = started ? Math.max(until - started, 0) : null
  const output = activity.usage?.latest?.output ?? activity.usage?.output ?? null
  const generatingMs = stream.firstDeltaAt ? Math.max(until - Number(stream.firstDeltaAt), 0) : null
  const tokensPerSecond = output !== null && generatingMs > 250
    ? output / (generatingMs / 1000)
    : null
  return {
    live,
    elapsedMs,
    characters: Number(stream.characters) || 0,
    deltas: Number(stream.deltas) || 0,
    tokens: output,
    tokensPerSecond,
  }
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return null
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  return `${minutes}m ${Math.round((ms % 60000) / 1000)}s`
}

export function formatRate(tokensPerSecond) {
  return Number.isFinite(tokensPerSecond) ? `${tokensPerSecond.toFixed(1)} tok/s` : null
}

// One line under a turn. While it runs this is the only sign of progress, so it
// shows what is genuinely known: the clock and what has streamed. The token
// count joins when the runtime reports it, which for most runtimes is the end.
export function streamLabel(activity, now = Date.now()) {
  const stats = streamStats(activity, now)
  if (!stats || !stats.elapsedMs) return null
  const parts = [formatDuration(stats.elapsedMs)]
  if (stats.tokens !== null) {
    parts.push(`${stats.tokens.toLocaleString()} tokens`)
    const rate = formatRate(stats.tokensPerSecond)
    if (rate) parts.push(rate)
  } else if (stats.characters > 0) {
    parts.push(`${stats.characters.toLocaleString()} characters`)
  }
  return parts.join(' · ')
}

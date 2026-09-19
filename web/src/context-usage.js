// How much of the local model's context window the conversation is occupying.
//
// The measurement is one request's prompt plus the answer it produced: a prompt
// already contains the whole history sent with it, so the newest response is the
// closest thing to "what the model is currently holding". Summed turn totals are
// a different number - they count the same history once per response - and must
// not be used here.
//
// It is a measurement, not a live estimate. It moves only when the runtime
// reports usage, so between answers it is a floor: whatever you have typed or
// said since is not in it yet. Runtimes that report no usage give no reading at
// all, and the meter says so rather than guessing.
const positive = value => Number.isFinite(value) && value > 0 ? value : null

export function latestMeasurement(activities) {
  const items = Array.isArray(activities) ? activities : Object.values(activities || {})
  let newest = null
  for (const activity of items) {
    const latest = activity?.usage?.latest
    if (!latest) continue
    const used = positive(latest.total) ?? (positive(latest.input) !== null && latest.output !== null
      ? latest.input + latest.output
      : null)
    if (used === null) continue
    if (!newest || Number(activity.updatedAt) > Number(newest.updatedAt)) {
      newest = { used, input: latest.input ?? null, output: latest.output ?? null, updatedAt: Number(activity.updatedAt) || 0 }
    }
  }
  return newest
}

export function contextUsage(activities, contextLength) {
  const limit = positive(Number(contextLength))
  const measured = latestMeasurement(activities)
  if (!measured) return { available: false, limit }
  // A window can be reduced while a longer conversation is loaded, so clamp the
  // ring rather than drawing past full, and keep the real numbers in the detail.
  const ratio = limit ? Math.min(measured.used / limit, 1) : null
  return {
    available: true,
    limit,
    used: measured.used,
    input: measured.input,
    output: measured.output,
    remaining: limit ? Math.max(limit - measured.used, 0) : null,
    ratio,
    percent: ratio === null ? null : Math.round(ratio * 100),
    over: Boolean(limit && measured.used > limit),
    updatedAt: measured.updatedAt,
  }
}

export function usageTone(usage) {
  if (!usage?.available || usage.ratio === null) return 'unknown'
  if (usage.ratio >= 0.9) return 'critical'
  if (usage.ratio >= 0.7) return 'high'
  return 'normal'
}

export function formatContextLength(tokens) {
  const value = Number(tokens)
  if (!Number.isFinite(value) || value <= 0) return ''
  return value % 1024 === 0 ? `${value / 1024}k tokens` : `${value} tokens`
}

export function formatTokens(value) {
  return Number.isFinite(value) ? value.toLocaleString() : 'unavailable'
}

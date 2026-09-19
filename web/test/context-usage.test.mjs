import assert from 'node:assert/strict'
import test from 'node:test'
import { contextUsage, formatTokens, latestMeasurement, usageTone } from '../src/context-usage.js'

const activity = (turnId, updatedAt, latest, extra = {}) => ({
  turnId,
  updatedAt,
  usage: latest === null ? null : { input: 1, output: 1, total: 2, reportedResponses: 1, complete: true, latest, ...extra },
})

test('measures the newest response that reported usage', () => {
  const usage = contextUsage([
    activity('older', 100, { input: 2000, output: 100, total: 2100 }),
    activity('newest', 300, { input: 8000, output: 400, total: 8400 }),
    activity('middle', 200, { input: 5000, output: 200, total: 5200 }),
  ], 32768)
  assert.equal(usage.used, 8400)
  assert.equal(usage.remaining, 32768 - 8400)
  assert.equal(usage.percent, 26)
  assert.equal(usage.over, false)
})

// Each response's prompt already contains the history sent with it, so adding
// prompts across a turn would report several times the real occupancy.
test('reads one request, never the turn total', () => {
  const summed = {
    turnId: 'multi',
    updatedAt: 10,
    usage: { input: 24000, output: 900, total: 24900, reportedResponses: 3, complete: true,
      latest: { input: 9000, output: 300, total: 9300 } },
  }
  assert.equal(contextUsage([summed], 32768).used, 9300)
})

test('falls back to prompt plus completion when no total is reported', () => {
  assert.equal(latestMeasurement([activity('a', 1, { input: 700, output: 40, total: null })]).used, 740)
})

test('reports no reading when the runtime reported no usage', () => {
  const usage = contextUsage([activity('a', 1, null), { turnId: 'b', updatedAt: 2 }], 32768)
  assert.equal(usage.available, false)
  assert.equal(usage.limit, 32768)
  assert.equal(usageTone(usage), 'unknown')
  assert.equal(formatTokens(usage.used), 'unavailable')
})

test('an all-zero usage report is not a measurement', () => {
  assert.equal(latestMeasurement([activity('a', 1, { input: 0, output: 0, total: 0 })]), null)
})

test('keeps a reading when the context window is unknown', () => {
  const usage = contextUsage([activity('a', 1, { input: 900, output: 100, total: 1000 })], null)
  assert.equal(usage.available, true)
  assert.equal(usage.used, 1000)
  assert.equal(usage.limit, null)
  assert.equal(usage.ratio, null)
  assert.equal(usage.percent, null)
  assert.equal(usage.remaining, null)
})

// Switching to a smaller window with a long conversation loaded would otherwise
// draw past a full ring.
test('clamps the ring but keeps the real numbers when over the window', () => {
  const usage = contextUsage([activity('a', 1, { input: 40000, output: 500, total: 40500 })], 32768)
  assert.equal(usage.ratio, 1)
  assert.equal(usage.percent, 100)
  assert.equal(usage.used, 40500)
  assert.equal(usage.remaining, 0)
  assert.equal(usage.over, true)
})

test('tone escalates as the window fills', () => {
  const at = used => usageTone(contextUsage([activity('a', 1, { input: used, output: 0, total: used })], 1000))
  assert.equal(at(500), 'normal')
  assert.equal(at(700), 'high')
  assert.equal(at(950), 'critical')
})

test('accepts the keyed activity map the app holds', () => {
  const usage = contextUsage({
    one: activity('one', 5, { input: 100, output: 10, total: 110 }),
    two: activity('two', 9, { input: 300, output: 20, total: 320 }),
  }, 16384)
  assert.equal(usage.used, 320)
})

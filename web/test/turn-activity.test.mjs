import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activityLabel, groupedTools, mergeTurnActivities } from '../src/turn-activity.js'

test('history cannot overwrite newer live activity', () => {
  const live = mergeTurnActivities({}, [{ turnId: 't', version: 4, updatedAt: 2000, status: 'completed' }], true)
  const merged = mergeTurnActivities(live, [{ turnId: 't', version: 2, updatedAt: 1000, status: 'working' }])
  assert.equal(merged.t.status, 'completed')
  assert.equal(merged.t.live, true)
})
test('tools group repeated searches while preserving running/failure counts', () => {
  assert.deepEqual(groupedTools([{ name: 'web_search', status: 'completed' }, { name: 'web_search', status: 'running' }, { name: 'web_search', status: 'failed' }]), [{ name: 'web_search', count: 3, running: 1, failed: 1 }])
  assert.match(activityLabel({ status: 'tools', tools: [{}, {}, {}], live: true }), /3 tool calls/)
  assert.match(activityLabel({ status: 'working', responseCount: 2, live: false }), /Last recorded/)
  assert.match(activityLabel({ status: 'no-answer' }), /without an answer/)
})

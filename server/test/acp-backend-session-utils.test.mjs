import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activityFromUpdate,
  applySessionMetadataUpdate,
} from '../src/backend/adapters/acp/backend-session-utils.mjs'

test('projects an ACP plan into stable task progress', () => {
  assert.deepEqual(activityFromUpdate({
    sessionUpdate: 'plan',
    entries: [
      { content: 'Inspect the project', status: 'completed' },
      { content: 'Implement the change', status: 'in_progress' },
      { content: 'Run tests', status: 'pending' },
    ],
  }), {
    id: 'acp-plan',
    kind: 'plan',
    status: 'running',
    detail: 'Implement the change',
    completed: 1,
    total: 3,
  })
})

test('keeps the ACP human-readable tool title separate from raw details', () => {
  assert.deepEqual(activityFromUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'tool-1',
    name: 'shell',
    title: 'Run project tests',
    status: 'pending',
    rawInput: {
      command: 'npm test',
      description: '验证项目测试',
    },
  }), {
    id: 'tool-1',
    kind: 'tool',
    tool: 'shell',
    label: '验证项目测试',
    status: 'pending',
    category: 'run',
    detail: '验证项目测试',
  })
})

test('projects ACP thought, mode, and session metadata without exposing thought text', () => {
  assert.deepEqual(activityFromUpdate({
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'private chain of thought' },
  }), {
    id: 'acp-thinking',
    kind: 'thinking',
    status: 'running',
  })
  assert.deepEqual(activityFromUpdate({
    sessionUpdate: 'current_mode_update',
    currentModeId: 'plan',
  }), {
    id: 'acp-current-mode',
    kind: 'mode',
    status: 'updated',
    mode: 'plan',
  })
  assert.deepEqual(activityFromUpdate({
    sessionUpdate: 'session_info_update',
    title: 'Build the demo',
    updatedAt: '2026-08-26T02:00:00Z',
  }), {
    id: 'acp-session-info',
    kind: 'session',
    status: 'updated',
    title: 'Build the demo',
    updatedAt: '2026-08-26T02:00:00Z',
  })
})

test('updates remembered ACP Session metadata in place', () => {
  const session = { sessionId: 'session-one', title: 'Old' }
  assert.equal(applySessionMetadataUpdate(session, {
    sessionUpdate: 'session_info_update',
    title: 'New title',
    updatedAt: '2026-08-26T02:00:00Z',
  }), true)
  assert.equal(applySessionMetadataUpdate(session, {
    sessionUpdate: 'current_mode_update',
    currentModeId: 'plan',
  }), true)
  assert.deepEqual(session, {
    sessionId: 'session-one',
    title: 'New title',
    updatedAt: '2026-08-26T02:00:00Z',
    currentModeId: 'plan',
  })
})

test('tool activity carries the file paths it touched and whether it wrote', async () => {
  const { pathsFromToolCall } = await import('../src/backend/adapters/acp/backend-session-utils.mjs')
  const activity = activityFromUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'tool-2',
    name: 'bash',
    title: 'Create folder',
    status: 'completed',
    rawInput: { command: 'New-Item -ItemType Directory -Path "C:\\Users\\JakeW\\OneDrive\\Desktop\\Hello World"' },
  })
  assert.deepEqual(activity.paths, ['C:\\Users\\JakeW\\OneDrive\\Desktop\\Hello World'])
  assert.equal(activity.writes, true)

  const read = activityFromUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'tool-3',
    name: 'read',
    status: 'completed',
    rawInput: { path: 'C:\\Users\\JakeW\\notes.txt' },
    locations: [{ path: 'C:\\Users\\JakeW\\notes.txt', line: 1 }],
  })
  assert.deepEqual(read.paths, ['C:\\Users\\JakeW\\notes.txt'])
  assert.equal(read.writes, false)

  assert.deepEqual(pathsFromToolCall({ rawInput: { command: 'ls /home/jake/videos && cat /etc/hosts' } }),
    ['/home/jake/videos', '/etc/hosts'])
  assert.equal(pathsFromToolCall({ rawInput: { command: 'npm test' } }).length, 0)
  // Plain commands without paths do not gain the keys at all.
  assert.equal('paths' in activityFromUpdate({
    sessionUpdate: 'tool_call', toolCallId: 't4', name: 'bash', rawInput: { command: 'git status' },
  }), false)
})

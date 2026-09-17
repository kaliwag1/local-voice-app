import assert from 'node:assert/strict'
import test from 'node:test'
import { runningApps, screenshotImage, callScreenTool } from '../src/screen-capture.mjs'

test('parses running Windows app choices and keeps window titles intact', () => {
  assert.deepEqual(runningApps({ content: [{ type: 'text', text:
    'chrome -- chrome [running, pid=1, window=Example - Google Chrome]\nSystemSettings -- SystemSettings [running, pid=2, window=Settings]' }] }), [
    { app: 'chrome', label: 'chrome — Example - Google Chrome' },
    { app: 'SystemSettings', label: 'SystemSettings — Settings' },
  ])
  assert.deepEqual(runningApps({ content: [{ type: 'text', text: 'No running top-level apps are visible to this Windows runtime.' }] }), [])
})

test('capture requires an image, not just an accessibility tree or an error', () => {
  assert.throws(() => screenshotImage({ content: [{ type: 'text', text: 'Window tree' }] }), /No screenshot/)
  assert.throws(() => screenshotImage({ isError: true }), /could not be captured/)
  assert.equal(screenshotImage({ content: [{ type: 'image', mimeType: 'image/png', data: 'YWJj' }] }), 'data:image/png;base64,YWJj')
})

test('screen capture bridge cannot call interaction tools', async () => {
  await assert.rejects(callScreenTool('click', {}), /Unsupported screen tool/)
})

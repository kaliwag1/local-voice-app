import assert from 'node:assert/strict'
import test from 'node:test'
import { createGracefulShutdown, withDeadline } from '../src/graceful-shutdown.mjs'

function deferred() {
  let resolve
  const promise = new Promise(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

test('a slow shutdown step gives up at its deadline instead of holding the quit', async () => {
  const stuck = deferred()
  let cleared = 0
  const fired = []
  const result = await withDeadline(stuck.promise, 8000, { ok: false, error: 'timed out' }, {
    set: (run, ms) => { fired.push(ms); run(); return 'timer' },
    clear: handle => { assert.equal(handle, 'timer'); cleared += 1 },
  })
  assert.deepEqual(result, { ok: false, error: 'timed out' })
  assert.deepEqual(fired, [8000])
  assert.equal(cleared, 1)
})

test('a step that finishes in time keeps its own result and cancels the timer', async () => {
  let cleared = 0
  const result = await withDeadline(Promise.resolve({ ok: true }), 8000, { ok: false }, {
    set: () => 'timer',
    clear: () => { cleared += 1 },
  })
  assert.deepEqual(result, { ok: true })
  assert.equal(cleared, 1)
})

test('waits for desktop cleanup before allowing the app to quit', async () => {
  const cleanup = deferred()
  let quitCalls = 0
  let prevented = 0
  const shutdown = createGracefulShutdown({
    app: { quit: () => { quitCalls += 1 } },
    cleanup: () => cleanup.promise,
  })

  shutdown({ preventDefault: () => { prevented += 1 } })
  shutdown({ preventDefault: () => { prevented += 1 } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(prevented, 2)
  assert.equal(quitCalls, 0)

  cleanup.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(quitCalls, 1)

  // Electron emits before-quit again for the final app.quit().
  shutdown({ preventDefault: () => { prevented += 1 } })
  assert.equal(prevented, 2)
})

test('still quits when cleanup fails and reports the failure', async () => {
  const failures = []
  let quitCalls = 0
  const shutdown = createGracefulShutdown({
    app: { quit: () => { quitCalls += 1 } },
    cleanup: async () => { throw new Error('cleanup failed') },
    onError: error => failures.push(error.message),
  })

  shutdown({ preventDefault() {} })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(failures, ['cleanup failed'])
  assert.equal(quitCalls, 1)
})

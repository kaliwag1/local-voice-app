import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  acquireGatewayLease,
  findRunningGateway,
  gatewayLockPath,
  GATEWAY_LOCK_SCHEMA,
  readGatewayLease,
} from '../shared/gateway/lease.mjs'

function missingProcess() {
  throw Object.assign(new Error('missing'), { code: 'ESRCH' })
}

test('allows only one live Gateway per configuration directory', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qwaudio-gateway-lock-'))
  const first = await acquireGatewayLease(directory, {
    pid: 101,
    instanceId: 'first',
    killImpl: pid => {
      if (pid === 101) return
      missingProcess()
    },
  })
  await assert.rejects(
    () => acquireGatewayLease(directory, {
      pid: 202,
      instanceId: 'second',
      killImpl: pid => {
        if (pid === 101) return
        missingProcess()
      },
    }),
    error => (
      error.code === 'QWAUDIO_GATEWAY_ALREADY_RUNNING'
      && error.lease.instanceId === 'first'
    ),
  )
  first.release()
})

test('publishes readiness and releases only its own Gateway lease', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qwaudio-gateway-ready-'))
  const lease = await acquireGatewayLease(directory, {
    pid: 303,
    instanceId: 'current',
    owner: 'desktop',
    killImpl: () => {},
  })
  assert.equal(lease.update({
    state: 'ready',
    origin: 'http://127.0.0.1:3101',
  }), true)
  assert.deepEqual(readGatewayLease(directory), {
    schema: GATEWAY_LOCK_SCHEMA,
    instanceId: 'current',
    pid: 303,
    owner: 'desktop',
    state: 'ready',
    origin: 'http://127.0.0.1:3101',
    startedAt: readGatewayLease(directory).startedAt,
    heartbeatAt: readGatewayLease(directory).heartbeatAt,
  })

  writeFileSync(gatewayLockPath(directory), JSON.stringify({
    schema: GATEWAY_LOCK_SCHEMA,
    instanceId: 'replacement',
    pid: 404,
  }))
  assert.equal(lease.release(), false)
  assert.equal(readGatewayLease(directory).instanceId, 'replacement')
})

test('recovers a stale Gateway lease atomically', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qwaudio-gateway-stale-'))
  writeFileSync(gatewayLockPath(directory), JSON.stringify({
    schema: GATEWAY_LOCK_SCHEMA,
    instanceId: 'stale',
    pid: 99,
  }))
  const lease = await acquireGatewayLease(directory, {
    pid: 505,
    instanceId: 'fresh',
    killImpl: missingProcess,
  })
  assert.equal(readGatewayLease(directory).instanceId, 'fresh')
  lease.release()
})

function readyLease(overrides = {}) {
  return JSON.stringify({
    schema: GATEWAY_LOCK_SCHEMA,
    instanceId: 'previous',
    pid: 707,
    owner: 'desktop',
    state: 'ready',
    origin: 'http://127.0.0.1:3101',
    startedAt: '2026-09-18T23:31:43.147Z',
    heartbeatAt: '2026-09-18T23:32:13.604Z',
    ...overrides,
  })
}

// Windows gave a force-killed Gateway's id to a speech service, and the PID-only
// check then refused every later start with "a Gateway is already running".
test('a recycled process id does not keep a dead Gateway holding the lease', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qwaudio-gateway-recycled-'))
  const probed = []
  const lease = await acquireGatewayLease(directory, {
    pid: 808,
    instanceId: 'fresh',
    killImpl: () => {},
    probe: async origin => { probed.push(origin); return null },
  })
  assert.deepEqual(probed, [])
  lease.release()

  writeFileSync(gatewayLockPath(directory), readyLease())
  const second = await acquireGatewayLease(directory, {
    pid: 808,
    instanceId: 'after-restart',
    killImpl: () => {},
    probe: async origin => { probed.push(origin); return null },
  })
  assert.deepEqual(probed, ['http://127.0.0.1:3101'])
  assert.equal(readGatewayLease(directory).instanceId, 'after-restart')
  second.release()
})

test('yields to a Gateway that answers with the lease identity', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qwaudio-gateway-live-'))
  writeFileSync(gatewayLockPath(directory), readyLease())
  await assert.rejects(
    () => acquireGatewayLease(directory, {
      pid: 909,
      instanceId: 'intruder',
      killImpl: () => {},
      probe: async () => ({ backend: 'opencode', gatewayInstanceId: 'previous' }),
    }),
    error => (
      error.code === 'QWAUDIO_GATEWAY_ALREADY_RUNNING'
      && error.lease.instanceId === 'previous'
    ),
  )
  assert.equal(readGatewayLease(directory).instanceId, 'previous')
})

test('another service on the recorded port does not hold the lease', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qwaudio-gateway-foreign-'))
  writeFileSync(gatewayLockPath(directory), readyLease())
  const lease = await acquireGatewayLease(directory, {
    pid: 1010,
    instanceId: 'takeover',
    killImpl: () => {},
    probe: async () => ({ backend: 'opencode', gatewayInstanceId: 'someone-else' }),
  })
  assert.equal(readGatewayLease(directory).instanceId, 'takeover')
  lease.release()
})

test('a Gateway still starting is trusted for a grace window, then not', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qwaudio-gateway-starting-'))
  const starting = readyLease({ state: 'starting', origin: '' })
  const probe = async () => { throw new Error('a starting Gateway cannot be probed') }

  writeFileSync(gatewayLockPath(directory), starting)
  await assert.rejects(
    () => acquireGatewayLease(directory, {
      pid: 1111,
      instanceId: 'impatient',
      killImpl: () => {},
      probe,
      now: () => new Date('2026-09-18T23:32:20.000Z'),
    }),
    error => error.code === 'QWAUDIO_GATEWAY_ALREADY_RUNNING',
  )

  writeFileSync(gatewayLockPath(directory), starting)
  const lease = await acquireGatewayLease(directory, {
    pid: 1111,
    instanceId: 'patient',
    killImpl: () => {},
    probe,
    now: () => new Date('2026-09-18T23:34:57.000Z'),
  })
  assert.equal(readGatewayLease(directory).instanceId, 'patient')
  lease.release()
})

test('discovers only the Gateway whose health identity matches its lease', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qwaudio-gateway-find-'))
  const lease = await acquireGatewayLease(directory, {
    pid: 606,
    instanceId: 'discoverable',
    killImpl: () => {},
  })
  lease.update({ state: 'ready', origin: 'http://127.0.0.1:3210' })

  assert.equal(await findRunningGateway(directory, {
    readHealth: async () => ({ gatewayInstanceId: 'different' }),
    timeoutMs: 0,
  }), null)
  const active = await findRunningGateway(directory, {
    readHealth: async origin => ({
      gatewayInstanceId: 'discoverable',
      origin,
    }),
    timeoutMs: 0,
  })
  assert.equal(active.origin, 'http://127.0.0.1:3210')
  assert.equal(active.health.gatewayInstanceId, 'discoverable')
  assert.match(readFileSync(gatewayLockPath(directory), 'utf8'), /discoverable/)
  lease.release()
})

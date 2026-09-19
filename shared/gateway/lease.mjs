import { randomUUID } from 'node:crypto'
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { readGatewayHealth } from './http-client.mjs'

export const GATEWAY_LOCK_SCHEMA = 'qwaudio.gateway-lock/v1'

export function gatewayLockPath(stateDirectory) {
  return resolve(stateDirectory, 'gateway.lock')
}

function processIsAlive(pid, killImpl = process.kill) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    killImpl(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export function readGatewayLease(stateDirectory) {
  try {
    const lease = JSON.parse(readFileSync(gatewayLockPath(stateDirectory), 'utf8'))
    return lease?.schema === GATEWAY_LOCK_SCHEMA
      && typeof lease.instanceId === 'string'
      ? lease
      : null
  } catch {
    return null
  }
}

function sameLease(left, right) {
  return Boolean(
    left?.instanceId
    && left.instanceId === right?.instanceId
    && left.pid === right?.pid,
  )
}

function writeLease(path, lease) {
  const fd = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(fd, `${JSON.stringify(lease)}\n`, 'utf8')
  } finally {
    closeSync(fd)
  }
}

function replaceLease(path, lease) {
  const temporary = `${path}.${lease.instanceId}.tmp`
  try {
    writeLease(temporary, lease)
    renameSync(temporary, path)
  } catch (error) {
    try {
      unlinkSync(temporary)
    } catch {}
    throw error
  }
  try {
    unlinkSync(temporary)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

function moveStaleLease(path, token) {
  const stale = `${path}.stale.${token}`
  try {
    renameSync(path, stale)
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
  try {
    unlinkSync(stale)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return true
}

// A live process id is not proof that the lease still belongs to a Gateway.
// Windows recycles ids, so a force-killed Gateway's id reappears on something
// unrelated soon enough - a speech service, in the case that prompted this - and
// every later start then refused with "a Gateway is already running". Ask the
// recorded origin who it is, and yield only to a Gateway that answers with this
// lease's own identity, the same proof findRunningGateway already requires.
async function leaseIsLive(existing, { killImpl, probe, now, startingGraceMs }) {
  if (!processIsAlive(Number(existing.pid), killImpl)) return false
  if (existing.origin) {
    const health = await probe(existing.origin)
    return health?.gatewayInstanceId === existing.instanceId
  }
  // No origin yet: a Gateway still starting cannot answer a probe, so trust its
  // heartbeat for one grace window rather than evicting a healthy startup.
  const heartbeat = Date.parse(existing.heartbeatAt || existing.startedAt || '')
  return Number.isFinite(heartbeat) && now().getTime() - heartbeat < startingGraceMs
}

export async function acquireGatewayLease(stateDirectory, {
  pid = process.pid,
  owner = 'gateway',
  instanceId = randomUUID(),
  now = () => new Date(),
  killImpl = process.kill,
  probe = origin => readGatewayHealth(origin),
  startingGraceMs = 45_000,
} = {}) {
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 })
  const path = gatewayLockPath(stateDirectory)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const timestamp = now().toISOString()
    const lease = {
      schema: GATEWAY_LOCK_SCHEMA,
      instanceId,
      pid,
      owner,
      state: 'starting',
      origin: '',
      startedAt: timestamp,
      heartbeatAt: timestamp,
    }
    try {
      writeLease(path, lease)
      let released = false
      return Object.freeze({
        path,
        instanceId,
        pid,
        get released() {
          return released
        },
        update(fields = {}) {
          if (released) return false
          const current = readGatewayLease(stateDirectory)
          if (!sameLease(current, lease)) return false
          Object.assign(lease, fields, {
            schema: GATEWAY_LOCK_SCHEMA,
            instanceId,
            pid,
            heartbeatAt: now().toISOString(),
          })
          replaceLease(path, lease)
          return true
        },
        release() {
          if (released) return false
          released = true
          const current = readGatewayLease(stateDirectory)
          if (!sameLease(current, lease)) return false
          try {
            unlinkSync(path)
            return true
          } catch (error) {
            if (error?.code === 'ENOENT') return false
            throw error
          }
        },
      })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const existing = readGatewayLease(stateDirectory)
      if (existing && await leaseIsLive(existing, { killImpl, probe, now, startingGraceMs })) {
        const conflict = new Error(
          `已有 Gateway 正在运行${existing.origin ? `：${existing.origin}` : ''}`,
        )
        conflict.code = 'QWAUDIO_GATEWAY_ALREADY_RUNNING'
        conflict.lease = existing
        throw conflict
      }
      if (!moveStaleLease(path, instanceId)) continue
    }
  }
  throw new Error('无法获取 Gateway 实例租约')
}

export async function findRunningGateway(stateDirectory, {
  readHealth,
  timeoutMs = 3000,
  intervalMs = 100,
} = {}) {
  const deadline = Date.now() + timeoutMs
  do {
    const lease = readGatewayLease(stateDirectory)
    if (!lease) return null
    if (lease.origin) {
      const health = await readHealth(lease.origin)
      if (
        health
        && health.gatewayInstanceId === lease.instanceId
      ) {
        return { lease, origin: lease.origin, health }
      }
    }
    if (Date.now() >= deadline) return null
    await new Promise(resolvePromise => setTimeout(resolvePromise, intervalMs))
  } while (true)
}

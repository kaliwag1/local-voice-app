import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bonsaiPaths, createBonsaiRuntime, logOpenMode, MAX_LOG_BYTES, ownsBonsai, serverArguments, withBonsai } from '../src/bonsai-runtime.mjs'

test('keeps appending the startup log until it passes the cap, then starts afresh', () => {
  assert.equal(logOpenMode(0), 'a')
  assert.equal(logOpenMode(MAX_LOG_BYTES), 'a')
  assert.equal(logOpenMode(MAX_LOG_BYTES + 1), 'w')
  assert.equal(logOpenMode(undefined), 'a')
})

test('Bonsai ownership requires recorded PID, exact runtime and selected model', () => {
  const paths = bonsaiPaths('C:\\Jake', 'C:\\voice')
  const record = { key: 'bonsai/official', pid: 100 }
  const info = { pid: 100, executablePath: paths.exe, commandLine: `"${paths.exe}" -m "${paths.models[record.key]}"` }
  assert.ok(ownsBonsai(info, record, paths))
  assert.equal(ownsBonsai({ ...info, pid: 101 }, record, paths), false)
  assert.equal(ownsBonsai({ ...info, executablePath: 'other.exe' }, record, paths), false)
  assert.equal(ownsBonsai(info, { ...record, key: 'bonsai/crack' }, paths), false)
  const args = serverArguments(paths.models[record.key], 32768)
  assert.ok(args.includes('--jinja'))
  assert.equal(args[args.indexOf('--alias') + 1], 'bonsai')
  assert.throws(() => serverArguments('model', 0), /context/)
})

test('adapter filters incompatible LM entries and prevents concurrent GPU models', async () => {
  let loaded = [{ modelKey: 'gemma', identifier: 'gemma' }]
  let active = null
  const starts = []
  const adapter = withBonsai(async (...args) => JSON.stringify(args[0] === 'ls'
    ? [{ modelKey: 'prism/bonsai-pq2' }, { modelKey: 'bonsai-2-27b-ternary-crack', displayName: 'Bonsai 2 27B PQ2 0 CRACK' }, { modelKey: 'gemma' }] : loaded), {
    list: async () => [{ modelKey: 'bonsai/official' }, { modelKey: 'bonsai/crack' }],
    status: async () => active,
    start: async (...args) => starts.push(args), stop: async () => { active = null },
  })
  assert.deepEqual(JSON.parse(await adapter('ls')).map(m => m.modelKey), ['gemma', 'bonsai/official', 'bonsai/crack'])
  await assert.rejects(adapter('load', 'bonsai/official', '--context-length', '32768'), /still loaded/)
  loaded = []
  await adapter('load', 'bonsai/crack', '--context-length', '32768')
  assert.deepEqual(starts, [['bonsai/crack', 32768]])
  active = { key: 'bonsai/crack', context: 32768 }
  assert.equal(JSON.parse(await adapter('ps'))[0].modelKey, 'bonsai/crack')
  await assert.rejects(adapter('load', 'gemma'), /Stop Bonsai/)
  await adapter('unload', 'bonsai/crack')
  assert.equal(active, null)
})

test('foreign port is left untouched and prevents starting Bonsai', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bonsai-test-'))
  try {
    const exe = join(root, 'server.exe'), model = join(root, 'model.gguf')
    await writeFile(exe, ''); await writeFile(model, '')
    const runtime = createBonsaiRuntime({ paths: { exe, state: join(root, 'state'), models: { 'bonsai/official': model } },
      inspect: async () => ({ pid: 42, executablePath: 'foreign.exe' }) })
    assert.equal(await runtime.status(), null)
    await runtime.stop()
    await assert.rejects(runtime.start('bonsai/official', 32768), /Port 8080 belongs/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PermissionRules,
  isDangerousCommand,
  matchRules,
  suggestRule,
  validateRule,
} from '../src/task/permission-rules.mjs'

const cmd = (command, kind = 'execute') => ({ kind, command })
const read = (path, kind = 'read') => ({ kind, path })

test('command rules are globs anchored on a spelled-out command name', () => {
  const rules = [validateRule({ type: 'command', pattern: 'ffprobe *' })]
  assert.equal(matchRules(rules, cmd('ffprobe -v quiet -show_format "D:\\Footage\\A001.mov"')).rule, rules[0])
  assert.equal(matchRules(rules, cmd('FFPROBE -i x')).rule, rules[0], 'case-insensitive')
  assert.equal(matchRules(rules, cmd('ffmpeg -i x')), null)
  assert.equal(matchRules(rules, cmd('echo ffprobe *')), null, 'anchored at the start')
  assert.throws(() => validateRule({ type: 'command', pattern: '*' }), /spelled out/)
  assert.throws(() => validateRule({ type: 'command', pattern: '* -i *' }), /spelled out/)
  assert.throws(() => validateRule({ type: 'command', pattern: 'x' }), /command pattern/)
})

test('destructive or privileged commands are never auto-allowed, even with a matching rule', () => {
  for (const command of ['rm -rf D:\\Footage', 'Remove-Item x', 'del *.mov', 'format D:', 'shutdown /s',
    'git push origin main --force', 'git reset --hard', 'sudo apt install x', 'cmd /c rmdir /s x', 'ffprobe x; rm y']) {
    assert.equal(isDangerousCommand(command), true, command)
  }
  for (const command of ['ffprobe x', 'git status', 'git push origin main', 'python script.py', 'dir', 'ls -la']) {
    assert.equal(isDangerousCommand(command), false, command)
  }
  assert.throws(() => validateRule({ type: 'command', pattern: 'rm *' }), /always-ask/)
  assert.throws(() => validateRule({ type: 'command', pattern: 'Remove-Item *' }), /always-ask/)
  const rules = [validateRule({ type: 'command', pattern: 'git *' })]
  assert.deepEqual(matchRules(rules, cmd('git reset --hard')), { blocked: 'command is on the always-ask list' })
  assert.equal(matchRules(rules, cmd('git status')).rule, rules[0])
})

test('path rules are folder prefixes with read or read/write access', () => {
  const readRule = validateRule({ type: 'path', pattern: 'D:/Footage/' })
  assert.equal(readRule.pattern, 'D:\\Footage')
  assert.equal(readRule.access, 'read')
  const rules = [readRule]
  assert.equal(matchRules(rules, read('d:\\footage\\2026\\a001.mov')).rule, readRule)
  assert.equal(matchRules(rules, read('D:\\Footage')).rule, readRule)
  assert.equal(matchRules(rules, read('D:\\FootageArchive\\x')), null, 'prefix is a whole folder')
  assert.equal(matchRules(rules, read('D:\\Footage\\x', 'edit')), null, 'read-only rule does not cover writes')
  assert.equal(matchRules(rules, { kind: 'read', locations: [{ path: 'D:\\Footage\\a' }, { path: 'C:\\other' }] }), null, 'every path must be covered')
  const writeRule = validateRule({ type: 'path', pattern: 'D:\\Footage\\Proxies', access: 'write' })
  assert.equal(matchRules([writeRule], read('D:\\Footage\\Proxies\\a.mp4', 'edit')).rule, writeRule)
  assert.deepEqual(matchRules([writeRule], read('D:\\Footage\\Proxies\\a.mp4', 'delete')), { blocked: 'delete operations always ask' })
  assert.equal(matchRules([writeRule], cmd('ffmpeg -i D:\\Footage\\Proxies\\a.mp4')), null, 'commands need a command rule')
})

test('whole drives and system/profile roots cannot become rules', () => {
  for (const pattern of ['C:\\', 'D:', 'C:\\Windows', 'C:\\Program Files', 'C:\\Users', 'C:\\Users\\JakeW', '/', '/home/jake', '/etc']) {
    assert.throws(() => validateRule({ type: 'path', pattern }), /cannot be auto-allowed/, pattern)
  }
  assert.throws(() => validateRule({ type: 'path', pattern: 'Footage' }), /full folder path/)
  assert.doesNotThrow(() => validateRule({ type: 'path', pattern: 'C:\\Users\\JakeW\\Videos' }))
  assert.doesNotThrow(() => validateRule({ type: 'path', pattern: '\\\\nas\\footage\\2026' }))
})

test('suggests a first-draft rule from the operation the user just saw', () => {
  assert.deepEqual(suggestRule(cmd('ffprobe -show_format x.mov')), { type: 'command', pattern: 'ffprobe *' })
  assert.deepEqual(suggestRule(cmd('git status --short')), { type: 'command', pattern: 'git status *' })
  assert.deepEqual(suggestRule(cmd('npm run build')), { type: 'command', pattern: 'npm run *' })
  assert.equal(suggestRule(cmd('rm -rf x')), null)
  assert.deepEqual(suggestRule(read('D:\\Footage\\2026\\a.mov')), { type: 'path', pattern: 'D:\\Footage\\2026', access: 'read' })
  assert.deepEqual(suggestRule(read('D:\\Footage\\2026\\a.txt', 'edit')), { type: 'path', pattern: 'D:\\Footage\\2026', access: 'write' })
  assert.equal(suggestRule(read('D:\\x\\a', 'delete')), null)
})

test('store persists rules, dedupes, records use and survives a corrupt file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'permission-rules-'))
  const path = join(directory, 'permission-rules.json')
  let now = 1000
  const store = new PermissionRules({ path, now: () => now })
  const rule = store.add({ type: 'command', pattern: 'ffprobe *', note: 'clip metadata' })
  assert.equal(store.add({ type: 'command', pattern: 'FFPROBE *' }).id, rule.id, 'case-insensitive duplicate')
  assert.equal(store.list().length, 1)
  now = 2000
  assert.equal(store.match(cmd('ffprobe x')).id, rule.id)
  assert.equal(store.match(cmd('ffmpeg x')), null)
  await store.flush()
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(saved.rules[0].useCount, 1)
  assert.equal(saved.rules[0].lastUsedAt, 2000)
  const reloaded = new PermissionRules({ path })
  assert.equal(reloaded.list()[0].pattern, 'ffprobe *')
  assert.equal(reloaded.remove(rule.id), true)
  assert.equal(reloaded.remove(rule.id), false)
  await reloaded.flush()
  assert.deepEqual(new PermissionRules({ path }).list(), [])
  const { writeFileSync } = await import('node:fs')
  writeFileSync(path, '{ nope', 'utf8')
  assert.deepEqual(new PermissionRules({ path }).list(), [])
  // A stored rule that later fails validation is dropped, not trusted.
  writeFileSync(path, JSON.stringify({ rules: [{ id: 'r', type: 'command', pattern: 'rm *' }, { id: 's', type: 'command', pattern: 'dir *' }] }), 'utf8')
  assert.deepEqual(new PermissionRules({ path }).list().map(item => item.pattern), ['dir *'])
})

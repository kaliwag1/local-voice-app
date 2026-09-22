import assert from 'node:assert/strict'
import { closeSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openSpeechLog } from '../src/local-model-switch.mjs'

test('opens the speech log, overwriting the previous run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'speech-log-'))
  writeFileSync(join(dir, 'Last Speech Service.log'), 'a stale run')
  const fd = openSpeechLog(dir)
  assert.equal(typeof fd, 'number')
  closeSync(fd)
  assert.equal(readFileSync(join(dir, 'Last Speech Service.log'), 'utf8'), '')
})

// Speech must start even when its log cannot be written.
test('falls back to no log when the file cannot be opened', () => {
  const locked = () => { throw Object.assign(new Error('locked'), { code: 'EBUSY' }) }
  assert.equal(openSpeechLog('C:\\voice', locked), null)
})

// Stdout carries "USER: <what you said>" and "ASSISTANT: <reply>"; only stderr is kept.
test('never captures stdout, where the transcript and replies are printed', () => {
  const source = readFileSync(new URL('../src/local-model-switch.mjs', import.meta.url), 'utf8')
  assert.match(source, /stdio: \['ignore', 'ignore', log \?\? 'ignore'\]/)
})

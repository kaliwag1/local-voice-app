import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { transcribeAudioFile, validateAudioFile } from '../src/local-audio-transcription.mjs'

test('rejects unsupported or oversized audio before starting Python', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qwen-audio-test-'))
  try {
    const text = join(dir, 'notes.txt')
    await writeFile(text, 'hello')
    await assert.rejects(validateAudioFile(text), /Choose a WAV/)
    await assert.rejects(validateAudioFile(join(dir, 'missing.wav')), /ENOENT/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('passes a local file to Python in offline mode and returns a transcript', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qwen-audio-test-'))
  try {
    const filePath = join(dir, 'interview.wav')
    await writeFile(filePath, 'synthetic audio fixture')
    let call
    const result = await transcribeAudioFile({
      filePath,
      runner: async (python, args, options) => {
        call = { python, args, options }
        return { stdout: JSON.stringify({ text: 'Test transcript.', words: [
          { word: 'Test', start: 0.1, end: 0.4 },
          { word: 'transcript.', start: 0.5, end: 1.1 },
        ], durationSeconds: 1.5 }) }
      },
    })
    assert.deepEqual(result, { text: 'Test transcript.', words: [
      { word: 'Test', start: 0.1, end: 0.4 },
      { word: 'transcript.', start: 0.5, end: 1.1 },
    ], filename: 'interview.wav', durationSeconds: 1.5 })
    assert.equal(call.args[1], filePath)
    assert.equal(call.options.env.HF_HUB_OFFLINE, '1')
    assert.equal(call.options.env.TRANSFORMERS_OFFLINE, '1')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('surfaces a local decoder error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qwen-audio-test-'))
  try {
    const filePath = join(dir, 'broken.wav')
    await writeFile(filePath, 'not audio')
    await assert.rejects(
      transcribeAudioFile({ filePath, runner: async () => { throw { stderr: 'Could not decode this audio file.' } } }),
      /Could not decode/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

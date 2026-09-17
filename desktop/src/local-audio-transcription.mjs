import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const allowedExtensions = new Set(['.wav', '.wave', '.flac', '.ogg', '.opus', '.mp3', '.aiff', '.aif'])
const maxBytes = 500 * 1024 * 1024

export function transcriptionPaths(env = process.env) {
  const root = env.QWEN_AUDIO_LOCAL_VOICE_ROOT
    || resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..')
  const helper = fileURLToPath(new URL('./transcribe-audio-file.py', import.meta.url))
  return {
    python: join(root, '.voice-env', 'Scripts', 'python.exe'),
    helper: helper.replace('app.asar\\', 'app.asar.unpacked\\'),
  }
}

export async function validateAudioFile(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) {
    throw new Error('Choose a local audio file.')
  }
  const absolute = resolve(filePath)
  if (!allowedExtensions.has(extname(absolute).toLowerCase())) {
    throw new Error('Choose a WAV, FLAC, OGG, OPUS, MP3, or AIFF file.')
  }
  const info = await stat(absolute)
  if (!info.isFile()) throw new Error('Choose a local audio file.')
  if (info.size > maxBytes) throw new Error('This audio file is too large (maximum 500 MB).')
  return absolute
}

export async function transcribeAudioFile({ filePath, env = process.env, runner = execFileAsync, signal } = {}) {
  const absolute = await validateAudioFile(filePath)
  const { python, helper } = transcriptionPaths(env)
  let stdout
  try {
    const result = await runner(python, [helper, absolute], {
      windowsHide: true,
      timeout: 30 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024,
      signal,
      env: { ...env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
    })
    stdout = result.stdout
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Transcription cancelled.')
    throw new Error((error.stderr || error.message || 'Could not transcribe this file.').trim())
  }
  let result
  try { result = JSON.parse(stdout) } catch {
    throw new Error('The local transcriber returned an invalid result.')
  }
  if (typeof result.text !== 'string' || !Number.isFinite(result.durationSeconds)) {
    throw new Error('The local transcriber returned an incomplete result.')
  }
  const words = Array.isArray(result.words) ? result.words.filter(item => (
    typeof item?.word === 'string'
    && Number.isFinite(item.start)
    && Number.isFinite(item.end)
  )) : []
  return {
    text: result.text,
    words,
    filename: basename(absolute),
    durationSeconds: result.durationSeconds,
  }
}

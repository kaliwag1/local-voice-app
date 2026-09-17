import { useState } from 'react'
import './audio-transcriber.css'

const ACCEPT = '.wav,.wave,.flac,.ogg,.opus,.mp3,.aiff,.aif'
const timeLabel = seconds => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`

export default function AudioTranscriber({ bridge = window.qwenAudioAgentDesktop }) {
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [filename, setFilename] = useState('')
  const [text, setText] = useState('')
  const [words, setWords] = useState([])
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const available = typeof bridge?.transcribeAudioFile === 'function'

  async function run(file) {
    if (!file || !available || busy) return
    setBusy(true)
    setError('')
    setCopied(false)
    setText('')
    setWords([])
    setFilename(file.name || file.path?.split(/[\\/]/).pop() || 'Audio file')
    try {
      const result = await bridge.transcribeAudioFile(file)
      if (!result || typeof result.text !== 'string') throw new Error('No transcript was returned.')
      setFilename(result.filename || file.name || 'Audio file')
      setText(result.text)
      setWords(Array.isArray(result.words) ? result.words : [])
    } catch (reason) {
      setError(reason?.message || 'Could not transcribe this file.')
    } finally {
      setBusy(false)
    }
  }

  async function chooseFile() {
    if (!available || busy) return
    try {
      if (typeof bridge.pickAudioFile === 'function') {
        const picked = await bridge.pickAudioFile()
        if (picked) await run(picked)
      } else {
        document.getElementById('qwen-audio-file-input')?.click()
      }
    } catch (reason) {
      setError(reason?.message || 'Could not open an audio file.')
    }
  }

  function drop(event) {
    event.preventDefault()
    setDragging(false)
    void run(event.dataTransfer.files?.[0])
  }

  function download() {
    const objectUrl = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `${filename.replace(/\.[^.]+$/, '') || 'transcript'}.txt`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setError('Could not copy the transcript. You can select the text instead.')
    }
  }

  function saveWordTimings() {
    const rows = ['start_seconds,end_seconds,word', ...words.map(item => (
      `${item.start},${item.end},"${item.word.replaceAll('"', '""')}"`
    ))]
    const objectUrl = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `${filename.replace(/\.[^.]+$/, '') || 'transcript'}-word-timings.csv`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }

  return (
    <section className="audio-transcriber" aria-label="Transcribe an audio file">
      <div className="audio-transcriber-heading">
        <h2>Transcribe audio</h2>
        <span>Runs locally on this PC</span>
      </div>
      <div
        className={`audio-transcriber-drop${dragging ? ' is-dragging' : ''}`}
        onDragEnter={event => { event.preventDefault(); setDragging(true) }}
        onDragOver={event => event.preventDefault()}
        onDragLeave={event => { event.preventDefault(); setDragging(false) }}
        onDrop={drop}
      >
        <p>Drop an audio file here, or choose one from your computer.</p>
        <button type="button" onClick={chooseFile} disabled={!available || busy}>
          {busy ? 'Transcribing…' : 'Choose audio file'}
        </button>
        <input
          id="qwen-audio-file-input"
          className="audio-transcriber-hidden"
          type="file"
          accept={ACCEPT}
          onChange={event => {
            void run(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>
      {!available && <p className="audio-transcriber-note">Open the desktop app to transcribe a file.</p>}
      {busy && <p role="status">Working on {filename}. Longer recordings can take a few minutes.</p>}
      {error && <p className="audio-transcriber-error" role="alert">{error}</p>}
      {text && (
        <div className="audio-transcriber-result">
          <div className="audio-transcriber-result-heading">
            <strong>{filename}</strong>
            <div>
              <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
              <button type="button" onClick={download}>Save text</button>
            </div>
          </div>
          <textarea aria-label="Transcript" value={text} onChange={event => setText(event.target.value)} />
          {words.length > 0 && <details className="audio-transcriber-words">
            <summary>Word-by-word timestamps ({words.length})</summary>
            <button type="button" onClick={saveWordTimings}>Save word timings</button>
            <div className="audio-transcriber-word-list">
              {words.slice(0, 100).map((item, index) => <div key={`${index}-${item.start}`}>
                <time>{timeLabel(item.start)}–{timeLabel(item.end)}</time>
                <span>{item.word}</span>
              </div>)}
            </div>
            {words.length > 100 && <small>Showing the first 100 words here; the saved file includes all of them.</small>}
          </details>}
        </div>
      )}
      {!busy && !error && filename && !text && <p role="status">No speech was detected in {filename}.</p>}
    </section>
  )
}

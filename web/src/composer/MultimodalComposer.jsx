import { useCallback, useRef, useState } from 'react'
import SelectMenu from '../SelectMenu.jsx'
import {
  MAX_INPUT_FILE_BYTES,
  createInputFilePart,
  inputPartLabel,
  withAttachmentAnchors,
} from '../../../shared/input-parts.mjs'
import { t } from '../i18n.js'
import VisualStreamControl from './VisualStreamControl.jsx'

function filePart(file, index, sourceType = 'file') {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_INPUT_FILE_BYTES) {
      reject(new Error(t('文件 {name} 超过 8 MB 限制', { name: file.name })))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error(t('无法读取文件')))
    reader.onload = () => {
      resolve({
        id: crypto.randomUUID(),
        part: createInputFilePart({
          mime: file.type || 'application/octet-stream',
          filename: file.name,
          url: String(reader.result || ''),
          sourceType,
        }, index),
      })
    }
    reader.readAsDataURL(file)
  })
}

export default function MultimodalComposer({
  onSend,
  onVisualFrame,
  onVisualStop,
  visualStreamSupported = false,
  visualStreamAvailable = false,
  voiceInputEnabled = false,
  connectionState = 'connected',
  compact = false,
  busy = false,
  onStop = null,
  onListScreenApps = null,
  onCaptureScreenApp = null,
  // Rendered at the right of the controls row: what the composer is about to
  // spend, next to the buttons that spend it.
  status = null,
}) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState([])
  const [error, setError] = useState('')
  const [visualPanelHost, setVisualPanelHost] = useState(null)
  const picker = useRef(null)
  const [screenApps, setScreenApps] = useState(null)
  const [screenApp, setScreenApp] = useState('')
  const [capturingScreen, setCapturingScreen] = useState(false)
  const [loadingScreenApps, setLoadingScreenApps] = useState(false)
  const updateAttachments = useCallback(next => {
    setAttachments(next)
  }, [])

  const addFiles = useCallback(async (fileList, sourceType = 'file') => {
    const files = [...fileList]
    if (!files.length) return
    try {
      const next = await Promise.all(files.map((file, index) => (
        filePart(file, attachments.length + index, sourceType)
      )))
      updateAttachments([...attachments, ...next])
      setError('')
    } catch (reason) {
      setError(reason?.message || String(reason))
    }
  }, [attachments, updateAttachments])

  const chooseScreenApp = async () => {
    setLoadingScreenApps(true)
    setError('')
    try {
      const apps = await onListScreenApps()
      setScreenApps(apps)
      setScreenApp(apps[0]?.app || '')
      if (!apps.length) setError('No running app windows were found. Open the app you want to ask about and try again.')
    } catch (reason) { setError(reason?.message || String(reason)) }
    finally { setLoadingScreenApps(false) }
  }

  const captureScreen = async () => {
    setCapturingScreen(true)
    setError('')
    try {
      const image = await onCaptureScreenApp(screenApp)
      const item = {
        id: crypto.randomUUID(), screenApp: image.app,
        part: createInputFilePart(image, attachments.length),
      }
      setAttachments(current => [...current, item])
      setScreenApps(null)
    } catch (reason) { setError(reason?.message || String(reason)) }
    finally { setCapturingScreen(false) }
  }

  const submit = event => {
    event.preventDefault()
    if (capturingScreen) return
    const content = text.trim()
    if (!content && !attachments.length) return
    const parts = withAttachmentAnchors([
      ...(content ? [{ type: 'text', text: content }] : []),
      ...attachments.map(item => item.part),
    ])
    if (!onSend(parts)) {
      setError(t('Gateway 尚未连接'))
      return
    }
    setText('')
    updateAttachments([])
    setError('')
  }

  return <form
    className="multimodal-composer"
    onSubmit={submit}
    onDragOver={event => event.preventDefault()}
    onDrop={event => {
      event.preventDefault()
      addFiles(event.dataTransfer.files)
    }}
  >
    {screenApps && <div className="screen-capture-picker">
      <label htmlFor="screen-app-select">Choose the app to look at</label>
      <SelectMenu
        id="screen-app-select"
        value={screenApp}
        disabled={capturingScreen}
        options={screenApps.map(app => ({ value: app.app, label: app.label }))}
        onChange={setScreenApp}
      />
      <div>
        <button type="button" disabled={!screenApp || capturingScreen} onClick={captureScreen}>
          {capturingScreen ? 'Capturing…' : 'Capture window'}
        </button>
        <button type="button" disabled={capturingScreen} onClick={() => setScreenApps(null)}>Cancel</button>
      </div>
    </div>}
    {attachments.filter(item => item.screenApp).map(item => <div className="screen-capture-preview" key={item.id}>
      <img src={item.part.url} alt={`Screenshot of ${item.screenApp}`} />
      <div><strong>{item.screenApp}</strong><small>Screenshot attached. Add your question, then send.</small>
        <button type="button" onClick={() => setText("What's this error?")}>What's this error?</button>
        <button type="button" onClick={() => setText('Summarise this page.')}>Summarise this page</button>
      </div>
    </div>)}
    {visualStreamSupported && <div
      className="visual-stream-dock"
      ref={setVisualPanelHost}
    />}
    {attachments.length > 0 && <div className="composer-attachments">
      {attachments.map((item, index) => <span className="composer-attachment" key={item.id}>
        <span>{inputPartLabel(item.part, index)}</span>
        <button
          type="button"
          aria-label={t('移除附件')}
          onClick={() => updateAttachments(attachments.filter(entry => entry.id !== item.id))}
        >×</button>
      </span>)}
    </div>}
    <div className="composer-field">
      <textarea
        value={text}
        rows="1"
        placeholder={compact
          ? t('输入文字或图片')
          : t('输入文字，或粘贴、拖入图片和文件')}
        onChange={event => setText(event.target.value)}
        onPaste={event => {
          const files = event.clipboardData?.files
          if (!files?.length) return
          event.preventDefault()
          addFiles(files, 'clipboard')
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) submit(event)
        }}
      />
      {busy && typeof onStop === 'function'
        ? <button
          className="composer-send stopping"
          type="button"
          onClick={() => { void onStop() }}
          title="Stop the current reply and any running task"
          aria-label="Stop"
        ><svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <rect x="8.5" y="8.5" width="7" height="7" rx="1.4" fill="currentColor" stroke="none" />
        </svg></button>
        : <button
          className="composer-send"
          type="submit"
          disabled={capturingScreen}
          title={t('发送')}
          aria-label={t('发送')}
        ><svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 7v4a3 3 0 0 1-3 3H6" />
          <path d="M9 11l-3 3 3 3" />
        </svg></button>}
    </div>
    <div className="composer-controls">
      <div className="composer-tools">
      <button
        className="composer-attach"
        type="button"
        title={t('添加图片或文件')}
        aria-label={t('添加图片或文件')}
        onClick={() => picker.current?.click()}
      >＋</button>
      {onListScreenApps && onCaptureScreenApp && <button
        className="composer-screen" type="button" title="Look at my screen" aria-label="Look at my screen"
        disabled={loadingScreenApps || capturingScreen} onClick={chooseScreenApp}
      >{loadingScreenApps ? '…' : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>}</button>}
      {visualStreamSupported && <VisualStreamControl
        available={visualStreamAvailable}
        inputEnabled={voiceInputEnabled}
        connectionState={connectionState}
        onFrame={onVisualFrame}
        onStop={onVisualStop}
        panelHost={visualPanelHost}
      />}
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={event => {
          addFiles(event.target.files)
          event.target.value = ''
        }}
      />
      </div>
      {status ? <div className="composer-status">{status}</div> : null}
    </div>
    {error && <small className="composer-error" role="alert">{error}</small>}
  </form>
}

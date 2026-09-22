import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  buildConversationTurns,
  discardUserTranscript,
  mergeConversationHistory,
  upsertAssistantTranscript,
  upsertUserTranscript,
} from './message-order.js'
import MessageContent from './MessageContent.jsx'
import TurnActivity from './TurnActivity.jsx'
import ContextMeter from './ContextMeter.jsx'
import ChatItemMenu from './ChatItemMenu.jsx'
import { formatContextLength } from './context-usage.js'
import ComposerModelPicker from './composer/ComposerModelPicker.jsx'
import { mergeTurnActivities } from './turn-activity.js'
import { isActive } from './turn-stream.js'
import MultimodalComposer from './composer/MultimodalComposer.jsx'
import TaskArtifacts from './TaskArtifacts.jsx'
import PermissionActions from './PermissionActions.jsx'
import DesktopFluidOrb from './desktop/DesktopFluidOrb.jsx'
import DesktopSpriteOrb from './desktop/DesktopSpriteOrb.jsx'
import KnowledgeLibraryPanel from './KnowledgeLibraryPanel.jsx'
import AudioTranscriber from './AudioTranscriber.jsx'
import { acceleratorLabel, matchesAcceleratorDown, matchesAcceleratorUp } from './desktop/push-to-talk.js'
import {
  desktopOrbClassName,
  resolveOrbVisualState,
} from './desktop/orb-presentation.js'
import {
  isBuiltinOrbSkin,
} from '../../shared/orb-skin-catalog.mjs'
import { supportsComposerInput } from '../../shared/client-input-capabilities.mjs'
import { resultLabel } from './presentation.js'
import { setRuntimeLanguage, t } from './i18n.js'
import {
  removeDeliveredTask,
  removeTaskInPhase,
  taskDeliverySettled,
  taskDetail,
  taskNeedsPresentation,
  taskLabel,
  taskView,
  taskFiles,
  taskKeepsCard,
} from './task-view.js'
import { taskHasArtifacts } from './task-artifacts.js'
import useRealtimeVoice, {
  realtimeModelStatus,
  shouldClaimReleasedVoice,
} from './realtime/useRealtimeVoice.js'
import { requestedSessionId } from './session.js'
import { initialVoiceEnabled } from './voice-defaults.js'
import {
  applyDesktopClientState,
  desktopCanFinishWaking,
  desktopCanHide,
  desktopHideDeadline,
  desktopTasksActive,
  desktopWorkSettled,
  desktopTasksWorking,
  performDesktopClientAction,
} from './desktop/desktop-hide.js'
import {
  desktopTaskCards,
} from './desktop/desktop-task-cards.js'
import {
  advanceDesktopRuntimePresentation,
  desktopBackendRuntime,
  desktopRealtimeRuntime,
  resolveDesktopRuntime,
} from './desktop/desktop-runtime.js'
import {
  spriteAnimationEventForGatewayEvent,
  spriteAnimationForEvent,
} from './desktop/sprite-orb.js'
import {
  applyDesktopClientSettings,
  initialDesktopClientSettings,
} from './desktop/desktop-client-settings.js'
import {
  gatewayClientInstanceId,
  gatewayClientLabel,
  gatewayClientType,
  gatewayFetch,
} from './gateway-transport.js'

const desktopOrbMode = (
  new URLSearchParams(window.location.search).get('desktop') === 'orb'
)
const initialDesktopSurfaceMode = (
  new URLSearchParams(window.location.search).get('surface') === 'panel'
    ? 'panel'
    : 'orb'
)
const activeClientType = gatewayClientType(desktopOrbMode ? 'desktop' : 'web')
const activeClientInstanceId = gatewayClientInstanceId()
const compactVoiceControl = desktopOrbMode || activeClientType === 'mobile'
const composerEnabled = supportsComposerInput(activeClientType)
const MODEL_INPUT_MODE_ORDER = ['text', 'image', 'video', 'audio']
const MODEL_INPUT_MODE_LABELS = {
  text: 'Text',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
}

function modelInputModeList(modes = []) {
  const supported = new Set(modes)
  return MODEL_INPUT_MODE_ORDER
    .filter(mode => supported.has(mode))
    .map(mode => MODEL_INPUT_MODE_LABELS[mode])
    .join(' · ')
}

function getSessionId() {
  const requested = requestedSessionId(window.location.search)
  if (requested) {
    localStorage.setItem('qwen-audio-agent.session', requested)
    return requested
  }
  const current = localStorage.getItem('qwen-audio-agent.session')
  if (current) return current
  const created = crypto.randomUUID()
  localStorage.setItem('qwen-audio-agent.session', created)
  return created
}

function labelFor(state) {
  return {
    idle: t('待命'),
    listening: t('正在听'),
    processing: t('正在处理'),
    speaking: t('正在说'),
    working: t('正在处理任务'),
    starting: t('正在启动'),
    connecting: t('正在连接语音前台'),
    occupied: t('其他入口正在使用'),
    hidden: t('已隐藏'),
    waking: t('正在显示'),
  }[state] || state
}

function frontendLabel(holder) {
  return holder?.label || {
    desktop: t('桌面端'),
    mobile: t('移动端'),
    cli: t('终端'),
    web: 'WebUI',
  }[holder?.type] || t('其他入口')
}

function OrbControlIcon({ type, muted = false, collapsed = false }) {
  if (type === 'microphone') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3m-3 0h6" />
      {muted && <path d="M4 4 20 20" />}
    </svg>
  }
  if (type === 'speaker') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z" />
      {muted
        ? <path d="m16 9.5 5 5m0-5-5 5" />
        : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}
    </svg>
  }
  if (type === 'settings') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2 2 0 0 1-2.83 2.83l-.04-.04a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.08 1.65V21a2 2 0 0 1-4 0v-.06A1.8 1.8 0 0 0 8.8 19.3a1.8 1.8 0 0 0-1.98.36l-.04.04a2 2 0 0 1-2.83-2.83l.04-.04a1.8 1.8 0 0 0 .36-1.98A1.8 1.8 0 0 0 2.7 13.8H2.6a2 2 0 0 1 0-4h.06A1.8 1.8 0 0 0 4.3 8.72a1.8 1.8 0 0 0-.36-1.98l-.04-.04a2 2 0 0 1 2.83-2.83l.04.04a1.8 1.8 0 0 0 1.98.36A1.8 1.8 0 0 0 9.82 2.6V2.5a2 2 0 0 1 4 0v.06A1.8 1.8 0 0 0 14.9 4.2a1.8 1.8 0 0 0 1.98-.36l.04-.04a2 2 0 0 1 2.83 2.83l-.04.04a1.8 1.8 0 0 0-.36 1.98 1.8 1.8 0 0 0 1.65 1.08h.1a2 2 0 0 1 0 4h-.06A1.8 1.8 0 0 0 19.4 15Z" />
    </svg>
  }
  if (type === 'conversation') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5.5h14v10H9l-4 3v-13Z" />
      <path d="M8 9h8m-8 3h5" />
    </svg>
  }
  if (type === 'collapse') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8 10 4 4 4-4" />
    </svg>
  }
  if (type === 'tasks') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={collapsed ? 'm7 9 5 5 5-5' : 'm7 14 5-5 5 5'} />
    </svg>
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m7 7 10 10M17 7 7 17" />
  </svg>
}

function upsertTask(items, taskId, update, fallback) {
  const index = items.findIndex(item => item.id === taskId)
  if (index < 0) return fallback ? [...items, fallback] : items
  const next = [...items]
  next[index] = update(next[index])
  return next
}

export default function App() {
  const [desktopClientSettings, setDesktopClientSettings] = useState(
    () => initialDesktopClientSettings(window.location.search),
  )
  const {
    orbSkinId,
    autoHideSeconds,
    wakeWordEnabled,
    micMode,
    pushToTalkKey,
    pushToTalkGlobal,
    deafenShortcut,
  } = desktopClientSettings
  const pushToTalkMode = desktopOrbMode && micMode === 'push-to-talk' && Boolean(pushToTalkKey)
  // `t()` reads the module-level runtime language. Keeping a revision in
  // React state makes a language-only settings update repaint this surface
  // without replacing its Gateway WebSocket or Realtime Session.
  const [, setLanguageRevision] = useState(0)
  const [sessionId, setSessionId] = useState(getSessionId)
  const [sessions, setSessions] = useState([])
  const [showArchivedChats, setShowArchivedChats] = useState(false)
  const [editingChat, setEditingChat] = useState(null)
  const titleEditFinished = useRef('')
  const [chatsOpen, setChatsOpen] = useState(true)
  const [showAudioTranscriber, setShowAudioTranscriber] = useState(false)
  const [localModels, setLocalModels] = useState([])
  const [localModelKey, setLocalModelKey] = useState('')
  const [localModelError, setLocalModelError] = useState('')
  const [localModelSwitching, setLocalModelSwitching] = useState(false)
  const [localModelProgress, setLocalModelProgress] = useState(null)
  const [localModelWarning, setLocalModelWarning] = useState('')
  const [localContextLength, setLocalContextLength] = useState(0)
  const [localContextOptions, setLocalContextOptions] = useState([])
  const [localContextChanging, setLocalContextChanging] = useState(false)
  const [localVoice, setLocalVoice] = useState('')
  const [localVoiceOptions, setLocalVoiceOptions] = useState([])
  const [localVoiceChanging, setLocalVoiceChanging] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(() => (
    desktopClientSettings.micMode !== 'push-to-talk' && initialVoiceEnabled({
      desktopOrbMode,
      clientType: activeClientType,
    })
  ))
  // Push-to-talk: true only while the key is down (global hook or in-window fallback).
  const [pushToTalkDown, setPushToTalkDown] = useState(false)
  // Deafen: the assistant's voice is silenced while its replies keep arriving as text.
  // Deliberately not remembered, so a restart never leaves the speaker quietly off.
  const [deafened, setDeafened] = useState(false)
  const [waitingForVoice, setWaitingForVoice] = useState(false)
  const [messages, setMessages] = useState([])
  const [turnActivities, setTurnActivities] = useState({})
  const [activity, setActivity] = useState(t('正在检查后台 Agent'))
  const [frontend, setFrontend] = useState({ label: 'Realtime Agent' })
  const [modelStatus, setModelStatus] = useState(() => realtimeModelStatus())
  const [gatewayRuntime, setGatewayRuntime] = useState('connecting')
  const [backend, setBackend] = useState({
    label: 'Agent',
    enabled: null,
    ready: false,
    status: 'starting',
    code: null,
  })
  const [agentTasks, setAgentTasks] = useState([])
  const [desktopTasksCollapsed, setDesktopTasksCollapsed] = useState(false)
  const [showKnowledgeLibrary, setShowKnowledgeLibrary] = useState(false)
  const [desktopTaskLayout, setDesktopTaskLayout] = useState({
    placement: 'below',
    orbOffsetX: 0,
  })
  const [orbDragging, setOrbDragging] = useState(false)
  const [orbDragDirection, setOrbDragDirection] = useState('')
  const [spriteAnimationCues, setSpriteAnimationCues] = useState([])
  const [spriteOrbFailed, setSpriteOrbFailed] = useState(false)
  const [desktopLifecycle, setDesktopLifecycle] = useState('active')
  const [desktopSurfaceMode, setDesktopSurfaceMode] = useState(
    initialDesktopSurfaceMode,
  )
  const [panelMaximized, setPanelMaximized] = useState(false)
  const [lastInteractionAt, setLastInteractionAt] = useState(Date.now)
  const activeVoiceResponse = useRef('')
  const currentTurnId = useRef('')
  const responseTurnMap = useRef(new Map())
  const agentTurnIds = useRef(new Set())
  const taskDismissTimers = useRef(new Map())
  const messagesRef = useRef(null)
  const stickToBottom = useRef(true)
  const orbDrag = useRef(null)
  const spriteAnimationCueId = useRef(0)
  const runtimeReadyAnnounced = useRef(false)
  const previousTasksActive = useRef(false)
  const workSettledAtRef = useRef(Date.now())
  const autoHideStateRef = useRef(null)
  const autoHideRequestedDeadlineRef = useRef(0)
  const lastWakeAtRef = useRef(0)
  const previousDesktopLifecycle = useRef('active')
  const gatewayCommandsRef = useRef(null)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const spriteAnimationCue = spriteAnimationCues[0] || null

  const refreshSessions = useCallback(async () => {
    if (!desktopOrbMode) return
    try {
      const response = await gatewayFetch('api/conversations', { cache: 'no-store' })
      if (!response.ok) return
      const payload = await response.json()
      setSessions(Array.isArray(payload.sessions) ? payload.sessions : [])
    } catch {
      // The current chat remains usable while the Gateway reconnects.
    }
  }, [])

  const refreshLocalModels = useCallback(async () => {
    const list = window.qwenAudioAgentDesktop?.listLocalModels
    if (!desktopOrbMode || typeof list !== 'function') return
    try {
      const result = await list()
      if (!result?.ok) {
        setLocalModelError(result?.error || 'Local models are unavailable.')
        return
      }
      setLocalModels(result.models || [])
      setLocalModelKey(result.selectedModelKey || '')
      if (Number.isFinite(result.contextLength)) setLocalContextLength(result.contextLength)
      if (Array.isArray(result.contextLengthOptions)) setLocalContextOptions(result.contextLengthOptions)
      if (typeof result.voice === 'string') setLocalVoice(result.voice)
      if (Array.isArray(result.voiceOptions)) setLocalVoiceOptions(result.voiceOptions)
      setLocalModelError('')
    } catch (error) {
      setLocalModelError(error.message || 'Local models are unavailable.')
    }
  }, [])

  useEffect(() => {
    void refreshLocalModels()
  }, [refreshLocalModels])

  useEffect(() => {
    if (!desktopOrbMode) return undefined
    void refreshSessions()
    const timer = setInterval(refreshSessions, 30_000)
    return () => clearInterval(timer)
  }, [refreshSessions])

  useEffect(() => {
    if (!desktopOrbMode || !messages.some(message => (
      message.role === 'user' && !message.live
    ))) return undefined
    const timer = setTimeout(refreshSessions, 800)
    return () => clearTimeout(timer)
  }, [messages, refreshSessions])

  useEffect(() => {
    if (!desktopOrbMode || !messages.some(message => (
      message.role === 'assistant' && !message.live
    ))) return undefined
    // The first list request starts background title generation; fetch once
    // more after the local model has had time to return its title.
    const timer = setTimeout(refreshSessions, 8_000)
    return () => clearTimeout(timer)
  }, [messages, refreshSessions])

  useEffect(() => {
    if (!desktopOrbMode) return undefined
    const bridge = window.qwenAudioAgentDesktop
    if (typeof bridge?.onClientSettings !== 'function') return undefined
    return bridge.onClientSettings(settings => {
      setDesktopClientSettings(current => applyDesktopClientSettings(
        current,
        settings,
      ))
      if (settings.orbSkin) setSpriteOrbFailed(false)
      if (settings.language) {
        setRuntimeLanguage(settings.language)
        setLanguageRevision(value => value + 1)
      }
    })
  }, [])

  useEffect(() => {
    const persistSession = window.qwenAudioAgentDesktop?.setConversationSession
    if (!desktopOrbMode || typeof persistSession !== 'function') return
    void persistSession(sessionId).catch(() => {})
  }, [sessionId])

  const noteInteraction = useCallback(() => {
    setLastInteractionAt(Date.now())
  }, [])

  const changeDesktopSurface = useCallback(async mode => {
    const bridge = window.qwenAudioAgentDesktop
    if (!desktopOrbMode || !bridge?.setSurface) return
    try {
      const result = await bridge.setSurface(mode)
      setDesktopSurfaceMode(result?.mode === 'panel' ? 'panel' : 'orb')
      noteInteraction()
    } catch {
      // A rejected host transition leaves the current presentation intact.
    }
  }, [noteInteraction])

  const triggerSpriteAnimation = useCallback((eventName, { priority = false } = {}) => {
    if (!desktopOrbMode || isBuiltinOrbSkin(orbSkinId)) return
    const name = spriteAnimationForEvent(eventName)
    if (!name) return
    spriteAnimationCueId.current += 1
    const cue = { id: spriteAnimationCueId.current, name }
    setSpriteAnimationCues(current => (
      priority ? [cue, ...current] : [...current, cue]
    ))
  }, [orbSkinId])

  const completeSpriteAnimationCue = useCallback(id => {
    setSpriteAnimationCues(current => (
      current[0]?.id === id ? current.slice(1) : current
    ))
  }, [])

  const respondToPermission = useCallback(async (taskId, permission, decision) => {
    if (!permission?.id || permission.submitting) return
    setAgentTasks(items => upsertTask(
      items,
      taskId,
      task => ({
        ...task,
        authorization: {
          ...task.authorization,
          submitting: true,
          error: null,
        },
      }),
    ))
    try {
      await gatewayCommandsRef.current?.respondPermission(permission.id, decision)
    } catch (error) {
      if (['permission_not_found', 'task_not_found'].includes(error.code)) {
        setAgentTasks(items => upsertTask(
          items,
          taskId,
          task => ({ ...task, authorization: null }),
        ))
        return
      }
      setAgentTasks(items => upsertTask(
        items,
        taskId,
        task => ({
          ...task,
          authorization: task.authorization
            ? {
                ...task.authorization,
                submitting: false,
                error: t('没有提交成功：{message}', { message: error.message }),
              }
            : null,
        }),
      ))
    }
  }, [])

  // Save a persistent "always allow" rule, then allow the task that asked.
  // The Gateway also drains any other waiting request the new rule covers.
  const rememberPermissionRule = useCallback(async (taskId, permission, rule) => {
    if (!permission?.id || permission.submitting) return
    const patch = update => setAgentTasks(items => upsertTask(items, taskId, task => ({
      ...task, authorization: task.authorization ? { ...task.authorization, ...update } : null,
    })))
    patch({ submitting: true, error: null })
    try {
      const response = await gatewayFetch('api/permission-rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rule),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
      patch({ submitting: false })
      setActivity(t('规则已保存：{pattern}', { pattern: payload.rule?.pattern || rule.pattern }))
    } catch (error) {
      patch({ submitting: false, error: error.message })
      return
    }
    await respondToPermission(taskId, permission, 'task')
  }, [respondToPermission])

  const cancelDesktopTask = useCallback(async task => {
    if (task?.phase !== 'scheduled' || !task.id) return
    const cancelTask = gatewayCommandsRef.current?.cancelTask
    if (typeof cancelTask !== 'function') return
    setAgentTasks(items => upsertTask(
      items,
      task.id,
      current => ({ ...current, phase: 'cancelling' }),
    ))
    try {
      const cancelled = await cancelTask(task.id)
      if (!cancelled) return
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => taskView(cancelled, current),
        taskView(cancelled),
      ))
    } catch {
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => current.phase === 'cancelling'
          ? { ...current, phase: 'scheduled' }
          : current,
      ))
    }
  }, [])

  useLayoutEffect(() => {
    const container = messagesRef.current
    if (container && stickToBottom.current) {
      container.scrollTop = container.scrollHeight
    }
  }, [messages, agentTasks])

  useEffect(() => () => {
    taskDismissTimers.current.forEach(timer => clearTimeout(timer))
    taskDismissTimers.current.clear()
  }, [])

  useEffect(() => {
    let cancelled = false
    let refreshTimer
    const refresh = () => gatewayFetch('api/health', { cache: 'no-store' })
      .then(async response => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (cancelled) return
        const gatewayReady = response.ok && payload.ok !== false
        const backendPayload = payload.backend || {}
        const backendEnabled = backendPayload.enabled !== false && Boolean(
          backendPayload.kind || backendPayload.protocol,
        )
        const label = payload.backend?.label || payload.backend?.kind || 'Agent'
        setFrontend({
          label: payload.realtimeLabel || payload.realtimeProvider || 'Realtime Agent',
        })
        setModelStatus(realtimeModelStatus(payload))
        setGatewayRuntime(gatewayReady ? 'ready' : 'failed')
        setBackend({
          label,
          enabled: backendEnabled,
          ready: gatewayReady && (
            backendEnabled ? backendPayload.ok === true : true
          ),
          status: backendPayload.status || (
            backendEnabled ? 'starting' : 'not_configured'
          ),
          code: backendPayload.code || null,
          error: backendPayload.error || '',
          url: payload.backend?.uiPath || payload.backend?.baseUrl || '',
        })
        setActivity(response.ok ? t('Gateway 已连接') : t('能力服务尚未连接'))
        if (desktopOrbMode) {
          const backendSettled = !backendEnabled || [
            'ready',
            'failed',
          ].includes(backendPayload.status)
          refreshTimer = setTimeout(refresh, backendSettled ? 3000 : 500)
        }
      })
      .catch(() => {
        if (cancelled) return
        setGatewayRuntime('failed')
        setActivity(t('qwen-audio-agent Gateway 尚未连接'))
        if (desktopOrbMode) refreshTimer = setTimeout(refresh, 1000)
      })
    refresh()
    return () => {
      cancelled = true
      clearTimeout(refreshTimer)
    }
  }, [])

  const updateUserTranscript = useCallback((event, final = false) => {
    const id = event.turnId ? `user:${event.turnId}` : crypto.randomUUID()
    setMessages(items => upsertUserTranscript(items, {
        id,
        content: event.content,
        turnId: event.turnId,
        final,
      }))
    if (final) noteInteraction()
  }, [noteInteraction])

  const updateVoiceMessage = useCallback((event, final = false) => {
    const responseId = event.responseId || activeVoiceResponse.current
    if (!responseId) return
    activeVoiceResponse.current = responseId
    const id = `voice:${responseId}`
    const trackedTurnId = responseTurnMap.current.get(responseId) || event.turnId || currentTurnId.current
    setMessages(items => upsertAssistantTranscript(items, {
      id,
      content: event.content,
      turnId: trackedTurnId,
      taskId: event.taskId,
      taskIds: event.taskIds,
      origin: event.origin,
      citations: event.citations,
      final,
    }))
  }, [])

  const onRealtimeEvent = useCallback(event => {
    if (sessionIdRef.current !== sessionId) return
    if (event.type === 'turn.activity') setTurnActivities(items => mergeTurnActivities(items, [event.activity], true))
    const animationEvent = spriteAnimationEventForGatewayEvent(event)
    if (animationEvent) {
      triggerSpriteAnimation(animationEvent)
    }
    if (event.type === 'turn.started') {
      currentTurnId.current = event.turnId || ''
      activeVoiceResponse.current = ''
      stickToBottom.current = true
      setActivity(t('正在听你说'))
    }
    if (event.type === 'gateway.disconnected') {
      setActivity(t('qwen-audio-agent Gateway 已断开，正在重连'))
      setAgentTasks(items => items.map(task => (
        [
          'queued',
          'running',
          'delegated',
          'finalizing',
          'cancelling',
          'responding',
        ].includes(task.phase)
          ? { ...task, phase: 'disconnected' }
          : task
      )))
    }
    void applyDesktopClientState(event, {
      desktop: desktopOrbMode,
      bridge: window.qwenAudioAgentDesktop,
      onLifecycle: setDesktopLifecycle,
      lastWakeAt: lastWakeAtRef.current,
    }).catch(() => {})
    if (
      event.type === 'voice.sleep'
      && event.state === 'detected'
      && desktopOrbMode
    ) {
      window.qwenAudioAgentDesktop?.wake()
    }
    if (event.type === 'session.recovered') {
      if (sessionIdRef.current !== sessionId) return
      setMessages(items => mergeConversationHistory(items, event.messages || []))
      const serverTasks = event.tasks || []
      const byId = new Map(serverTasks.map(task => [task.id, task]))
      setAgentTasks(items => {
        const known = new Set(items.map(task => task.id))
        const reconciled = items.flatMap(task => {
          const current = byId.get(task.id)
          if (current && taskDeliverySettled(current)) return []
          if (current) return [taskView(current, task)]
          if (task.phase !== 'disconnected') return [task]
          return [{
            ...task,
            phase: 'failed',
            error: t('网关重连后未找到这次后台执行，请重新提交。'),
          }]
        })
        serverTasks
          .filter(task => taskNeedsPresentation(task) && !known.has(task.id))
          .reverse()
          .forEach(task => reconciled.push(taskView(task)))
        return reconciled
      })
    }
    if (event.type === 'voice.deactivated') {
      setVoiceEnabled(false)
      setWaitingForVoice(false)
      setActivity(t('{holder}正在使用语音', { holder: frontendLabel(event.holder) }))
    }
    if (
      event.type === 'voice.ownership'
      && event.state === 'busy'
      && voiceEnabled
    ) {
      setVoiceEnabled(false)
      setWaitingForVoice(false)
      setActivity(t('{holder}正在使用语音', { holder: frontendLabel(event.holder) }))
    }
    if (event.type === 'voice.ownership' && event.state === 'available') {
      if (shouldClaimReleasedVoice(event, waitingForVoice)) {
        setWaitingForVoice(false)
        setVoiceEnabled(true)
        setActivity(t('正在接入语音'))
      } else if (!voiceEnabled) {
        setActivity(t('待命'))
      }
    }
    if (event.type === 'voice.state') {
      if (
        event.turnId
        && event.turnId !== currentTurnId.current
        && event.origin === 'model'
      ) return
      if (event.state === 'listening') setActivity(t('正在听你说'))
      if (event.state === 'processing' && !agentTurnIds.current.has(currentTurnId.current)) {
        setActivity(t('正在处理'))
      }
      if (event.state === 'idle' && !agentTurnIds.current.has(currentTurnId.current)) {
        setActivity(t('待命'))
      }
    }
    if (event.type === 'transcript.delta' && event.role === 'user') {
      updateUserTranscript(event)
    }
    if (event.type === 'transcript.final' && event.role === 'user') {
      updateUserTranscript(event, true)
    }
    if (event.type === 'transcript.discard' && event.role === 'user') {
      setMessages(items => discardUserTranscript(items, event.turnId))
    }
    if (event.type === 'response.started') {
      activeVoiceResponse.current = event.responseId
      if (event.turnId) {
        responseTurnMap.current.set(event.responseId, event.turnId)
        if (responseTurnMap.current.size > 100) {
          responseTurnMap.current.delete(responseTurnMap.current.keys().next().value)
        }
      }
      if (
        event.turnId === currentTurnId.current
        && !agentTurnIds.current.has(event.turnId)
      ) {
        setActivity(t('正在回复'))
      }
    }
    if (event.type === 'transcript.delta' && event.role === 'assistant') updateVoiceMessage(event)
    if (event.type === 'transcript.final' && event.role === 'assistant') updateVoiceMessage(event, true)
    if (event.type === 'response.interrupted') {
      const id = `voice:${event.responseId}`
      setMessages(items => items.map(message => (
        message.id === id
          ? { ...message, interrupted: true, live: false }
          : message
      )))
    }
    if (event.type === 'task.scheduled') {
      const task = event.task
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => taskView(task, current),
        taskView(task),
      ))
    }
    if (event.type === 'task.accepted') {
      const task = event.task
      if (task.turnId) agentTurnIds.current.add(task.turnId)
      if (!task.turnId || task.turnId === currentTurnId.current) {
        setActivity(t('正在处理'))
      }
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => taskView(task, current),
        taskView(task),
      ))
    }
    if (event.type === 'task.running') {
      const task = event.task
      if (task.turnId) agentTurnIds.current.add(task.turnId)
      if (!task.turnId || task.turnId === currentTurnId.current) {
        setActivity(t('正在处理'))
      }
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => ({
          ...current,
          elapsedMs: task.elapsedMs || 0,
          phase: 'running',
        }),
        {
          id: task.id,
          kind: task.kind,
          objective: task.objective,
          createdAt: task.createdAt,
          startedAt: task.startedAt,
          elapsedMs: task.elapsedMs || 0,
          phase: 'running',
          turnId: task.turnId,
        },
      ))
    }
    if (event.type === 'task.progress') {
      const progress = event.task
      if (!progress.turnId || progress.turnId === currentTurnId.current) {
        setActivity(t('正在处理 · {seconds} 秒', { seconds: Math.round(progress.elapsedMs / 1000) }))
      }
      setAgentTasks(items => upsertTask(
        items,
        progress.id,
        task => taskView(progress, task),
        taskView(progress),
      ))
    }
    if (event.type === 'task.updated') {
      const task = event.task
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => taskView(task, current),
        taskView(task),
      ))
    }
    if (event.type === 'task.delegated') {
      const task = event.task
      if (!task.turnId || task.turnId === currentTurnId.current) {
        setActivity(t('进行中'))
      }
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => taskView(task, current),
        taskView(task),
      ))
    }
    if (
      event.type === 'task.finalizing'
      || event.type === 'task.cancelling'
    ) {
      const task = event.task
      if (!task.turnId || task.turnId === currentTurnId.current) {
        setActivity(event.type === 'task.finalizing'
          ? t('正在整理项目结果')
          : t('正在取消'))
      }
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => taskView(task, current),
        taskView(task),
      ))
    }
    if (
      event.type === 'task.permission.requested'
      || event.type === 'task.permission.resolved'
    ) {
      const task = event.task
      if (event.type === 'task.permission.requested') {
        setActivity(t('等待你的确认'))
      } else {
        setActivity(t('正在继续处理'))
      }
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => taskView(task, current),
        taskView(task),
      ))
    }
    if (event.type === 'task.completed') {
      const completed = event.task
      if (completed.turnId) agentTurnIds.current.delete(completed.turnId)
      if (!completed.turnId || completed.turnId === currentTurnId.current) {
        setActivity(t('正在准备回复'))
      }
      setAgentTasks(items => upsertTask(
        items,
        completed.id,
        task => taskView(completed, task),
        taskView(completed),
      ))
    }
    if (event.type === 'task.notification.delivered') {
      const delivered = event.task
      // Delivery is acknowledged after playback ends. The assistant transcript
      // may already have removed this card, so never upsert it again here.
      setAgentTasks(items => removeDeliveredTask(items, delivered.id))
    }
    if (event.type === 'task.failed') {
      const failed = event.task
      if (failed.turnId) agentTurnIds.current.delete(failed.turnId)
      if (!failed.turnId || failed.turnId === currentTurnId.current) {
        setActivity(t('后台失败：{error}', { error: failed.error }))
      }
      setAgentTasks(items => upsertTask(
        items,
        failed.id,
        task => ({ ...taskView(failed, task), phase: 'failed' }),
        { ...taskView(failed), phase: 'failed' },
      ))
    }
    if (event.type === 'task.cancelled') {
      const cancelled = event.task
      if (cancelled.turnId) agentTurnIds.current.delete(cancelled.turnId)
      if (!cancelled.turnId || cancelled.turnId === currentTurnId.current) {
        setActivity(t('已取消'))
      }
      setAgentTasks(items => upsertTask(
        items,
        cancelled.id,
        task => ({ ...taskView(cancelled, task), phase: 'cancelled' }),
        { ...taskView(cancelled), phase: 'cancelled' },
      ))
      clearTimeout(taskDismissTimers.current.get(cancelled.id))
      taskDismissTimers.current.set(cancelled.id, setTimeout(() => {
        setAgentTasks(items => removeTaskInPhase(
          items,
          cancelled.id,
          'cancelled',
        ))
        setActivity(current => current === t('已取消') ? t('待命') : current)
        taskDismissTimers.current.delete(cancelled.id)
      }, 3000))
    }
    if (event.type === 'transcript.final' && event.role === 'assistant') {
      if (event.turnId === currentTurnId.current) setActivity(t('待命'))
      const presentedTaskIds = new Set(
        event.taskIds?.length ? event.taskIds : [event.taskId].filter(Boolean),
      )
      setAgentTasks(items => items.filter(task => (
        !presentedTaskIds.has(task.id)
        || taskKeepsCard(task)
        || !['responding', 'completed'].includes(task.phase)
      )))
    }
  }, [
    sessionId,
    updateUserTranscript,
    updateVoiceMessage,
    voiceEnabled,
    waitingForVoice,
    triggerSpriteAnimation,
  ])

  // Keep the microphone alive while the desktop orb is hidden and the wake
  // word is enabled, even if the user has muted the realtime conversation.
  // Microphone mute leaves output playback active; wake-word detection still
  // needs a live input stream to resume on "你好千问" while hidden.
  const voiceEnabledForWakeWord = (
    desktopOrbMode
    && desktopLifecycle === 'hidden'
    && wakeWordEnabled
  )
  const voice = useRealtimeVoice({
    sessionId,
    enabled: voiceEnabled || voiceEnabledForWakeWord,
    suspended: desktopOrbMode && desktopLifecycle === 'hidden' && !wakeWordEnabled,
    // Deafen silences playback only; the reply is still generated and its
    // transcript keeps streaming.
    outputMuted: deafened,
    // WebUI and desktop share one control contract: the toggle only changes
    // microphone capture and never closes or interrupts the output stream.
    inputOnlyMute: true,
    wakeWordOnly: voiceEnabledForWakeWord,
    clientType: activeClientType,
    clientLabel: gatewayClientLabel(desktopOrbMode ? t('桌面端') : 'WebUI'),
    clientInstanceId: activeClientInstanceId,
    clientStates: desktopOrbMode ? ['sleeping'] : [],
    onEvent: onRealtimeEvent,
    onInputError: message => {
      setVoiceEnabled(false)
      setWaitingForVoice(false)
      setActivity(message)
    },
    onClientAction: event => performDesktopClientAction(event, {
      desktop: desktopOrbMode,
      bridge: window.qwenAudioAgentDesktop,
      onLifecycle: setDesktopLifecycle,
    }),
    onWakeWordAudio: (audio, sampleRate) => {
      window.qwenAudioAgentDesktop?.acceptWakeWordAudio(audio, sampleRate)
    },
  })
  gatewayCommandsRef.current = voice

  useEffect(() => {
    if (!desktopOrbMode) return undefined
    let cancelled = false
    Promise.all([
      gatewayFetch(`api/conversations/${encodeURIComponent(sessionId)}/messages`, {
        cache: 'no-store',
      }).then(response => response.ok ? response.json() : { messages: [] }),
      gatewayFetch(`api/tasks?sessionId=${encodeURIComponent(sessionId)}`, {
        cache: 'no-store',
      }).then(response => response.ok ? response.json() : { tasks: [] }),
    ]).then(([history, taskResult]) => {
      if (cancelled) return
      setMessages(items => mergeConversationHistory(items, history.messages || []))
      setTurnActivities(items => mergeTurnActivities(items, history.activities || []))
      setAgentTasks(items => {
        const known = new Set(items.map(task => task.id))
        return [
          ...items,
          ...(taskResult.tasks || [])
            .filter(task => taskNeedsPresentation(task) && !known.has(task.id))
            .map(task => taskView(task)),
        ]
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [sessionId, voice.connectionState])
  const lifecycleTransition = (
    desktopOrbMode && desktopLifecycle !== 'active'
  )
  const voiceConnectionError = (
    !lifecycleTransition && voice.connectionState === 'unavailable'
  )
  const desktopRuntime = resolveDesktopRuntime({
    gateway: gatewayRuntime,
    realtime: desktopRealtimeRuntime(voice.connectionState),
    backend: desktopBackendRuntime(backend),
  })
  const desktopHasWorkingTasks = desktopOrbMode && desktopTasksWorking(agentTasks)
  // 统一视觉状态仲裁：生命周期 → 异常 → 对话态 → 后台态。
  // 后台工作态仅在桌面悬浮球展示；等待授权由播报和任务卡片承载，
  // 不占用 Agent 动画状态。WebUI 也由任务卡片承载同类信息。
  const orbVisualState = resolveOrbVisualState({
    lifecycle: desktopLifecycle,
    runtimeState: desktopOrbMode ? desktopRuntime.overall : null,
    connectionError: !desktopOrbMode && voiceConnectionError,
    connecting: !desktopOrbMode
      && voiceEnabled
      && voice.connectionState === 'connecting',
    ownershipBusy: voice.ownership.state === 'busy',
    voiceState: voice.visualState || voice.state,
    tasksWorking: desktopHasWorkingTasks,
  })
  const authorizationTask = agentTasks.find(
    task => task.authorization?.status === 'pending',
  )

  useEffect(() => {
    if (!desktopOrbMode) return
    const current = desktopRuntime.overall
    const presentation = advanceDesktopRuntimePresentation({
      current,
      readyAnnounced: runtimeReadyAnnounced.current,
    })
    runtimeReadyAnnounced.current = presentation.readyAnnounced
    if (presentation.cue) triggerSpriteAnimation(presentation.cue)
  }, [desktopRuntime.overall, triggerSpriteAnimation])

  const desktopCards = useMemo(
    () => desktopOrbMode ? desktopTaskCards(agentTasks) : [],
    [agentTasks],
  )
  useEffect(() => {
    if (!desktopCards.length) setDesktopTasksCollapsed(false)
  }, [desktopCards.length])

  useEffect(() => {
    if (!desktopOrbMode) return undefined
    window.qwenAudioAgentDesktop?.loadSurface?.()
      .then(result => setDesktopSurfaceMode(
        result?.mode === 'panel' ? 'panel' : 'orb',
      ))
      .catch(() => {})
    return undefined
  }, [])

  useEffect(() => {
    if (!desktopOrbMode) return undefined
    return window.qwenAudioAgentDesktop?.onTaskCardPlacement?.(
      setDesktopTaskLayout,
    )
  }, [])

  useEffect(() => {
    if (!desktopOrbMode) return undefined
    window.qwenAudioAgentDesktop?.setTaskCardCount(
      desktopSurfaceMode === 'panel'
        ? desktopCards.length
        : desktopTasksCollapsed ? 0 : desktopCards.length,
    )
    return undefined
  }, [desktopCards.length, desktopSurfaceMode, desktopTasksCollapsed])

  useEffect(() => {
    if (!desktopOrbMode) return undefined
    return () => window.qwenAudioAgentDesktop?.setTaskCardCount(0)
  }, [])
  const ownershipLabel = voice.ownership.holder
    ? frontendLabel(voice.ownership.holder)
    : ''

  const workSettled = desktopWorkSettled({
    tasks: agentTasks,
    voiceState: voice.visualState || voice.state,
  })
  const tasksActive = desktopTasksActive(agentTasks)

  useEffect(() => {
    if (!desktopOrbMode) return
    if (!tasksActive && previousTasksActive.current) {
      const settledAt = Date.now()
      workSettledAtRef.current = settledAt
    }
    previousTasksActive.current = tasksActive
  }, [tasksActive])

  useEffect(() => {
    if (!desktopOrbMode) return undefined
    const bridge = window.qwenAudioAgentDesktop
    if (!bridge) return undefined
    const applyLifecycle = lifecycle => {
      if (!lifecycle?.state) return
      if (
        lifecycle.state === 'waking'
        && previousDesktopLifecycle.current !== 'waking'
      ) {
        triggerSpriteAnimation('wake', { priority: true })
      }
      previousDesktopLifecycle.current = lifecycle.state
      setDesktopLifecycle(lifecycle.state)
      if (lifecycle.state === 'waking') lastWakeAtRef.current = Date.now()
      if (lifecycle.reason === 'activity') noteInteraction()
      if (lifecycle.state === 'hidden') {
        // Main has already collapsed a visible conversation panel before an
        // explicit sleep. Mirror that authoritative surface transition so a
        // later wake cannot render the panel inside the compact orb window.
        setDesktopSurfaceMode('orb')
        setActivity(t('已隐藏'))
      }
      if (lifecycle.state === 'waking') setActivity(t('正在显示悬浮球'))
      if (lifecycle.state === 'active' && lifecycle.reason === 'ready') {
        setActivity(t('待命'))
        noteInteraction()
      }
    }
    const dispose = bridge.onLifecycle(applyLifecycle)
    bridge.loadLifecycle().then(applyLifecycle).catch(() => {})
    const onInteraction = () => noteInteraction()
    window.addEventListener('pointerdown', onInteraction)
    window.addEventListener('keydown', onInteraction)
    return () => {
      dispose()
      window.removeEventListener('pointerdown', onInteraction)
      window.removeEventListener('keydown', onInteraction)
    }
  }, [noteInteraction, triggerSpriteAnimation])

  useEffect(() => {
    if (!desktopOrbMode || desktopLifecycle !== 'waking') return
    // Presence readiness describes whether the desktop surface can finish
    // waking, not whether microphone capture has initialized. Keeping those
    // lifecycles separate prevents a slow/denied microphone from leaving the
    // orb permanently in `waking`, which would also disable inactivity sleep.
    if (desktopCanFinishWaking(voice.connectionState)) {
      window.qwenAudioAgentDesktop?.lifecycleReady()
    }
  }, [
    desktopLifecycle,
    voice.connectionState,
  ])

  // 快捷键/托盘唤起恢复 Gateway presence；Realtime 连接在休眠期间保持。
  const wakeGateway = voice.wake
  const publishClientEvent = voice.publishClientEvent
  useEffect(() => {
    if (!desktopOrbMode || desktopLifecycle !== 'waking') return
    wakeGateway()
  }, [desktopLifecycle, wakeGateway])

  autoHideStateRef.current = {
    desktopLifecycle,
    desktopSurfaceMode,
    lastInteractionAt,
    connectionState: voice.connectionState,
    visualError: voice.visualError,
    workSettled,
  }

  useEffect(() => {
    if (!desktopOrbMode || autoHideSeconds === 0) return undefined
    const check = () => {
      const current = autoHideStateRef.current
      if (!current || current.desktopSurfaceMode === 'panel') return
      if (!desktopCanHide({
        settled: current.workSettled,
        connectionState: current.connectionState,
        visualError: current.visualError,
        lifecycle: current.desktopLifecycle,
      })) return
      const deadline = desktopHideDeadline({
        lastInteractionAt: current.lastInteractionAt,
        workSettledAt: workSettledAtRef.current,
        timeoutSeconds: autoHideSeconds,
      })
      if (
        Date.now() < deadline
        || autoHideRequestedDeadlineRef.current === deadline
      ) return
      if (publishClientEvent('desktop.presence.sleep_requested', {
        idle_ms: autoHideSeconds * 1000,
      })) {
        autoHideRequestedDeadlineRef.current = deadline
      }
    }
    const timer = setInterval(check, 1_000)
    check()
    return () => clearInterval(timer)
  }, [autoHideSeconds, publishClientEvent])

  const modelLabel = (modelStatus.label || t('模型信息不可用'))
    .replace(/\s+Realtime\b/gi, '')
    .trim()

  const switchSession = next => {
    setShowAudioTranscriber(false)
    if (!next || next === sessionIdRef.current) return
    taskDismissTimers.current.forEach(timer => clearTimeout(timer))
    taskDismissTimers.current.clear()
    localStorage.setItem('qwen-audio-agent.session', next)
    sessionIdRef.current = next
    setSessionId(next)
    setMessages([])
    setTurnActivities({})
    setAgentTasks([])
    currentTurnId.current = ''
    activeVoiceResponse.current = ''
    responseTurnMap.current.clear()
    agentTurnIds.current.clear()
    setActivity(t('待命'))
  }

  const resetSession = async () => {
    if (!desktopOrbMode) {
      switchSession(crypto.randomUUID())
      return
    }
    try {
      const response = await gatewayFetch('api/conversations', { method: 'POST' })
      if (!response.ok) throw new Error('create failed')
      const { sessionId: next } = await response.json()
      switchSession(next)
      void refreshSessions()
      setActivity(t('已创建新会话'))
    } catch {
      setActivity('Could not create a chat. Please try again.')
    }
  }

  const setSessionArchived = async (target, archived) => {
    try {
      const response = await gatewayFetch(`api/conversations/${encodeURIComponent(target)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      })
      if (!response.ok) throw new Error('archive failed')
      setSessions(current => current.map(item => (
        item.sessionId === target ? { ...item, archived } : item
      )))
      setActivity(archived ? 'Chat archived.' : 'Chat restored.')
    } catch {
      setActivity('Could not update that chat. Please try again.')
    }
  }

  const setSessionPinned = async (target, pinned) => {
    try {
      const response = await gatewayFetch(`api/conversations/${encodeURIComponent(target)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned }),
      })
      if (!response.ok) throw new Error('pin failed')
      setSessions(current => current.map(item => (
        item.sessionId === target ? { ...item, pinned } : item
      )))
    } catch {
      setActivity('Could not update that chat. Please try again.')
    }
  }

  const saveChatTitle = async (target, value) => {
    if (titleEditFinished.current === target) return
    titleEditFinished.current = target
    setEditingChat(null)
    const title = value.replace(/\s+/gu, ' ').trim().slice(0, 80)
    if (!title) return
    try {
      const response = await gatewayFetch(`api/conversations/${encodeURIComponent(target)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (!response.ok) throw new Error('rename failed')
      setSessions(current => current.map(item => (
        item.sessionId === target ? { ...item, title, titleSource: 'custom' } : item
      )))
    } catch {
      setActivity('Could not rename that chat. Please try again.')
    }
  }

  const deleteSession = async target => {
    const item = sessions.find(entry => entry.sessionId === target)
    const label = item?.title ? `"${item.title}"` : 'this chat'
    if (!window.confirm(`Delete ${label}? This permanently removes its messages and cannot be undone.`)) return
    try {
      const response = await gatewayFetch(`api/conversations/${encodeURIComponent(target)}`, {
        method: 'DELETE',
      })
      if (response.status === 409) {
        const payload = await response.json().catch(() => ({}))
        setActivity(payload.error || 'That chat still has a task running.')
        return
      }
      if (!response.ok && response.status !== 404) throw new Error('delete failed')
      setSessions(current => current.filter(entry => entry.sessionId !== target))
      if (target === sessionIdRef.current) {
        // The open chat is gone; move to a fresh one rather than an empty ghost.
        await resetSession()
      }
      setActivity('Chat deleted.')
    } catch {
      setActivity('Could not delete that chat. Please try again.')
    }
  }

  const enableVoice = () => {
    if (!voice.activateAudio()) return
    if (voice.ownership.state === 'busy') {
      setWaitingForVoice(true)
      setActivity(t('等待{holder}释放语音', { holder: ownershipLabel || t('其他入口') }))
      return
    }
    setWaitingForVoice(false)
    setVoiceEnabled(true)
  }

  const disableVoice = () => {
    setWaitingForVoice(false)
    setVoiceEnabled(false)
    setActivity(t('待命'))
  }

  // Push to talk: hold the configured key (Settings → Application) while the panel is
  // focused to open the mic, release to close it. If the mic was already on, the key does
  // nothing so it can't accidentally mute a hands-free session. Losing window focus
  // mid-hold releases too, so the mic never sticks on.
  const pushToTalkHeld = useRef(false)
  const voiceControlsRef = useRef({ enableVoice, disableVoice, voiceEnabled })
  voiceControlsRef.current = { enableVoice, disableVoice, voiceEnabled }
  // System-wide hook (main process, uiohook-napi): it tells us held/released directly.
  useEffect(() => {
    if (!pushToTalkMode || !pushToTalkGlobal) return undefined
    const subscribe = window.qwenAudioAgentDesktop?.onPushToTalk
    if (typeof subscribe !== 'function') return undefined
    return subscribe(held => {
      if (held) {
        if (pushToTalkHeld.current) return
        pushToTalkHeld.current = true
        setPushToTalkDown(true)
        voiceControlsRef.current.enableVoice()
        return
      }
      if (!pushToTalkHeld.current) return
      pushToTalkHeld.current = false
      setPushToTalkDown(false)
      voiceControlsRef.current.disableVoice()
    })
  }, [pushToTalkMode, pushToTalkGlobal])

  // In-window fallback when the native hook isn't installed: only while the panel is focused.
  useEffect(() => {
    if (!pushToTalkMode || pushToTalkGlobal) return undefined
    const release = () => {
      if (!pushToTalkHeld.current) return
      pushToTalkHeld.current = false
      setPushToTalkDown(false)
      voiceControlsRef.current.disableVoice()
    }
    const onKeyDown = event => {
      if (event.repeat || !matchesAcceleratorDown(event, pushToTalkKey)) return
      event.preventDefault()
      if (pushToTalkHeld.current) return
      pushToTalkHeld.current = true
      setPushToTalkDown(true)
      voiceControlsRef.current.enableVoice()
    }
    const onKeyUp = event => {
      if (!pushToTalkHeld.current || !matchesAcceleratorUp(event, pushToTalkKey)) return
      event.preventDefault()
      release()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', release)
      release()
    }
  }, [pushToTalkKey, pushToTalkGlobal, pushToTalkMode])

  // The rule for push-to-talk mode: the mic is live only while the key is down. Anything
  // else that switches it on (orb click, header button, voice ownership coming back, wake
  // word) is undone immediately, and switching modes resets the mic to the mode's default.
  useEffect(() => {
    if (!desktopOrbMode) return
    if (pushToTalkMode) {
      if (voiceEnabled && !pushToTalkDown) {
        setVoiceEnabled(false)
        setWaitingForVoice(false)
      }
    }
  }, [pushToTalkMode, pushToTalkDown, voiceEnabled])
  const previousPushToTalkMode = useRef(pushToTalkMode)
  useEffect(() => {
    if (previousPushToTalkMode.current === pushToTalkMode) return
    previousPushToTalkMode.current = pushToTalkMode
    if (!desktopOrbMode) return
    if (pushToTalkMode) disableVoice()
    else enableVoice()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushToTalkMode])
  // The deafen key is registered system-wide by the desktop main process.
  useEffect(() => {
    const subscribe = window.qwenAudioAgentDesktop?.onDeafenToggle
    if (typeof subscribe !== 'function') return undefined
    return subscribe(() => setDeafened(value => !value))
  }, [])
  const deafenLabel = deafened
    ? 'Hear the assistant again'
    : 'Deafen: silence the assistant, keep the text'
  const deafenHint = desktopOrbMode && deafenShortcut
    ? `${deafenLabel} (${acceleratorLabel(deafenShortcut, navigator.platform)})`
    : deafenLabel

  const pushToTalkHint = pushToTalkMode
    ? `Hold ${acceleratorLabel(pushToTalkKey, navigator.platform)} to talk${pushToTalkGlobal ? ' (works from any app)' : ' (chat window focused)'}`
    : ''

  // Settings floats over the panel as its own window; the panel blurs itself underneath
  // (a transparent child window can't blur what's behind it).
  useEffect(() => {
    const subscribe = window.qwenAudioAgentDesktop?.onSettingsOverlay
    if (typeof subscribe !== 'function') return undefined
    return subscribe(open => {
      document.documentElement.toggleAttribute('data-settings-open', open)
    })
  }, [])

  // Tray → "Reset floating orb": main has already put the window into orb
  // shape; mirror that here so the page draws the orb, not the panel.
  useEffect(() => {
    const subscribe = window.qwenAudioAgentDesktop?.onSurfaceReset
    if (typeof subscribe !== 'function') return undefined
    return subscribe(payload => {
      setDesktopSurfaceMode(payload?.mode === 'panel' ? 'panel' : 'orb')
      setPanelMaximized(false)
    })
  }, [])

  // The switcher loads the new model while the old one keeps serving; the
  // services only go down for the short "swapping" phase, so voice is left
  // alone until then.
  useEffect(() => {
    const subscribe = window.qwenAudioAgentDesktop?.onLocalModelProgress
    if (typeof subscribe !== 'function') return undefined
    return subscribe(progress => {
      setLocalModelProgress(progress)
      if (progress?.phase === 'swapping') disableVoice()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const changeLocalModel = async modelKey => {
    if (!modelKey || modelKey === localModelKey || localModelSwitching) return
    const switchModel = window.qwenAudioAgentDesktop?.switchLocalModel
    if (typeof switchModel !== 'function') return
    setLocalModelError('')
    setLocalModelWarning('')
    setLocalModelProgress(null)
    setLocalModelSwitching(true)
    setActivity('Loading local model…')
    try {
      const result = await switchModel(modelKey)
      if (!result?.ok) {
        setLocalModelError(result?.error || 'Could not switch models.')
        setActivity('Model switch failed')
      } else {
        setLocalModelKey(result.selectedModelKey || modelKey)
        setLocalModelWarning(result.warning || '')
        setActivity('Local model changed')
      }
    } catch (error) {
      setLocalModelError(error.message || 'Could not switch models.')
      setActivity('Model switch failed')
    } finally {
      setLocalModelSwitching(false)
      setLocalModelProgress(null)
    }
  }

  const changeLocalContext = async value => {
    const contextLength = Number(value)
    if (!contextLength || contextLength === localContextLength || localContextChanging || localModelSwitching) return
    const setContext = window.qwenAudioAgentDesktop?.setLocalModelContext
    if (typeof setContext !== 'function') return
    setLocalModelError('')
    setLocalContextChanging(true)
    try {
      const result = await setContext(contextLength)
      if (!result?.ok) {
        setLocalModelError(result?.error || 'Could not change the context size.')
      }
      if (Number.isFinite(result?.contextLength)) setLocalContextLength(result.contextLength)
    } catch (error) {
      setLocalModelError(error.message || 'Could not change the context size.')
    } finally {
      setLocalContextChanging(false)
      setLocalModelProgress(null)
    }
  }

  const changeLocalVoice = async value => {
    if (!value || value === localVoice || localVoiceChanging || localModelSwitching || localContextChanging) return
    const setVoice = window.qwenAudioAgentDesktop?.setLocalVoice
    if (typeof setVoice !== 'function') return
    setLocalModelError('')
    setLocalVoiceChanging(true)
    try {
      const result = await setVoice(value)
      if (!result?.ok) setLocalModelError(result?.error || 'Could not change the voice.')
      if (typeof result?.voice === 'string') setLocalVoice(result.voice)
    } catch (error) {
      setLocalModelError(error.message || 'Could not change the voice.')
    } finally {
      setLocalVoiceChanging(false)
      setLocalModelProgress(null)
    }
  }

  const localModelBusy = localModelSwitching || localContextChanging || localVoiceChanging

  const localModelProgressText = (() => {
    const progress = localModelProgress
    if (!progress) {
      if (localModelSwitching) return 'Switching…'
      if (localContextChanging) return 'Reloading model…'
      if (localVoiceChanging) return 'Restarting speech with the new voice…'
      return ''
    }
    const name = progress.displayName || progress.modelKey || 'model'
    switch (progress.phase) {
      case 'loading':
        return progress.mode === 'background'
          ? `Loading ${name} in the background — you can keep chatting on the current model.`
          : `Loading ${name} — replies pause until it is ready (not enough VRAM to keep both).`
      case 'swapping': return `Switching services to ${name}…`
      case 'unloading': return 'Freeing the previous model…'
      case 'reloading': return `Reloading with a ${formatContextLength(progress.contextLength)} context…`
      case 'voice': return `Restarting speech with the ${progress.voice} voice — takes about 15 seconds…`
      case 'recovering': return 'Something failed — restoring the previous model…'
      default: return ''
    }
  })()

  // One Stop control for everything in flight in this chat: the spoken/streamed
  // reply and any backend work. Scheduled (future) tasks keep their own cancel
  // on the task card and are deliberately left alone here.
  const ACTIVE_TASK_PHASES = ['queued', 'delegated', 'running', 'responding']
  const activeTasks = agentTasks.filter(task => ACTIVE_TASK_PHASES.includes(task.phase))
  const replyInFlight = voice.state === 'speaking'
    || messages.some(message => message.role !== 'user' && message.live)
  const somethingInFlight = replyInFlight || activeTasks.length > 0
  const stopEverything = async () => {
    if (replyInFlight) voice.interrupt()
    if (!activeTasks.length) return
    setAgentTasks(items => items.map(task => (
      ACTIVE_TASK_PHASES.includes(task.phase) ? { ...task, phase: 'cancelling' } : task
    )))
    const outcomes = await Promise.allSettled(activeTasks.map(task => (
      gatewayFetch(`api/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' })
    )))
    const failed = outcomes.filter(outcome => (
      outcome.status === 'rejected'
      || !(outcome.value.ok || [404, 409].includes(outcome.value.status))
    ))
    if (failed.length) {
      setActivity('Could not stop everything. Please try again.')
      setAgentTasks(items => items.map(task => (
        task.phase === 'cancelling' ? { ...task, phase: 'running' } : task
      )))
      return
    }
    setActivity(t('待命'))
  }

  const sendComposerInput = parts => {
    // Sending is a browser user gesture, so it is also the earliest reliable
    // point to unlock audio playback while the microphone remains muted.
    voice.activateAudio()
    return voice.sendInput(parts)
  }

  const turns = useMemo(
    () => buildConversationTurns(messages, agentTasks),
    [messages, agentTasks],
  )

  const beginOrbDrag = event => {
    const bridge = window.qwenAudioAgentDesktop
    if (!desktopOrbMode || event.button !== 0 || !bridge) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    orbDrag.current = {
      pointerId: event.pointerId,
      lastX: event.screenX,
    }
    setOrbDragging(true)
    setOrbDragDirection('')
    bridge.dragStart(event.screenX, event.screenY)
  }

  const moveOrb = event => {
    const drag = orbDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.screenX - drag.lastX
    if (Math.abs(deltaX) >= 2) {
      setOrbDragDirection(deltaX > 0 ? 'right' : 'left')
      drag.lastX = event.screenX
    }
    window.qwenAudioAgentDesktop?.dragMove(event.screenX, event.screenY)
  }

  const endOrbDrag = event => {
    const drag = orbDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    orbDrag.current = null
    setOrbDragging(false)
    setOrbDragDirection('')
    window.qwenAudioAgentDesktop?.dragEnd()
  }

  // Resize grips around the desktop chat panel. Same screen-coordinate drag
  // contract as the orb move above; the main process clamps and applies it.
  const panelResize = useRef(null)
  const beginPanelResize = edges => event => {
    const bridge = window.qwenAudioAgentDesktop
    if (!desktopOrbMode || event.button !== 0 || typeof bridge?.panelResizeStart !== 'function') return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const drag = { pointerId: event.pointerId, ready: false }
    panelResize.current = drag
    void bridge.panelResizeStart(edges, event.screenX, event.screenY).then(ok => {
      if (panelResize.current === drag) drag.ready = Boolean(ok)
    }).catch(() => { if (panelResize.current === drag) panelResize.current = null })
  }
  const movePanelResize = event => {
    const drag = panelResize.current
    if (!drag?.ready || drag.pointerId !== event.pointerId) return
    window.qwenAudioAgentDesktop?.panelResizeMove(event.screenX, event.screenY)
  }
  const endPanelResize = event => {
    const drag = panelResize.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.ready) window.qwenAudioAgentDesktop?.panelResizeMove(event.screenX, event.screenY)
    panelResize.current = null
    window.qwenAudioAgentDesktop?.panelResizeEnd()
  }
  const PANEL_GRIPS = [
    ['top', { top: true }], ['bottom', { bottom: true }], ['left', { left: true }], ['right', { right: true }],
    ['top-left', { top: true, left: true }], ['top-right', { top: true, right: true }],
    ['bottom-left', { bottom: true, left: true }], ['bottom-right', { bottom: true, right: true }],
  ]

  const handleVoiceOrbClick = () => {
    if (voice.state === 'speaking') {
      voice.interrupt()
      return
    }
    enableVoice()
  }

  if (desktopOrbMode && desktopSurfaceMode === 'orb') {
    return <main className={`desktop-gallery-shell${
      desktopCards.length && !desktopTasksCollapsed ? ' has-task-cards' : ''
    }${desktopTaskLayout.placement === 'above' ? ' tasks-above' : ''}`}
    style={{ '--desktop-orb-offset-x': `${desktopTaskLayout.orbOffsetX}px` }}>
      <div className="desktop-orb-anchor">
        <section
        className={desktopOrbClassName({
          state: orbVisualState,
          enabled: voiceEnabled,
          error: voice.visualError || voiceConnectionError,
          dragging: orbDragging,
          lifecycle: desktopLifecycle,
        })}
        aria-label={`qwen-audio · ${voice.visualError || voiceConnectionError ? t('连接异常') : labelFor(orbVisualState)}`}
        title={
          desktopLifecycle === 'waking'
            ? t('正在显示悬浮球')
            : voice.error
          || (orbVisualState === 'idle' && authorizationTask
            ? taskDetail(authorizationTask)
            : orbVisualState === 'occupied' && ownershipLabel
              ? t('{holder}正在使用语音', { holder: ownershipLabel })
              : labelFor(orbVisualState))
        }
        onPointerEnter={() => triggerSpriteAnimation('hover')}
        onPointerDown={beginOrbDrag}
        onPointerMove={moveOrb}
        onPointerUp={endOrbDrag}
        onPointerCancel={endOrbDrag}
        >
        {isBuiltinOrbSkin(orbSkinId) || spriteOrbFailed
          ? (
              <DesktopFluidOrb
                style={isBuiltinOrbSkin(orbSkinId) ? orbSkinId : 'fluid'}
              />
            )
          : (
              <DesktopSpriteOrb
                skin={orbSkinId}
                state={orbVisualState}
                baseWorking={desktopHasWorkingTasks}
                dragDirection={orbDragDirection}
                cue={spriteAnimationCue}
                onCueComplete={completeSpriteAnimationCue}
                onError={() => setSpriteOrbFailed(true)}
              />
            )}
        <nav
          className="desktop-orb-controls"
          aria-label={t('语音控制')}
          onPointerDown={event => event.stopPropagation()}
        >
          <button
            className={!voiceEnabled ? 'active' : ''}
            onClick={event => {
              event.stopPropagation()
              if (voiceEnabled || waitingForVoice) {
                disableVoice()
                return
              }
              enableVoice()
            }}
            aria-label={
              voiceEnabled
                ? t('麦克风静音')
                : waitingForVoice ? t('取消等待语音') : t('开启麦克风')
            }
            title={
              voiceEnabled
                ? t('麦克风静音')
                : waitingForVoice ? t('取消等待语音') : t('开启麦克风')
            }
          >
            <OrbControlIcon type="microphone" muted={!voiceEnabled} />
          </button>
          <button
            onClick={event => {
              event.stopPropagation()
              void changeDesktopSurface('panel')
            }}
            aria-label={t('打开对话')}
            title={t('打开对话')}
          >
            <OrbControlIcon type="conversation" />
          </button>
          <button
            onClick={event => {
              event.stopPropagation()
              window.qwenAudioAgentDesktop?.openSettings()
            }}
            aria-label={t('设置')}
            title={t('设置')}
          >
            <OrbControlIcon type="settings" />
          </button>
          {desktopCards.length > 0 && <button
            onClick={event => {
              event.stopPropagation()
              setDesktopTasksCollapsed(value => !value)
            }}
            aria-label={desktopTasksCollapsed ? t('展开后台任务') : t('折叠后台任务')}
            title={desktopTasksCollapsed ? t('展开后台任务') : t('折叠后台任务')}
          >
            <OrbControlIcon type="tasks" collapsed={desktopTasksCollapsed} />
          </button>}
          <button
            className="danger"
            onClick={event => {
              event.stopPropagation()
              window.qwenAudioAgentDesktop?.quit()
            }}
            aria-label={t('退出')}
            title={t('退出')}
          >
            <OrbControlIcon type="close" />
          </button>
        </nav>
        </section>
      </div>
      {desktopCards.length > 0 && !desktopTasksCollapsed && <section
        className="desktop-task-stack"
        aria-label={t('后台任务')}
        aria-live="polite"
      >
        {desktopCards.map(task => {
          const detail = taskDetail(task)
          const title = task.delegation?.title || task.objective || taskLabel(task)
          const scheduled = task.phase === 'scheduled'
          const progress = ['completed', 'failed', 'cancelled'].includes(task.phase)
            ? taskLabel(task)
            : detail && detail !== title ? detail : taskLabel(task)
          const plan = task.activity?.findLast(item => item.kind === 'plan')
          const progressRatio = ['completed', 'failed', 'cancelled'].includes(task.phase)
            ? 1
            : plan?.total > 0 ? plan.completed / plan.total : null
          return <article
            key={task.id}
            className={`desktop-task-card ${task.phase}`}
            title={detail}
          >
            <strong>{title}</strong>
            <span className="desktop-task-state">
              <i aria-hidden="true" />
              <small>{progress}</small>
            </span>
            {scheduled && <button
              className="desktop-task-cancel"
              type="button"
              aria-label={t(task.kind === 'reminder' ? '取消提醒' : '取消计划')}
              title={t(task.kind === 'reminder' ? '取消提醒' : '取消计划')}
              onClick={event => {
                event.stopPropagation()
                void cancelDesktopTask(task)
              }}
            >×</button>}
            <span
              className={`desktop-task-progress${progressRatio == null ? '' : ' determinate'}`}
              style={progressRatio == null ? undefined : {
                '--desktop-task-progress': `${Math.max(0, Math.min(1, progressRatio)) * 100}%`,
              }}
              aria-hidden="true"
            />
          </article>
        })}
      </section>}
    </main>
  }

  const revealTaskPath = async path => {
    const reveal = window.qwenAudioAgentDesktop?.revealPath
    if (typeof reveal !== 'function') {
      try { await navigator.clipboard.writeText(path); setActivity('Path copied.') } catch { /* ignore */ }
      return
    }
    try {
      const result = await reveal(path)
      if (result && result.ok === false) setActivity(result.error || 'Could not open that location.')
    } catch (error) {
      setActivity(error?.message || 'Could not open that location.')
    }
  }

  const renderTaskFiles = agentTask => {
    const files = taskFiles(agentTask)
    if (!files.length) return null
    const wrote = files.some(file => file.written)
    return <ul className="task-files" aria-label={wrote ? 'Files created or changed' : 'Files read'}>
      {files.map(file => <li key={file.path} title={file.path}>
        <span className="task-file-name">{file.name}</span>
        <span className="task-file-path">{file.path}</span>
        <button type="button" onClick={() => { void revealTaskPath(file.path) }}>Open folder</button>
      </li>)}
    </ul>
  }

  const renderTask = agentTask => <aside
    key={`task:${agentTask.id}`}
    className={`agent-task ${agentTask.phase}${
      taskHasArtifacts(agentTask) ? ' has-artifacts' : ''
    }${agentTask.authorization?.status === 'pending' ? ' awaiting-permission' : ''}`}
  >
    <span className="task-spinner" aria-hidden="true" />
    <div>
      <b>{taskLabel(agentTask)}</b>
      <small>{taskDetail(agentTask)}</small>
      <TaskArtifacts artifacts={agentTask.artifacts} />
      {renderTaskFiles(agentTask)}
    </div>
    {!['failed', 'disconnected'].includes(agentTask.phase) && <div className="task-controls">
      {agentTask.authorization?.status === 'pending' && <PermissionActions
        authorization={agentTask.authorization}
        onRespond={decision => respondToPermission(
          agentTask.id, agentTask.authorization, decision,
        )}
        onRemember={rule => rememberPermissionRule(agentTask.id, agentTask.authorization, rule)}
      />}
      <time>{Math.max(0, Math.round(agentTask.elapsedMs / 1000))}s</time>
    </div>}
  </aside>

  const renderMessage = message => <article
    key={message.id}
    className={`${message.role}${message.companion ? ' companion' : ''}`}
  >
    <label>{message.role === 'user'
      ? t('你')
      : message.companion ? resultLabel(message) : 'qwen-audio'}</label>
    <MessageContent
      role={message.role}
      content={message.content}
      live={message.live}
      citations={message.citations}
    />
    {message.interrupted && <small className="interrupted">{t('已打断')}</small>}
  </article>

  const knownSessions = sessions.some(item => item.sessionId === sessionId)
    ? sessions
    : [{ sessionId, title: 'New chat', updatedAt: '' }, ...sessions]
  // The open chat always stays in the main list, even if it was archived.
  const visibleSessions = knownSessions.filter(item => !item.archived || item.sessionId === sessionId)
    .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
      || (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0))
  const archivedSessions = knownSessions.filter(item => item.archived && item.sessionId !== sessionId)
  const chatWorking = Object.values(turnActivities).some(isActive)
  const renderChatItem = item => <div
    key={item.sessionId}
    className={`chat-item${item.sessionId === sessionId ? ' active' : ''}${item.archived ? ' archived' : ''}${item.pinned ? ' pinned' : ''}${
      item.sessionId === sessionId && chatWorking ? ' working' : ''
    }`}
  >
    {editingChat?.sessionId === item.sessionId ? <input
      className="chat-title-input"
      aria-label="Chat title"
      maxLength={80}
      value={editingChat.title}
      onChange={event => setEditingChat({ sessionId: item.sessionId, title: event.target.value })}
      onKeyDown={event => {
        if (event.key === 'Enter') void saveChatTitle(item.sessionId, editingChat.title)
        if (event.key === 'Escape') {
          titleEditFinished.current = item.sessionId
          setEditingChat(null)
        }
      }}
      onBlur={() => void saveChatTitle(item.sessionId, editingChat.title)}
      ref={node => node?.focus()}
    /> : <button
      type="button"
      className="chat-item-main"
      onClick={() => switchSession(item.sessionId)}
      onDoubleClick={() => {
        titleEditFinished.current = ''
        setEditingChat({ sessionId: item.sessionId, title: item.title || '' })
      }}
      onKeyDown={event => {
        if (event.key === 'F2') {
          event.preventDefault()
          titleEditFinished.current = ''
          setEditingChat({ sessionId: item.sessionId, title: item.title || '' })
        }
      }}
      aria-current={item.sessionId === sessionId ? 'page' : undefined}
      title={`${item.title || 'New chat'} · Double-click or F2 to rename`}
    >
      <i
        className="chat-item-dot"
        aria-label={item.sessionId === sessionId && chatWorking
          ? 'Working'
          : item.pinned ? 'Pinned' : undefined}
      />
      <span>{item.title || 'New chat'}</span>
    </button>}
    <ChatItemMenu
      pinned={item.pinned}
      archived={item.archived}
      onRename={() => {
        titleEditFinished.current = ''
        setEditingChat({ sessionId: item.sessionId, title: item.title || '' })
      }}
      onTogglePin={() => setSessionPinned(item.sessionId, !item.pinned)}
      onToggleArchive={() => setSessionArchived(item.sessionId, !item.archived)}
      onDelete={() => deleteSession(item.sessionId)}
    />
  </div>

  return <main className={`app${
    desktopOrbMode ? ' desktop-conversation-panel' : ''
  }${
    desktopOrbMode && chatsOpen ? ' with-chat-sidebar' : ''
  }`}>
    {desktopOrbMode && PANEL_GRIPS.map(([side, edges]) => <div
      key={side}
      className={`panel-grip panel-grip-${side}`}
      aria-hidden="true"
      onPointerDown={beginPanelResize(edges)}
      onPointerMove={movePanelResize}
      onPointerUp={endPanelResize}
      onPointerCancel={endPanelResize}
    />)}
    <header>
      <div className="brand"><span aria-hidden="true">ZD</span><div>ZD Voice</div></div>
      <a
        className="backend"
        href={backend.url || undefined}
        target="_blank"
        rel="noreferrer"
        title={backend.url ? t('打开 {label}', { label: backend.label }) : backend.label}
      >
        <i className={backend.ready ? 'ready' : ''} />
        {backend.label}
      </a>
      <div
        className="model-status"
        title={`${frontend.label}\n${modelStatus.id}`}
      >
        <b>{modelLabel}</b>
        {modelStatus.metadataStatus === 'current'
          ? <small>{modelInputModeList(modelStatus.modelInputModes)}</small>
          : <small>{t('模型能力信息不可用')}</small>}
      </div>
      <div className="status" title={pushToTalkHint || undefined}>
        <i className={orbVisualState} /><span>{labelFor(orbVisualState)}</span>
      </div>
      {desktopOrbMode && <button
        className="ghost desktop-chat-toggle"
        onClick={() => setChatsOpen(value => !value)}
        aria-label={chatsOpen ? 'Hide chats' : 'Show chats'}
        aria-expanded={chatsOpen}
        title={chatsOpen ? 'Hide chats' : 'Show chats'}
      ><OrbControlIcon type="conversation" /></button>}
      {/* 资料库入口只在 web 模式给：桌面悬浮球的 header 已经紧到把「新会话」
          压成一个「＋」，再塞一个文字按钮会挤掉语音按钮 */}
      {!desktopOrbMode && (
        <button
          className={`ghost${showKnowledgeLibrary ? ' active' : ''}`}
          onClick={() => setShowKnowledgeLibrary(value => !value)}
          title={t('把本机的手册、规章、教材交给助手')}
        >
          {t('资料库')}
        </button>
      )}
      {!desktopOrbMode && <button
        className="ghost"
        onClick={resetSession}
        aria-label={t('新会话')}
      >{t('新会话')}</button>}
      <button
        className={`ghost deafen${deafened ? ' active' : ''}`}
        onClick={() => setDeafened(value => !value)}
        aria-label={deafenHint}
        aria-pressed={deafened}
        title={deafenHint}
      ><OrbControlIcon type="speaker" muted={deafened} /></button>
      <button
        className={[
          'voice',
          voiceEnabled ? 'active' : '',
          waitingForVoice ? 'waiting' : '',
        ].filter(Boolean).join(' ')}
        aria-label={pushToTalkMode ? pushToTalkHint : voiceEnabled
          ? t('麦克风静音')
          : waitingForVoice ? t('取消等待') : t('开启麦克风')}
        title={pushToTalkMode ? pushToTalkHint : compactVoiceControl
          ? voiceEnabled
            ? t('麦克风静音')
            : waitingForVoice ? t('取消等待') : t('开启麦克风')
          : undefined}
        aria-disabled={pushToTalkMode || undefined}
        onClick={() => {
          if (pushToTalkMode) {
            setActivity(pushToTalkHint)
            return
          }
          if (voiceEnabled || waitingForVoice) {
            disableVoice()
            return
          }
          enableVoice()
        }}
      >
        {compactVoiceControl
          ? <OrbControlIcon type="microphone" muted={!voiceEnabled} />
          : voiceEnabled
            ? t('麦克风静音')
            : waitingForVoice ? t('取消等待') : t('开启麦克风')}
      </button>
      {desktopOrbMode && <div className="window-controls" role="group" aria-label="Window">
        <button
          className="ghost window-control window-control-settings"
          onClick={() => window.qwenAudioAgentDesktop?.openSettings?.()}
          title="Settings"
          aria-label="Settings"
        ><OrbControlIcon type="settings" /></button>
        <button
          className="ghost window-control"
          onClick={() => void window.qwenAudioAgentDesktop?.panelWindowControl?.('minimize')}
          title="Minimise to the floating orb"
          aria-label="Minimise to the floating orb"
        ><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5.5h8" /></svg></button>
        <button
          className="ghost window-control"
          onClick={() => void window.qwenAudioAgentDesktop?.panelWindowControl?.('maximize')
            .then(result => { if (result && typeof result.maximized === 'boolean') setPanelMaximized(result.maximized) })}
          title={panelMaximized ? 'Restore' : 'Maximise'}
          aria-label={panelMaximized ? 'Restore' : 'Maximise'}
        >{panelMaximized
          ? <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5h5.5V7M1.5 3h5.5v5.5H1.5z" /></svg>
          : <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5h7v7h-7z" /></svg>}</button>
        <button
          className="ghost window-control window-control-close"
          onClick={() => void window.qwenAudioAgentDesktop?.panelWindowControl?.('close')}
          title="Close to the tray (Show floating orb from the tray icon, or the shortcut, brings it back)"
          aria-label="Close to the tray"
        ><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /></svg></button>
      </div>}
    </header>

    {desktopOrbMode && chatsOpen && <aside className="chat-sidebar" aria-label="Chats">
      <div className="chat-sidebar-heading">
        <strong>Chats</strong>
        <button onClick={resetSession} title="New chat" aria-label="New chat">＋</button>
      </div>
      <nav className="chat-list" aria-label="Saved chats">
        {visibleSessions.map(renderChatItem)}
        {archivedSessions.length > 0 && <button
          type="button"
          className="chat-archived-toggle"
          onClick={() => setShowArchivedChats(open => !open)}
          aria-expanded={showArchivedChats}
        >{showArchivedChats ? '▾' : '▸'} Archived ({archivedSessions.length})</button>}
        {showArchivedChats && archivedSessions.map(renderChatItem)}
      </nav>
      <button
        type="button"
        className={`audio-transcriber-nav${showAudioTranscriber ? ' active' : ''}`}
        onClick={() => {
          disableVoice()
          setShowAudioTranscriber(true)
        }}
      >Transcribe audio</button>
    </aside>}

    <section className={`workspace${showAudioTranscriber ? ' show-audio-transcriber' : ''}`}>
      {showKnowledgeLibrary && <KnowledgeLibraryPanel
        onClose={() => setShowKnowledgeLibrary(false)}
        getTask={voice.getTask}
      />}
      <div className="hero">
        <button
          className={`orb ${orbVisualState}`}
          onClick={handleVoiceOrbClick}
          aria-label={t('语音交互')}
        >
          <span />
        </button>
        <p>VOICE FRONTEND</p>
        <h1>{t('你说，我来调度。')}</h1>
        <small>{voice.error || activity}</small>
      </div>

      <div
        className="messages"
        ref={messagesRef}
        aria-live="polite"
        onScroll={event => {
          const container = event.currentTarget
          stickToBottom.current = (
            container.scrollHeight - container.scrollTop - container.clientHeight
            < 48
          )
        }}
      >
        {!turns.length && <div className="empty">
          <b>{t('试着说')}</b>
          <span>{t('“帮我查一下今天的 AI 新闻，并整理成三点摘要。”')}</span>
        </div>}
        {turns.map(turn => <section
          key={turn.id}
          className={`conversation-turn${turn.standalone ? ' standalone' : ''}`}
        >
          {turn.beforeActivities.map(renderMessage)}
          {turn.tasks.map(renderTask)}
          {turn.afterActivities.map(renderMessage)}
          <TurnActivity activity={turnActivities[turn.id]} />
        </section>)}
      </div>

      {composerEnabled && <MultimodalComposer
        key={sessionId}
        onSend={sendComposerInput}
        onVisualFrame={voice.sendImageFrame}
        onVisualStop={voice.clearImageBuffer}
        visualStreamSupported={!desktopOrbMode
          && modelStatus.transportInputModes.includes('video')}
        visualStreamAvailable={!desktopOrbMode && voice.imageBufferAvailable}
        voiceInputEnabled={voice.inputReady}
        connectionState={voice.connectionState}
        compact={desktopOrbMode}
        status={<>
          <ComposerModelPicker
            models={localModels}
            value={localModelKey}
            busy={localModelBusy}
            progress={localModelProgressText}
            warning={localModelWarning}
            error={localModelError}
            onChange={changeLocalModel}
            onRefresh={refreshLocalModels}
          />
          <ContextMeter
            activities={turnActivities}
            contextLength={localContextLength}
            contextOptions={localContextOptions}
            contextBusy={localModelBusy}
            onContextChange={changeLocalContext}
          />
        </>}
        onListScreenApps={desktopOrbMode ? window.qwenAudioAgentDesktop?.listScreenApps : null}
        onCaptureScreenApp={desktopOrbMode ? window.qwenAudioAgentDesktop?.captureScreenApp : null}
        busy={somethingInFlight}
        onStop={stopEverything}
      />}

      {desktopOrbMode && showAudioTranscriber && <AudioTranscriber onBack={() => setShowAudioTranscriber(false)} />}

    </section>
  </main>
}

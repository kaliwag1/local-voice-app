const ACTIVE = new Set(['working', 'tools', 'waiting'])
const count = value => Number.isInteger(value) && value >= 0 ? value : null

export function usageCounts(usage) {
  if (!usage || typeof usage !== 'object') return null
  const input = count(usage.input_tokens ?? usage.prompt_tokens)
  const output = count(usage.output_tokens ?? usage.completion_tokens)
  const total = count(usage.total_tokens) ?? (input !== null && output !== null ? input + output : null)
  return input === null && output === null && total === null ? null : { input, output, total }
}

// Observational only: this never executes/cancels tools or changes permissions.
export class TurnActivity {
  constructor({ emit = () => {}, now = Date.now, idleMs = 60000 } = {}) {
    this.emit = emit; this.now = now; this.idleMs = idleMs
    this.turns = new Map(); this.timers = new Map()
  }
  get(turnId) {
    if (!turnId) return null
    if (!this.turns.has(turnId)) {
      for (const old of this.turns.values()) {
        if (ACTIVE.has(old.status)) this.finish(old, 'interrupted', 'A new turn started before this turn produced a final answer.')
      }
      this.turns.set(turnId, { turnId, status: 'working', responses: new Map(), tools: new Map(), reasoning: '', createdAt: this.now(), updatedAt: this.now(), version: 0, stream: { deltas: 0, characters: 0, firstDeltaAt: null, endedAt: null } })
      while (this.turns.size > 100) {
        const key = this.turns.keys().next().value
        clearTimeout(this.timers.get(key)); this.timers.delete(key); this.turns.delete(key)
      }
    }
    return this.turns.get(turnId)
  }
  publish(turn, arm = true) {
    turn.updatedAt = this.now(); turn.version++
    const responses = [...turn.responses.values()]
    const reported = responses.map(r => r.usage).filter(Boolean)
    const sum = field => reported.length && reported.every(u => u[field] !== null) ? reported.reduce((n, u) => n + u[field], 0) : null
    const snapshot = {
      turnId: turn.turnId, status: turn.status, message: turn.message || '',
      createdAt: turn.createdAt, updatedAt: turn.updatedAt, version: turn.version,
      stream: { ...turn.stream },
      responseCount: responses.length,
      tools: [...turn.tools.values()].map(tool => ({ ...tool })),
      reasoning: turn.reasoning, reasoningTruncated: Boolean(turn.reasoningTruncated),
      // `latest` is the newest response that reported usage, kept separate from the
      // sums: every response's prompt already contains the history before it, so
      // adding prompts across a turn counts the same context several times. The
      // context meter needs one request's occupancy, not that total.
      usage: reported.length ? { input: sum('input'), output: sum('output'), total: sum('total'), latest: { ...reported[reported.length - 1] }, reportedResponses: reported.length, complete: responses.length === reported.length } : null,
    }
    try { this.emit(snapshot) } catch { /* activity cannot break a response */ }
    clearTimeout(this.timers.get(turn.turnId))
    if (arm && ACTIVE.has(turn.status)) {
      const timer = setTimeout(() => {
        turn.status = 'waiting'
        turn.message = 'No new activity for 60 seconds. The runtime has not reported completion; you can use Stop.'
        this.publish(turn, false)
      }, this.idleMs)
      timer.unref?.(); this.timers.set(turn.turnId, timer)
    }
  }
  handle(event, context = {}) {
    if (context.origin && !['model', 'agent'].includes(context.origin)) return
    const type = event.type
    const responseId = event.response_id || event.response?.id
    if (!responseId || type === 'response.done') return
    if (!['response.created', 'response.reasoning.delta', 'response.reasoning_text.delta', 'response.reasoning_summary_text.delta', 'response.text.delta', 'response.output_text.delta', 'response.audio_transcript.delta', 'response.output_audio_transcript.delta'].includes(type)) return
    const turn = this.get(context.turnId)
    if (!turn) return
    if (turn.status === 'interrupted') return
    const response = turn.responses.get(responseId) || {}
    turn.responses.set(responseId, response)
    turn.status = 'working'; turn.message = ''
    const streamed = typeof event.delta === 'string' ? event.delta : ''
    if (type.endsWith('.delta') && streamed) {
      turn.stream.deltas += 1
      turn.stream.characters += streamed.length
      turn.stream.firstDeltaAt ??= this.now()
    }
    if (type.includes('reasoning')) {
      const delta = typeof event.delta === 'string' ? event.delta : ''
      const remaining = 24000 - turn.reasoning.length
      turn.reasoning += delta.slice(0, remaining)
      if (delta.length > remaining) turn.reasoningTruncated = true
    } else if (type.endsWith('.delta') && event.delta) response.hasText = true
    // Do not emit every answer token; the transcript already carries that stream.
    if (type === 'response.created' || this.now() - turn.updatedAt >= 500) this.publish(turn)
  }
  tool(event) {
    const turn = this.get(event.turnId)
    if (!turn || !event.callId) return
    if (!turn.tools.has(event.callId) && turn.tools.size >= 100) return
    turn.tools.set(event.callId, {
      callId: event.callId, name: String(event.name || 'tool').replace(/[^\w.:-]/g, '_').slice(0, 80),
      status: ['completed', 'failed'].includes(event.status) ? event.status : 'running',
      ...(Number.isFinite(event.durationMs) ? { durationMs: Math.max(0, event.durationMs) } : {}),
    })
    // Completion may arrive after response.done; don't resurrect a terminal turn.
    if (ACTIVE.has(turn.status)) turn.status = 'tools'
    this.publish(turn)
  }
  done(event, context = {}, { pending = false, terminalTool = false } = {}) {
    if (context.origin && !['model', 'agent'].includes(context.origin)) return
    const turn = this.get(context.turnId)
    if (!turn) return
    const id = event.response?.id || event.response_id
    const response = turn.responses.get(id) || {}
    response.usage = usageCounts(event.response?.usage)
    turn.responses.set(id, response)
    const status = event.response?.status || 'completed'
    // Some speech runtimes synthesize an all-zero usage object when the
    // provider omitted usage. Do not present that placeholder as a measurement.
    if (response.usage?.total === 0) response.usage = null
    if (turn.status === 'interrupted') { this.publish(turn, false); return }
    const hasAnswer = Boolean(response.hasText || context.hasAudio || context.assistantTranscript?.trim())
    if (['failed', 'cancelled', 'incomplete'].includes(status)) {
      this.finish(turn, status === 'cancelled' ? 'interrupted' : 'failed', `The runtime reported ${status}.${hasAnswer ? '' : ' No answer was returned.'}`)
    } else if (pending) {
      turn.status = 'tools'; turn.message = 'Waiting for the model to continue after tools.'; this.publish(turn)
    } else {
      this.finish(turn, hasAnswer ? 'completed' : 'no-answer', hasAnswer ? 'Response complete.' : terminalTool
        ? 'Tool processing stopped without a final answer. The tool policy ended this response; try a narrower request.'
        : 'The runtime finished without returning answer text or audio.')
    }
  }
  finish(turn, status, message) {
    turn.status = status; turn.message = message
    turn.stream.endedAt ??= this.now()
    this.publish(turn, false)
  }
  start(turnId) { const turn = this.get(turnId); if (turn) this.publish(turn) }
  interrupt() { for (const turn of this.turns.values()) if (ACTIVE.has(turn.status)) this.finish(turn, 'interrupted', 'Stopped before a final answer was reported.') }
  fail(turnId) { const turn = this.turns.get(turnId); if (turn) this.finish(turn, 'failed', 'The runtime reported an error. No further activity is expected for this response.') }
  close() {
    for (const turn of this.turns.values()) if (ACTIVE.has(turn.status)) this.finish(turn, 'interrupted', 'Connection closed before a final answer was reported.')
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}

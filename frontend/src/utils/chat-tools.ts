/**
 * chat-tools — pure helpers for rendering gateway `event:'agent'` tool steps.
 *
 * Shared by Chat.vue and useAgentChat.ts. No Vue / DOM dependency: callers own
 * the reactive containers and just feed payloads through these functions.
 */

export interface ToolStep {
  id: string                                  // toolCallId — idempotency key
  runId?: string
  name: string
  input?: unknown                             // from data.args (set once)
  output?: unknown                            // from data.meta
  status: 'running' | 'ok' | 'error'
  ts?: number
}

export interface LiveStatus {
  kind: 'compaction' | 'fallback' | 'lifecycle'
  text: string                                // pre-formatted Chinese hint
  done?: boolean                              // run-phase complete / cleared
}

// ── live tool-call merge (streaming) ─────────────────────────────────────────

/**
 * Merge one `event:'agent'`, `stream:'tool'` payload into a ToolStep[] in place.
 * Returns the same array. No-op for non-tool payloads.
 *
 * First sighting of a toolCallId creates a `running` step; the follow-up event
 * carrying `data.meta` resolves it to `ok` / `error`. Insertion order kept.
 */
export function mergeToolEvent(steps: ToolStep[], payload: unknown): ToolStep[] {
  if (!payload || typeof payload !== 'object') return steps
  const p = payload as Record<string, unknown>
  if (p.stream !== 'tool') return steps

  const data = (p.data && typeof p.data === 'object') ? p.data as Record<string, unknown> : null
  const toolCallId = data && typeof data.toolCallId === 'string' ? data.toolCallId : ''
  if (!toolCallId) return steps

  let step = steps.find(s => s.id === toolCallId)
  if (!step) {
    step = {
      id: toolCallId,
      runId: typeof p.runId === 'string' ? p.runId : undefined,
      name: typeof data!.name === 'string' ? data!.name as string : 'tool',
      status: 'running',
      ts: typeof p.ts === 'number' ? p.ts as number : Date.now(),
    }
    steps.push(step)
  }

  if (typeof data!.name === 'string' && data!.name) step.name = data!.name as string
  if (step.input === undefined && data!.args !== undefined) step.input = data!.args

  if (data!.meta !== undefined) {
    step.output = data!.meta
    step.status = data!.isError ? 'error' : 'ok'
  } else if (data!.isError) {
    step.status = 'error'
  }

  return steps
}

// ── transient run-status (compaction / fallback / lifecycle) ─────────────────

/**
 * Translate a non-tool `event:'agent'` payload into a transient Chinese status.
 * Returns null for `lifecycle` and unrecognised streams (caller ignores those).
 */
export function describeAgentStream(payload: unknown): LiveStatus | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const phase = String(p.phase ?? '').toLowerCase()

  if (p.stream === 'compaction') {
    if (phase === 'complete' || p.completedAt) {
      return { kind: 'compaction', text: '已压缩上下文', done: true }
    }
    if (phase === 'retrying') {
      return { kind: 'compaction', text: '压缩后重试…' }
    }
    return { kind: 'compaction', text: '上下文压缩中…' }
  }

  if (p.stream === 'fallback') {
    const restored = phase === 'restored' || phase === 'recovered' || phase === 'cleared' || phase === 'complete'
    if (restored) {
      return { kind: 'fallback', text: '备用模型已恢复', done: true }
    }
    const model = String(p.active ?? p.selected ?? '备用模型')
    const reason = p.reason ? `（原因 ${String(p.reason)}）` : ''
    return { kind: 'fallback', text: `已切换备用模型 ${model}${reason}` }
  }

  // lifecycle & unknown — drive run state elsewhere, no transient hint
  return null
}

// ── history reconstruction ───────────────────────────────────────────────────

function normType(t: unknown): string {
  return String(t ?? '').toLowerCase().replace(/[-_\s]/g, '')
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? v as Record<string, unknown> : null
}

/**
 * Reconstruct ToolStep[] from a gateway `chat.history` (or session-detail)
 * message array. Returns Map keyed by the array index of the *owning assistant
 * message* — the assistant turn that issued the tool calls.
 *
 * Handles Anthropic (`tool_use` / `tool_result` content blocks), OpenAI
 * (`tool_calls` array + `role:'tool'` messages) and gateway variants.
 */
export function extractToolStepsFromHistory(messages: unknown): Map<number, ToolStep[]> {
  const result = new Map<number, ToolStep[]>()
  if (!Array.isArray(messages)) return result

  const stepById = new Map<string, ToolStep>()
  let lastAssistantIdx = -1

  function bucket(idx: number): ToolStep[] {
    let arr = result.get(idx)
    if (!arr) { arr = []; result.set(idx, arr) }
    return arr
  }

  // Carry the source message timestamp into the reconstructed step so the
  // summary's `<span v-if="step.ts">{{ formatTime(step.ts) }}</span>` keeps
  // rendering after a refresh. Without ts, mid-stream cards show a time and
  // post-refresh cards do not — the visible-state regression the user spotted.
  function upsertUse(id: string, name: string, input: unknown, ownerIdx: number, ts?: number) {
    if (ownerIdx < 0) return
    let step = stepById.get(id)
    if (!step) {
      step = { id, name: name || 'tool', status: 'running', ts }
      stepById.set(id, step)
      bucket(ownerIdx).push(step)
    } else if (name && step.name === 'tool') {
      step.name = name
    }
    if (step.ts === undefined && ts !== undefined) step.ts = ts
    if (step.input === undefined && input !== undefined) step.input = input
  }

  function upsertResult(id: string, output: unknown, isError: unknown, ownerIdx: number, name?: string, ts?: number) {
    let step = stepById.get(id)
    if (!step) {
      if (ownerIdx < 0) return
      step = { id, name: name || 'tool', status: 'running', ts }
      stepById.set(id, step)
      bucket(ownerIdx).push(step)
    }
    if (name && step.name === 'tool') step.name = name
    if (step.ts === undefined && ts !== undefined) step.ts = ts
    if (output !== undefined) step.output = output
    step.status = isError ? 'error' : 'ok'
  }

  messages.forEach((raw, i) => {
    const msg = asRecord(raw)
    if (!msg) return
    const role = String(msg.role ?? '').toLowerCase()
    const isAssistant = role === 'assistant' || role === 'model'
    const isToolMsg = role === 'tool' || role === 'toolresult'
    if (isAssistant) lastAssistantIdx = i
    const ownerIdx = isAssistant ? i : lastAssistantIdx
    // Gateway history puts timestamps under several shapes (epoch ms, ISO
    // string, or a `ts` alias) — normalise to ms so the step card's time
    // chip survives a refresh.
    const tsRaw = msg.timestamp ?? msg.ts ?? msg.createdAt
    const tsMs: number | undefined =
      typeof tsRaw === 'number' ? tsRaw
        : typeof tsRaw === 'string' ? (Number.isFinite(Date.parse(tsRaw)) ? Date.parse(tsRaw) : undefined)
        : undefined

    // OpenAI-style assistant tool_calls
    if (Array.isArray(msg.tool_calls)) {
      for (const rawTc of msg.tool_calls) {
        const tc = asRecord(rawTc)
        if (!tc) continue
        const id = typeof tc.id === 'string' ? tc.id : ''
        if (!id) continue
        const fn = asRecord(tc.function)
        let input: unknown = fn?.arguments ?? tc.arguments
        if (typeof input === 'string') { try { input = JSON.parse(input) } catch { /* keep raw */ } }
        const name = String(fn?.name ?? tc.name ?? 'tool')
        upsertUse(id, name, input, ownerIdx, tsMs)
      }
    }

    // content blocks
    const blocks = Array.isArray(msg.content) ? msg.content : []
    for (const rawBlock of blocks) {
      const b = asRecord(rawBlock)
      if (!b) continue
      const t = normType(b.type)
      if (t === 'tooluse' || t === 'toolcall') {
        const id = String(b.id ?? b.toolCallId ?? b.tool_call_id ?? b.toolUseId ?? '')
        if (!id) continue
        upsertUse(id, String(b.name ?? 'tool'), b.input ?? b.args ?? b.arguments, ownerIdx, tsMs)
      } else if (t === 'toolresult') {
        const id = String(b.tool_use_id ?? b.toolCallId ?? b.tool_call_id ?? b.toolUseId ?? b.id ?? '')
        if (!id) continue
        upsertResult(id, b.content ?? b.output ?? b.result, b.is_error ?? b.isError, ownerIdx, typeof b.name === 'string' ? b.name : undefined, tsMs)
      }
    }

    // role:'tool' / 'toolResult' messages
    if (isToolMsg) {
      const id = String(msg.toolCallId ?? msg.tool_call_id ?? msg.id ?? '')
      if (id) {
        upsertResult(id, msg.content ?? msg.text, msg.isError ?? msg.is_error, ownerIdx, typeof msg.name === 'string' ? msg.name : undefined, tsMs)
      }
    }
  })

  return result
}

// ── display helpers ──────────────────────────────────────────────────────────

export function toolStatusLabel(status: ToolStep['status']): string {
  if (status === 'ok') return '成功'
  if (status === 'error') return '失败'
  return '运行中'
}

/** Render a tool input/output value for the step card body. */
export function formatToolValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v

  // tool_result content is often [{ type:'text', text }] — flatten to text
  if (Array.isArray(v) && v.every(b => b && typeof b === 'object' && 'text' in (b as object))) {
    const joined = v.map(b => String((b as Record<string, unknown>).text ?? '')).join('')
    if (joined) return joined
  }

  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

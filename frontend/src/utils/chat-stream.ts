type ChatField = 'text' | 'reasoning'

function extractTextBlocks(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []

  const chunks: string[] = []
  for (const block of value) {
    if (!block || typeof block !== 'object') continue
    const type = (block as Record<string, unknown>).type
    if (type === 'text' && typeof (block as Record<string, unknown>).text === 'string') {
      chunks.push((block as Record<string, string>).text)
    }
  }
  return chunks
}

function extractReasoningBlocks(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []

  const chunks: string[] = []
  for (const block of value) {
    if (!block || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (record.type === 'thinking' && typeof record.thinking === 'string') chunks.push(record.thinking)
    if (record.type === 'thinking_delta' && typeof record.thinking === 'string') chunks.push(record.thinking)
  }
  return chunks
}

function joinChunks(chunks: string[]): string | null {
  const normalized = chunks.filter(Boolean)
  return normalized.length ? normalized.join('') : null
}

function extractFromStructuredPayload(payload: unknown, field: ChatField): string | null {
  if (typeof payload === 'string') return payload
  if (!payload || typeof payload !== 'object') return null

  const record = payload as Record<string, unknown>
  const delta = record.delta as Record<string, unknown> | undefined
  const message = record.message as Record<string, unknown> | undefined
  const choice = Array.isArray(record.choices) && record.choices[0] && typeof record.choices[0] === 'object'
    ? record.choices[0] as Record<string, unknown>
    : undefined
  const choiceDelta = choice?.delta && typeof choice.delta === 'object'
    ? choice.delta as Record<string, unknown>
    : undefined

  if (field === 'reasoning') {
    return joinChunks([
      typeof record.reasoning_content === 'string' ? record.reasoning_content : '',
      typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : '',
      typeof choiceDelta?.reasoning_content === 'string' ? choiceDelta.reasoning_content : '',
      typeof message?.thinking === 'string' ? message.thinking : '',
      ...extractReasoningBlocks(record.content),
      ...extractReasoningBlocks(message?.content),
      record.type === 'content_block_delta' && delta?.type === 'thinking_delta' && typeof delta.thinking === 'string' ? delta.thinking : '',
    ])
  }

  return joinChunks([
    typeof record.text === 'string' ? record.text : '',
    typeof record.content === 'string' ? record.content : '',
    typeof delta?.text === 'string' ? delta.text : '',
    typeof choiceDelta?.content === 'string' ? choiceDelta.content : '',
    typeof choiceDelta?.text === 'string' ? choiceDelta.text : '',
    typeof message?.text === 'string' ? message.text : '',
    typeof message?.content === 'string' ? message.content : '',
    ...extractTextBlocks(record.content),
    ...extractTextBlocks(message?.content),
    record.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string' ? delta.text : '',
  ])
}

function extractFromMaybeJson(raw: string, field: ChatField): string | null {
  try {
    return extractFromStructuredPayload(JSON.parse(raw), field)
  } catch {
    return null
  }
}

export function normalizeGatewayField(raw: string, field: ChatField): string {
  if (!raw) return ''

  const direct = extractFromMaybeJson(raw, field)
  if (direct != null) return direct

  let sawStreamMarkers = false
  const parts: string[] = []

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed === '[DONE]' || trimmed.startsWith(':') || trimmed.startsWith('event:') || trimmed.startsWith('id:')) {
      sawStreamMarkers = true
      continue
    }

    if (trimmed.startsWith('data:')) {
      sawStreamMarkers = true
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      const extracted = extractFromMaybeJson(payload, field)
      if (extracted != null) parts.push(extracted)
      else if (field === 'text') parts.push(payload)
      continue
    }

    if (raw.includes('data:') || raw.includes('[DONE]')) sawStreamMarkers = true
    if (field === 'text') parts.push(line)
  }

  if (!sawStreamMarkers) return raw
  return parts.join('\n').trim()
}

export function extractGatewayText(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const record = message as Record<string, unknown>

  if (typeof record.text === 'string') return normalizeGatewayField(record.text, 'text')
  if (typeof record.content === 'string') return normalizeGatewayField(record.content, 'text')

  const fromContent = joinChunks(extractTextBlocks(record.content).map(chunk => normalizeGatewayField(chunk, 'text')))
  return fromContent ? normalizeGatewayField(fromContent, 'text') : ''
}

export function extractGatewayReasoning(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const record = message as Record<string, unknown>

  if (typeof record.thinking === 'string') return normalizeGatewayField(record.thinking, 'reasoning')

  const fromContent = joinChunks(extractReasoningBlocks(record.content).map(chunk => normalizeGatewayField(chunk, 'reasoning')))
  return fromContent ? normalizeGatewayField(fromContent, 'reasoning') : ''
}

function overlapSuffixPrefix(current: string, incoming: string): number {
  const max = Math.min(current.length, incoming.length)
  for (let size = max; size > 0; size -= 1) {
    if (current.slice(-size) === incoming.slice(0, size)) return size
  }
  return 0
}

export function mergeStreamText(current: string, incoming: string): string {
  if (!incoming) return current
  if (!current) return incoming
  if (incoming === current) return current
  if (incoming.startsWith(current)) return incoming
  if (current.endsWith(incoming)) return current

  const overlap = overlapSuffixPrefix(current, incoming)
  return current + incoming.slice(overlap)
}

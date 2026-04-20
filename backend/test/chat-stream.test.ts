import { describe, expect, it } from 'vitest'
import {
  extractGatewayReasoning,
  extractGatewayText,
  mergeStreamText,
  normalizeGatewayField,
} from '../../frontend/src/utils/chat-stream.ts'

describe('chat-stream helpers', () => {
  it('strips raw SSE done markers from gateway text payloads', () => {
    expect(normalizeGatewayField('ping\n\ndata: [DONE]\n\n', 'text')).toBe('ping')
  })

  it('extracts text deltas from JSON SSE payloads', () => {
    const message = {
      content: 'data: {"choices":[{"delta":{"content":"pong"}}]}\n\ndata: [DONE]\n\n',
    }
    expect(extractGatewayText(message)).toBe('pong')
  })

  it('extracts reasoning deltas from JSON SSE payloads', () => {
    const message = {
      thinking: 'data: {"choices":[{"delta":{"reasoning_content":"step 1"}}]}\n\ndata: [DONE]\n\n',
    }
    expect(extractGatewayReasoning(message)).toBe('step 1')
  })

  it('merges cumulative and incremental gateway chunks without duplication', () => {
    expect(mergeStreamText('', 'hel')).toBe('hel')
    expect(mergeStreamText('hel', 'hello')).toBe('hello')
    expect(mergeStreamText('hello ', 'world')).toBe('hello world')
    expect(mergeStreamText('hello world', 'world')).toBe('hello world')
  })
})

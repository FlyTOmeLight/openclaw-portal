import type { GatewayRpcClient } from './gateway-rpc.js'

export interface ActivityEvent {
  id: number
  ts: number
  event: string
  payload: any
}

const MAX_BUFFER = 500

// Relays gateway WebSocket events to portal-subscribed clients and keeps a
// small ring buffer for late-joining browsers to backfill on first connect.
export class ActivityStream {
  private buffer: ActivityEvent[] = []
  private nextId = 1
  private clients = new Set<any>()
  private unsubscribe: (() => void) | null = null
  private attached = false

  attach(rpc: GatewayRpcClient) {
    if (this.attached) return
    this.attached = true
    this.unsubscribe = rpc.onGatewayEvent((msg) => {
      if (msg?.type !== 'event') return
      if (msg.event === 'connect.challenge') return
      this.publish(msg.event, msg.payload)
    })
    // Eager-connect: the RPC client only opens the WebSocket on the first
    // request() call. Without a nudge, gateway events never flow through.
    // `heartbeat` is a read-only no-op that's always safe to call.
    ;(rpc as any).request?.('heartbeat', {}).catch(() => {})
  }

  detach() {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.attached = false
  }

  private publish(event: string, payload: any) {
    const item: ActivityEvent = {
      id: this.nextId++,
      ts: Date.now(),
      event,
      payload,
    }
    this.buffer.push(item)
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift()

    const encoded = JSON.stringify({ type: 'activity', data: item })
    for (const c of this.clients) {
      if (c.readyState === 1 /* OPEN */) {
        try { c.send(encoded) } catch {}
      }
    }
  }

  recent(limit = 100, session?: string, since?: number): ActivityEvent[] {
    let arr: ActivityEvent[] = this.buffer
    if (session) arr = arr.filter(e => pickSessionKey(e) === session)
    if (since != null) arr = arr.filter(e => e.ts >= since)
    return arr.slice(-limit)
  }

  sessions(): Array<{ sessionKey: string; agent: string; messageCount: number; toolCount: number; lastTs: number; lastEvent: string }> {
    const map = new Map<string, { sessionKey: string; agent: string; messageCount: number; toolCount: number; lastTs: number; lastEvent: string }>()
    for (const e of this.buffer) {
      const sk = pickSessionKey(e)
      if (!sk) continue
      const agent = pickAgent(sk)
      const existing = map.get(sk) ?? { sessionKey: sk, agent, messageCount: 0, toolCount: 0, lastTs: 0, lastEvent: '' }
      existing.lastTs = e.ts
      existing.lastEvent = e.event
      if (isMessageEvent(e)) existing.messageCount += 1
      if (isToolEvent(e)) existing.toolCount += 1
      map.set(sk, existing)
    }
    return [...map.values()].sort((a, b) => b.lastTs - a.lastTs)
  }

  addClient(client: any) {
    this.clients.add(client)
  }
  removeClient(client: any) {
    this.clients.delete(client)
  }

  bufferSize(): number { return this.buffer.length }
  clientCount(): number { return this.clients.size }
}

function pickSessionKey(e: ActivityEvent): string {
  return e.payload?.sessionKey ?? e.payload?.session?.sessionKey ?? ''
}

function pickAgent(sessionKey: string): string {
  // session key pattern: "agent:<agentId>:..."
  const m = sessionKey.match(/^agent:([^:]+)/)
  return m ? m[1] : sessionKey
}

function isMessageEvent(e: ActivityEvent): boolean {
  if (e.event === 'chat' && e.payload?.state === 'assistantMessage') return true
  if (e.event === 'chat' && e.payload?.state === 'userMessage') return true
  if (e.event === 'message') return true
  return false
}

function isToolEvent(e: ActivityEvent): boolean {
  if (e.event === 'chat' && typeof e.payload?.state === 'string' && e.payload.state.startsWith('tool')) return true
  if (e.event === 'tool' || e.event === 'toolCall' || e.event === 'toolResult') return true
  return false
}

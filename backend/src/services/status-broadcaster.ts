import { WebSocket } from 'ws'

// Per-client buffer threshold. Beyond this the client is assumed slow or dead
// and will be terminated to prevent unbounded memory growth.
const MAX_BUFFERED_BYTES = 1 * 1024 * 1024

export class StatusBroadcaster {
  private clients = new Set<WebSocket>()

  addClient(ws: WebSocket) {
    this.clients.add(ws)
  }

  removeClient(ws: WebSocket) {
    this.clients.delete(ws)
  }

  broadcast(payload: object) {
    const msg = JSON.stringify(payload)
    for (const ws of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) {
        this.clients.delete(ws)
        continue
      }
      if ((ws.bufferedAmount ?? 0) > MAX_BUFFERED_BYTES) {
        this.clients.delete(ws)
        try { ws.terminate() } catch {}
        continue
      }
      try {
        ws.send(msg)
      } catch {
        this.clients.delete(ws)
        try { ws.terminate() } catch {}
      }
    }
  }

  broadcastServiceStatus(state: string, pid?: number) {
    this.broadcast({ type: 'service-status', state, pid })
  }
}

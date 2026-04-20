import { onMounted, onUnmounted } from 'vue'
import { useServiceStore } from '../stores/service.js'

export function useServiceSocket() {
  const svc = useServiceStore()
  let ws: WebSocket | null = null
  let retryTimeout: ReturnType<typeof setTimeout> | null = null
  let retryDelay = 1000
  let destroyed = false

  function connect() {
    if (destroyed) return

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const url = `${protocol}//${location.host}${base}/api/ws`

    ws = new WebSocket(url)

    ws.onopen = () => {
      retryDelay = 1000 // reset backoff on success
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'service-status') {
          svc.state = msg.state
          svc.pid = msg.pid
        }
      } catch {}
    }

    ws.onclose = () => {
      ws = null
      if (!destroyed) {
        retryTimeout = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 1.5, 30000)
          connect()
        }, retryDelay)
      }
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  onMounted(() => connect())

  onUnmounted(() => {
    destroyed = true
    if (retryTimeout) clearTimeout(retryTimeout)
    ws?.close()
  })
}

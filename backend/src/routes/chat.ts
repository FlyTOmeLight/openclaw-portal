import type { FastifyInstance } from 'fastify'
import type { ConfigManager } from '../services/config-manager.js'

// Proxy headers required for OpenClaw trusted-proxy auth
const PROXY_HEADERS = {
  'x-forwarded-user': 'admin',
  'x-forwarded-proto': 'https',
  'x-forwarded-host': 'localhost',
  'content-type': 'application/json',
}

export async function chatRoutes(app: FastifyInstance, configManager: ConfigManager, gatewayPort: number) {
  // Streaming chat completions — proxies to OpenClaw /v1/chat/completions
  app.post<{ Body: { messages: any[]; stream?: boolean } }>(
    '/api/chat/completions',
    async (req, reply) => {
      const cfg = await configManager.read()
      const model = cfg.agents?.defaults?.model?.primary ?? 'openclaw'

      const body = JSON.stringify({
        model,
        messages: req.body.messages,
        stream: req.body.stream ?? true,
        max_tokens: 8192,
      })

      const upstream = await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/completions`, {
        method: 'POST',
        headers: PROXY_HEADERS,
        body,
        // @ts-ignore — Node 22 fetch supports duplex for streaming
        duplex: 'half',
      })

      if (!upstream.ok) {
        const errText = await upstream.text()
        return reply.status(upstream.status).send({ error: errText })
      }

      // Forward content-type (text/event-stream for SSE streams)
      reply.header('content-type', upstream.headers.get('content-type') ?? 'application/json')
      reply.header('cache-control', 'no-cache')
      reply.header('x-accel-buffering', 'no')

      if (!upstream.body) return reply.send('')

      // Pipe stream from OpenClaw → client
      const reader = upstream.body.getReader()
      reply.raw.on('close', () => reader.cancel())

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        reply.raw.write(value)
      }
      reply.raw.end()
    }
  )

  // File content extraction for chat context
  app.post('/api/chat/file', async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'No file' })

    const mimeType = data.mimetype
    const filename = data.filename
    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    // Images: return base64 data URL
    if (mimeType.startsWith('image/')) {
      return {
        type: 'image',
        filename,
        mimeType,
        dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
      }
    }

    // Text files: return content (truncate at 100KB)
    const text = buffer.slice(0, 100 * 1024).toString('utf-8')
    return { type: 'text', filename, mimeType, content: text }
  })
}

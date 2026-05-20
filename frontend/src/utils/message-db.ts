/**
 * IndexedDB-based local message store for portal chat.
 * Keyed by sessionKey (matches gateway session key).
 */

import type { ToolStep } from './chat-tools.js'

const DB_NAME = 'openclaw-portal-messages'
const DB_VERSION = 1
const STORE_MESSAGES = 'messages'

let _db: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db)
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => { _db = req.result; resolve(_db) }
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const store = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' })
        store.createIndex('sessionKey', 'sessionKey', { unique: false })
        store.createIndex('sessionKey_ts', ['sessionKey', 'createdAt'], { unique: false })
      }
    }
  })
}

export interface StoredMessage {
  id: string
  sessionKey: string
  role: 'user' | 'assistant'
  text: string
  reasoning?: string
  steps?: ToolStep[]
  // Token usage as reported by the gateway at chat:final. Persisted so the
  // bubble's "输入 N tok · 输出 N tok" footer survives a refresh — without
  // this it only shows during the live stream window and silently disappears
  // when state.messages is rehydrated from IndexedDB.
  usage?: { input: number; output: number }
  createdAt: number
}

export async function saveMessage(msg: StoredMessage): Promise<void> {
  if (!msg?.id) return
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_MESSAGES, 'readwrite')
    tx.objectStore(STORE_MESSAGES).put(msg)
  } catch (e) {
    console.warn('[message-db] saveMessage error:', e)
  }
}

export async function saveMessages(msgs: StoredMessage[]): Promise<void> {
  if (!msgs?.length) return
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_MESSAGES, 'readwrite')
    const store = tx.objectStore(STORE_MESSAGES)
    for (const msg of msgs) {
      if (msg?.id) store.put(msg)
    }
  } catch (e) {
    console.warn('[message-db] saveMessages error:', e)
  }
}

export async function getLocalMessages(sessionKey: string, limit = 200): Promise<StoredMessage[]> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_MESSAGES, 'readonly')
      const index = tx.objectStore(STORE_MESSAGES).index('sessionKey_ts')
      const range = IDBKeyRange.bound([sessionKey, 0], [sessionKey, Date.now() + 1])
      const msgs: StoredMessage[] = []
      const req = index.openCursor(range, 'prev')
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor && msgs.length < limit) { msgs.push(cursor.value); cursor.continue() }
      }
      tx.oncomplete = () => resolve(msgs.reverse())
      tx.onerror = () => resolve([])
    })
  } catch (e) {
    console.warn('[message-db] getLocalMessages error:', e)
    return []
  }
}

export async function clearSessionMessages(sessionKey: string): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_MESSAGES, 'readwrite')
    const req = tx.objectStore(STORE_MESSAGES).index('sessionKey').openCursor(IDBKeyRange.only(sessionKey))
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) { cursor.delete(); cursor.continue() }
    }
  } catch (e) {
    console.warn('[message-db] clearSessionMessages error:', e)
  }
}

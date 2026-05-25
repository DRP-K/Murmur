import type { ServerEnvelope } from './types'
import { getMessages, getPosts, wsUrl } from './relay'

export type EnvelopeHandler = (env: ServerEnvelope) => void
export type StatusHandler = (status: 'connecting' | 'connected' | 'disconnected') => void

const RECONNECT_DELAY_MS = 5_000
const POLL_INTERVAL_MS = 60_000

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let getToken: (() => string | null) | null = null
let stopped = false

// Multiple subscribers allowed — each page/hook registers independently.
const envelopeListeners = new Set<EnvelopeHandler>()
const statusListeners = new Set<StatusHandler>()

/** Subscribe to incoming ServerEnvelopes. Returns an unsubscribe function. */
export function subscribe(handler: EnvelopeHandler): () => void {
  envelopeListeners.add(handler)
  return () => envelopeListeners.delete(handler)
}

/** Subscribe to connection status changes. Returns an unsubscribe function. */
export function subscribeStatus(handler: StatusHandler): () => void {
  statusListeners.add(handler)
  return () => statusListeners.delete(handler)
}

function notifyEnvelope(env: ServerEnvelope) {
  for (const fn of envelopeListeners) fn(env)
}

function notifyStatus(status: 'connecting' | 'connected' | 'disconnected') {
  for (const fn of statusListeners) fn(status)
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null }
}

function clearPollTimer() {
  if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null }
}

async function poll() {
  const token = getToken?.()
  if (!token) return
  try {
    const [msgRes, postRes] = await Promise.all([getMessages(token), getPosts(token)])
    for (const env of msgRes.messages) notifyEnvelope(env)
    for (const env of postRes.posts) notifyEnvelope(env)
  } catch {
    // Non-fatal — next poll tick or WS drain will catch up.
  }
}

function scheduleReconnect() {
  clearReconnectTimer()
  reconnectTimer = setTimeout(openSocket, RECONNECT_DELAY_MS)
}

function openSocket() {
  if (stopped) return
  const token = getToken?.()
  if (!token) { scheduleReconnect(); return }

  notifyStatus('connecting')
  const ws = new WebSocket(wsUrl(token))
  socket = ws

  ws.onopen = () => {
    notifyStatus('connected')
    // Server drains all pending messages + posts on connect.
    // Belt-and-suspenders poll runs in parallel.
    clearPollTimer()
    pollTimer = setInterval(poll, POLL_INTERVAL_MS)
  }

  ws.onmessage = (event) => {
    try {
      const env = JSON.parse(event.data as string) as ServerEnvelope
      notifyEnvelope(env)
    } catch {
      console.warn('[ws] unparseable message', event.data)
    }
  }

  ws.onclose = () => {
    if (socket === ws) socket = null
    notifyStatus('disconnected')
    clearPollTimer()
    if (!stopped) scheduleReconnect()
  }

  ws.onerror = () => {} // onclose always fires after onerror
}

/**
 * Start the WebSocket connection. No-ops if already connected.
 * Subscribers register separately via `subscribe()` / `subscribeStatus()`.
 */
export function connect(getTokenFn: () => string | null): void {
  if (socket !== null) return
  stopped = false
  getToken = getTokenFn
  openSocket()
}

/** Close the socket and cancel all timers. Clears all subscribers. */
export function disconnect(): void {
  stopped = true
  clearReconnectTimer()
  clearPollTimer()
  socket?.close()
  socket = null
  getToken = null
  envelopeListeners.clear()
  statusListeners.clear()
}

/** Force an immediate reconnect — useful after a token refresh. */
export function reconnect(): void {
  clearReconnectTimer()
  socket?.close()
  socket = null
  openSocket()
}

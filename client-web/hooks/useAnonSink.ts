'use client'

import { useEffect } from 'react'
import * as ws from '@/lib/ws'
import { db } from '@/lib/db'
import { decodePayload } from '@/lib/crypto'
import type { ServerEnvelope } from '@/lib/types'

function parseCompositeId(compositeId: string): { threadId: string; msgId: string } {
  const sep = compositeId.indexOf('|')
  return {
    threadId: compositeId.slice(0, sep),
    msgId: compositeId.slice(sep + 1),
  }
}

/**
 * Creates a local AnonThread record if one doesn't already exist.
 * Called on the post-author's side when they receive an anon message.
 */
export async function ensureAnonThread(
  env: ServerEnvelope & { type: 'message'; msg_type: 'anon' },
) {
  const { threadId } = parseCompositeId(env.id)

  const existing = await db.anonThreads.get(threadId)
  if (existing) return

  const text = decodePayload(env.payload_hex)
  await db.anonThreads.add({
    id: threadId,
    postId: '', // author doesn't know which post — derived from threadId
    postSnippet: text.slice(0, 60), // fallback: first line of the reach-out message
    ephemeralPrivHex: '',
    ephemeralPubHex: '',
    peerId: env.sender_id,
    isInitiator: 0,
    status: 'open',
    createdAt: env.sent_at,
  })
}

/**
 * Hook that subscribes to incoming anon messages over WS and
 * auto-creates the author-side Dexie record. Call from pages
 * that should respond to anon messages in real-time.
 */
export function useAnonSink() {
  useEffect(() => {
    return ws.subscribe((env: ServerEnvelope) => {
      if (env.type !== 'message' || env.msg_type !== 'anon') return
      ensureAnonThread(
        env as ServerEnvelope & { type: 'message'; msg_type: 'anon' },
      ).catch(console.error)
    })
  }, [])
}

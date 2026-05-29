'use client'

import { useEffect } from 'react'
import * as ws from '@/lib/ws'
import { useAppStore } from '@/lib/store'
import { decodePayload } from '@/lib/crypto'
import { ackMessage } from '@/lib/relay'
import type { ServerEnvelope } from '@/lib/types'

function makeConversationId(a: string, b: string): string {
  return [a, b].sort().join('-')
}

/**
 * Global listener for incoming DM messages. Stores them in the Zustand
 * messagesByConv so they survive tab switches regardless of which page
 * the user is on when the message arrives.
 */
export function useMessageSink() {
  const addMessage = useAppStore((s) => s.addMessage)

  useEffect(() => {
    const acking = new Set<string>()

    return ws.subscribe((env: ServerEnvelope) => {
      if (env.type !== 'message' || env.msg_type !== 'dm') return
      const myId = useAppStore.getState().userId
      if (!myId) return
      const convId = makeConversationId(myId, env.sender_id)
      addMessage(convId, {
        id: env.id,
        content: decodePayload(env.payload_hex),
        sentAt: env.sent_at,
        isOwn: env.sender_id === myId,
        status: 'delivered',
      })

      const tok = useAppStore.getState().token
      if (!tok || acking.has(env.id)) return
      acking.add(env.id)
      ackMessage(tok, env.id)
        .catch(() => {})
        .finally(() => acking.delete(env.id))
    })
  }, [addMessage])
}

'use client'

import { useEffect } from 'react'
import * as ws from '@/lib/ws'
import { useAppStore } from '@/lib/store'
import { decodePayload } from '@/lib/crypto'
import { ackGroupMessage } from '@/lib/relay'
import type { ServerEnvelope } from '@/lib/types'

export function useGroupSink() {
  const addGroupMessage = useAppStore((s) => s.addGroupMessage)

  useEffect(() => {
    const acking = new Set<string>()

    return ws.subscribe((env: ServerEnvelope) => {
      if (env.type !== 'group_message') return
      const myId = useAppStore.getState().userId
      if (!myId) return

      addGroupMessage(env.group_id, {
        id: env.id,
        groupId: env.group_id,
        senderId: env.sender_id,
        content: decodePayload(env.payload_hex),
        sentAt: env.sent_at,
        isOwn: env.sender_id === myId,
        status: 'delivered',
      })

      const tok = useAppStore.getState().token
      if (!tok || acking.has(env.id)) return
      acking.add(env.id)
      ackGroupMessage(tok, env.group_id, env.id)
        .catch(() => {})
        .finally(() => acking.delete(env.id))
    })
  }, [addGroupMessage])
}

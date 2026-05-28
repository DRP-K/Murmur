'use client'

import { useEffect } from 'react'
import * as ws from '@/lib/ws'
import { db } from '@/lib/db'
import { ecdh, decodePayload } from '@/lib/crypto'
import { ackMessage } from '@/lib/relay'
import { useAppStore } from '@/lib/store'
import type { ServerEnvelope } from '@/lib/types'

/**
 * Processes a friend_added notification: decodes the JSON payload
 * (user_id + pubkey_hex), computes ECDH, and stores the friend in Dexie.
 */
export async function processFriendAdded(
  env: ServerEnvelope & { type: 'message'; msg_type: 'friend_added' },
) {
  console.log('[friend_sink] processFriendAdded: sender_id=', env.sender_id.slice(0, 8), 'payload_hex len=', env.payload_hex.length)
  const raw = decodePayload(env.payload_hex)
  console.log('[friend_sink] decoded payload:', raw)
  let parsed: { user_id: string; pubkey_hex: string; nickname?: string }
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn('[friend_sink] unparseable payload', raw)
    return
  }

  const { user_id: friendId, pubkey_hex: friendPubkey, nickname } = parsed
  console.log('[friend_sink] parsed friendId=', friendId.slice(0, 8), 'pubkey len=', friendPubkey.length)
  if (!friendId || !friendPubkey) return

  // Already known?
  const existing = await db.friends.get(friendId)
  if (existing) {
    console.log('[friend_sink] friend already exists in Dexie, skipping')
    return
  }

  const identity = await db.identity.toCollection().first()
  if (!identity) {
    console.warn('[friend_sink] no identity in Dexie')
    return
  }

  const shared = ecdh(identity.privkeyHex, friendPubkey)
  await db.friends.put({
    userId: friendId,
    pubkeyHex: friendPubkey,
    dhSharedHex: shared,
    nickname: nickname ?? null,
    metAtEvent: null,
    blockedAt: null,
  })
  console.log('[friend_sink] friend stored in Dexie:', friendId.slice(0, 8))

  const tok = useAppStore.getState().token
  if (tok) ackMessage(tok, env.id).catch(console.error)
}

/**
 * Hook that globally listens for friend_added messages over WS
 * and auto-populates the local Dexie friends table.
 */
export function useFriendSink() {
  useEffect(() => {
    return ws.subscribe((env: ServerEnvelope) => {
      if (env.type !== 'message' || env.msg_type !== 'friend_added') return
      console.log('[friend_sink] WS friend_added received')
      processFriendAdded(
        env as ServerEnvelope & { type: 'message'; msg_type: 'friend_added' },
      ).catch(console.error)
    })
  }, [])
}

'use client'

import { useEffect } from 'react'
import * as ws from '@/lib/ws'
import { useAppStore } from '@/lib/store'
import type { ServerEnvelope } from '@/lib/types'

function toPost(env: ServerEnvelope & { type: 'post' }) {
  return {
    id: env.id,
    author_id: env.author_id,
    content: env.content,
    timestamp: env.timestamp,
    is_own: false,
    category: env.category,
    media_ref_name: env.media_ref_name,
    image_url: env.image_url,
    attachment_url: env.attachment_url,
    attachment_type: env.attachment_type,
    attachments: env.attachments,
    rally_group_id: env.rally_group_id,
    rally_max_members: env.rally_max_members,
    categories: env.categories ?? [],
  }
}

/**
 * Global listener for incoming posts. Adds them to the Zustand post store
 * immediately so the Feed page can display them even if the user was on
 * another tab when the post arrived.
 */
export function usePostSink() {
  const addPost = useAppStore((s) => s.addPost)

  useEffect(() => {
    return ws.subscribe((env: ServerEnvelope) => {
      if (env.type !== 'post') return
      addPost(toPost(env))
    })
  }, [addPost])
}

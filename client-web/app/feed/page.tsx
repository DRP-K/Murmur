'use client'

import { useEffect, useReducer, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { getPosts, createPost, ackPost } from '@/lib/relay'
import * as ws from '@/lib/ws'
import { db } from '@/lib/db'
import { resolveTags } from '@/lib/tags'
import { PostCard } from '@/components/PostCard'
import { ComposeSheet } from '@/components/ComposeSheet'
import { ReachModal } from '@/components/ReachModal'
import { TabBar } from '@/components/TabBar'
import type { Post, ServerEnvelope, MediaItem, CreatePostRequest } from '@/lib/types'

type Reactions = Map<string, Set<string>>

function toggleReaction(prev: Reactions, postId: string, emoji: string): Reactions {
  const next = new Map(prev)
  const set = new Set(next.get(postId) ?? [])
  set.has(emoji) ? set.delete(emoji) : set.add(emoji)
  next.set(postId, set)
  return next
}

function toPost(env: ServerEnvelope & { type: 'post' }, isOwn = false): Post {
  return {
    id: env.id,
    author_id: env.author_id,
    content: env.content,
    timestamp: env.timestamp,
    expires_at: env.expires_at,
    is_own: isOwn,
    category: env.category,
    media_ref_name: env.media_ref_name,
    image_url: env.image_url,
    attachment_url: env.attachment_url,
    attachment_type: env.attachment_type,
    attachments: env.attachments,
    scheduled_at: env.scheduled_at,
  }
}

export default function FeedPage() {
  const bootstrapped = useAppStore((s) => s.bootstrapped)
  const bootstrapError = useAppStore((s) => s.bootstrapError)
  const token = useAppStore((s) => s.token)
  const posts = useAppStore((s) => s.posts)
  const addPosts = useAppStore((s) => s.addPosts)
  const addPost = useAppStore((s) => s.addPost)

  const [reactions, setReactions] = useReducer(
    (state: Reactions, action: { postId: string; emoji: string }) =>
      toggleReaction(state, action.postId, action.emoji),
    new Map(),
  )
  const [composeOpen, setComposeOpen] = useState(false)
  const [reachPost, setReachPost] = useState<Post | null>(null)
  const [activeFilter, setActiveFilter] = useState<string>('all')

  // Fetch pending posts on mount and add to global store.
  useEffect(() => {
    if (!bootstrapped || !token) return
    console.log('[feed] fetching pending posts...')
    getPosts(token)
      .then(({ posts: envelopes }) => {
        console.log('[feed] got', envelopes.length, 'pending posts')
        const loaded: Post[] = []
        const idsToAck: string[] = []
        for (const env of envelopes) {
          if (env.type === 'post') {
            console.log('[feed]   post:', env.id.slice(0, 8), 'from', env.author_id.slice(0, 8))
            loaded.push(toPost(env))
            idsToAck.push(env.id)
          }
        }
        if (loaded.length > 0) addPosts(loaded)
        // Ack to free server resources — post is already in Zustand store.
        for (const id of idsToAck) {
          ackPost(token, id).catch(() => {})
        }
      })
      .catch((err) => console.error('[feed] getPosts failed:', err))
  }, [bootstrapped, token, addPosts])

  // Ack posts that arrive via WS while the feed is open.
  // usePostSink (in BootstrapShell) already adds them to the store.
  useEffect(() => {
    return ws.subscribe((env) => {
      if (env.type !== 'post') return
      const t = useAppStore.getState().token
      if (t) ackPost(t, env.id).catch(() => {})
    })
  }, [])

  async function handlePost(
    content: string,
    expiresAt: number | null,
    audienceTagIds: string[] | null,
    category?: string | null,
    mediaRefName?: string | null,
    imageUrl?: string | null,
    attachments?: MediaItem[] | null,
    scheduledAt?: number | null,
  ) {
    const t = useAppStore.getState().token
    if (!t) throw new Error('not authenticated')

    let recipientIds: string[]
    if (audienceTagIds && audienceTagIds.length > 0) {
      const resolved = await resolveTags(audienceTagIds)
      recipientIds = [...resolved]
    } else {
      const friends = await db.friends.filter((f) => f.blockedAt === null).toArray()
      recipientIds = friends.map((f) => f.userId)
    }

    const id = crypto.randomUUID()
    const timestamp = Math.floor(Date.now() / 1000)

    addPost({ id, author_id: '', content, timestamp, expires_at: expiresAt, is_own: true, category, media_ref_name: mediaRefName, image_url: imageUrl, attachments, scheduled_at: scheduledAt })

    await createPost(t, { id, content, timestamp, expires_at: expiresAt, recipient_ids: recipientIds, category, media_ref_name: mediaRefName, image_url: imageUrl, attachments, scheduled_at: scheduledAt })
  }

  if (!bootstrapped) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        {bootstrapError ? (
          <span className="text-red-500">Error: {bootstrapError}</span>
        ) : (
          <span>Connecting…</span>
        )}
      </div>
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const visiblePosts = posts
    .filter((p) => p.expires_at === null || p.expires_at > now)
    .filter((p) => activeFilter === 'all' || p.category === activeFilter)

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur md:ml-20 landscape:ml-20">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-base font-semibold text-zinc-800">Feed</h1>
          <button
            onClick={() => setComposeOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-white"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-2.5">
          {[
            { key: 'all', label: 'All' },
            { key: 'movies', label: '🎬 Movie' },
            { key: 'music', label: '🎵 Music' },
            { key: 'games', label: '🎮 Game' },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeFilter === f.key
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-3 p-4 pb-16 md:ml-20 md:pb-4 landscape:ml-20 landscape:pb-4">
        {visiblePosts.length === 0 ? (
          <p className="pt-16 text-center text-sm text-zinc-400">
            No posts yet. Be the first to share something.
          </p>
        ) : (
          visiblePosts.map((post) => {
            const r = reactions.get(post.id) ?? new Set()
            return (
              <PostCard
                key={post.id}
                post={post}
                liked={r.has('heart')}
                resonated={r.has('resonate')}
                onToggleLike={() => setReactions({ postId: post.id, emoji: 'heart' })}
                onToggleResonate={() => setReactions({ postId: post.id, emoji: 'resonate' })}
                onReach={() => setReachPost(post)}
              />
            )
          })
        )}
      </main>

      <ComposeSheet
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSubmit={handlePost}
      />

      {reachPost && (
        <ReachModal
          post={reachPost}
          onClose={() => setReachPost(null)}
        />
      )}

      <TabBar />
    </>
  )
}

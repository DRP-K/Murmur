'use client'

import { useEffect, useReducer, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { getPosts, createPost, ackPost } from '@/lib/relay'
import * as ws from '@/lib/ws'
import { db } from '@/lib/db'
import { PostCard } from '@/components/PostCard'
import { ComposeSheet } from '@/components/ComposeSheet'
import { ReachModal } from '@/components/ReachModal'
import { TabBar } from '@/components/TabBar'
import type { Post, ServerEnvelope } from '@/lib/types'

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

  // Subscribe to WS for incoming posts — add to global store + ack.
  useEffect(() => {
    return ws.subscribe((env) => {
      if (env.type !== 'post') return
      const t = useAppStore.getState().token
      addPost(toPost(env))
      if (t) ackPost(t, env.id).catch(() => {})
    })
  }, [addPost])

  async function handlePost(content: string, expiresAt: number | null) {
    const t = useAppStore.getState().token
    if (!t) throw new Error('not authenticated')

    const friends = await db.friends
      .filter((f) => f.blockedAt === null)
      .toArray()
    const recipientIds = friends.map((f) => f.userId)

    const id = crypto.randomUUID()
    const timestamp = Math.floor(Date.now() / 1000)

    // Optimistic insert into global store.
    addPost({ id, author_id: '', content, timestamp, expires_at: expiresAt, is_own: true })

    await createPost(t, { id, content, timestamp, expires_at: expiresAt, recipient_ids: recipientIds })
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
  const visiblePosts = posts.filter(
    (p) => p.expires_at === null || p.expires_at > now,
  )

  return (
    <>
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <h1 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">Feed</h1>
        <button
          onClick={() => setComposeOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
        >
          <Plus size={16} />
        </button>
      </header>

      <main className="flex flex-1 flex-col gap-3 p-4">
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

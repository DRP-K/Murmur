'use client'

import { useEffect, useReducer, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import {
  getPosts,
  createPost,
  ackPost,
  joinGroup,
  getFavouriteCategories,
  addFavouriteCategory,
  removeFavouriteCategory,
} from '@/lib/relay'
import * as ws from '@/lib/ws'
import { db } from '@/lib/db'
import { PostCard } from '@/components/PostCard'
import { ComposeSheet } from '@/components/ComposeSheet'
import { ReachModal } from '@/components/ReachModal'
import { TabBar } from '@/components/TabBar'
import type { Post, ServerEnvelope, MediaItem } from '@/lib/types'

type Reactions = Map<string, Set<string>>

function toggleReaction(prev: Reactions, postId: string, emoji: string): Reactions {
  const next = new Map(prev)
  const set = new Set(next.get(postId) ?? [])
  if (set.has(emoji)) {
    set.delete(emoji)
  } else {
    set.add(emoji)
  }
  next.set(postId, set)
  return next
}

function toPost(env: ServerEnvelope & { type: 'post' }, isOwn = false): Post {
  return {
    id: env.id,
    author_id: env.author_id,
    content: env.content,
    timestamp: env.timestamp,
    is_own: isOwn,
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

export default function FeedPage() {
  const bootstrapped = useAppStore((s) => s.bootstrapped)
  const bootstrapError = useAppStore((s) => s.bootstrapError)
  const token = useAppStore((s) => s.token)
  const posts = useAppStore((s) => s.posts)
  const addPosts = useAppStore((s) => s.addPosts)
  const addPost = useAppStore((s) => s.addPost)
  const upsertGroup = useAppStore((s) => s.upsertGroup)
  const userId = useAppStore((s) => s.userId)
  const favouriteCategories = useAppStore((s) => s.favouriteCategories)
  const setFavouriteCategories = useAppStore((s) => s.setFavouriteCategories)
  const addFavouriteCategoryStore = useAppStore((s) => s.addFavouriteCategory)
  const removeFavouriteCategoryStore = useAppStore((s) => s.removeFavouriteCategory)
  const updatePostCategories = useAppStore((s) => s.updatePostCategories)
  const rescansInProgress = useAppStore((s) => s.rescansInProgress)
  const markRescanInProgress = useAppStore((s) => s.markRescanInProgress)
  const markRescanComplete = useAppStore((s) => s.markRescanComplete)
  const router = useRouter()

  const [reactions, setReactions] = useReducer(
    (state: Reactions, action: { postId: string; emoji: string }) =>
      toggleReaction(state, action.postId, action.emoji),
    new Map(),
  )
  const [composeOpen, setComposeOpen] = useState(false)
  const [reachPost, setReachPost] = useState<Post | null>(null)
  const [activeFilters, setActiveFilters] = useState<Set<string>>(
    () => new Set<string>(),
  )
  const [editingFavourites, setEditingFavourites] = useState(false)
  const [deleteVisibleCategory, setDeleteVisibleCategory] = useState<string | null>(null)
  const [newCategoryInput, setNewCategoryInput] = useState('')
  const newCategoryRef = useRef<HTMLInputElement>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggeredRef = useRef(false)

  // Load favourite categories on mount.
  useEffect(() => {
    if (!bootstrapped || !token) return
    getFavouriteCategories(token)
      .then(setFavouriteCategories)
      .catch(console.error)
  }, [bootstrapped, token, setFavouriteCategories])

  async function handleAddFavourite() {
    const cat = newCategoryInput.trim()
    if (!cat || !token) return
    setNewCategoryInput('')
    addFavouriteCategoryStore(cat)
    markRescanInProgress(cat)
    await addFavouriteCategory(token, cat).catch(() => {
      removeFavouriteCategoryStore(cat)
      markRescanComplete(cat)
    })
  }

  async function handleRemoveFavourite(cat: string) {
    if (!token) return
    setDeleteVisibleCategory(null)
    setActiveFilters((prev) => {
      if (!prev.has(cat)) return prev
      const next = new Set(prev)
      next.delete(cat)
      return next
    })
    removeFavouriteCategoryStore(cat)
    await removeFavouriteCategory(token, cat).catch(() => addFavouriteCategoryStore(cat))
  }

  function startCategoryLongPress(cat: string) {
    clearCategoryLongPress()
    longPressTriggeredRef.current = false
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true
      setDeleteVisibleCategory(cat)
    }, 450)
  }

  function clearCategoryLongPress() {
    if (!longPressTimerRef.current) return
    clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
  }

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
  // Also apply server-pushed category updates and rescan completions.
  useEffect(() => {
    return ws.subscribe((env) => {
      if (env.type === 'post') {
        const t = useAppStore.getState().token
        if (t) ackPost(t, env.id).catch(() => {})
      } else if (env.type === 'post_category_update') {
        updatePostCategories(env.post_id, env.categories)
      } else if (env.type === 'rescan_complete') {
        markRescanComplete(env.category)
      }
    })
  }, [updatePostCategories, markRescanComplete])

  async function handlePost(
    content: string,
    category?: string | null,
    mediaRefName?: string | null,
    imageUrl?: string | null,
    attachments?: MediaItem[] | null,
    rallyMaxMembers?: number | null,
  ) {
    const t = useAppStore.getState().token
    if (!t) throw new Error('not authenticated')

    const friends = await db.friends.filter((f) => f.blockedAt === null).toArray()
    const recipientIds = friends.map((f) => f.userId)

    const id = crypto.randomUUID()
    const groupId = rallyMaxMembers ? crypto.randomUUID() : null
    const timestamp = Math.floor(Date.now() / 1000)

    addPost({
      id,
      author_id: userId ?? '',
      content,
      timestamp,
      is_own: true,
      category,
      media_ref_name: mediaRefName,
      image_url: imageUrl,
      attachments,
      rally_group_id: groupId,
      rally_max_members: rallyMaxMembers,
      categories: [],
    })

    await createPost(t, {
      id,
      content,
      timestamp,
      recipient_ids: recipientIds,
      category,
      media_ref_name: mediaRefName,
      image_url: imageUrl,
      attachments,
      rally: groupId && rallyMaxMembers ? { group_id: groupId, max_members: rallyMaxMembers } : null,
    })

    if (groupId && rallyMaxMembers && userId) {
      upsertGroup({
        id: groupId,
        creatorId: userId,
        title: content.slice(0, 48),
        maxMembers: rallyMaxMembers,
        createdAt: timestamp,
        members: [{ userId, joinedAt: timestamp }],
        lastMessage: '',
        lastAt: timestamp,
        unread: 0,
      })
    }
  }

  async function handleJoinGroup(post: Post) {
    if (!post.rally_group_id) return
    if (post.is_own) {
      router.push(`/chats?group=${encodeURIComponent(post.rally_group_id)}`)
      return
    }
    const ok = window.confirm('Joining this group will show your identity to everyone in the group.')
    if (!ok) return
    const t = useAppStore.getState().token
    if (!t) return
    const group = await joinGroup(t, post.rally_group_id)
    upsertGroup(group)
    router.push(`/chats?group=${encodeURIComponent(group.id)}`)
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

  const allFavActive =
    favouriteCategories.length > 0 && favouriteCategories.every((c) => activeFilters.has(c))

  function toggleFilter(key: string) {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  function toggleAllFavourites() {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (allFavActive) {
        favouriteCategories.forEach((c) => next.delete(c))
      } else {
        favouriteCategories.forEach((c) => next.add(c))
      }
      return next
    })
  }

  const visiblePosts = posts.filter((p) => {
    if (activeFilters.size === 0) return true
    return (p.categories ?? []).some((c) => activeFilters.has(c))
  })

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur md:ml-32 landscape:ml-32">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-base font-semibold text-zinc-800">Feed</h1>
          <button
            onClick={() => setComposeOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-white"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto px-4 pb-2.5">
          {/* All button — clears all filters */}
          <button
            onClick={() => setActiveFilters(new Set())}
            className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeFilters.size === 0
                ? 'bg-zinc-900 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            All
          </button>

          {/* All Favorite — toggles every custom category at once */}
          {favouriteCategories.length > 0 && (
            <button
              onClick={toggleAllFavourites}
              className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                allFavActive
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              ★ All Favorite
            </button>
          )}

          {/* Individual category toggles */}
          {favouriteCategories.map((cat) => {
            const active = activeFilters.has(cat)
            const sorting = rescansInProgress.includes(cat)
            const showMobileDelete = deleteVisibleCategory === cat
            return (
              <span
                key={cat}
                className={`flex flex-shrink-0 items-center rounded-full text-xs font-medium transition-colors ${
                  active
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                <button
                  onClick={() => {
                    if (longPressTriggeredRef.current) {
                      longPressTriggeredRef.current = false
                      return
                    }
                    toggleFilter(cat)
                  }}
                  onPointerDown={() => startCategoryLongPress(cat)}
                  onPointerUp={clearCategoryLongPress}
                  onPointerCancel={clearCategoryLongPress}
                  onPointerLeave={clearCategoryLongPress}
                  title={sorting ? 'Murmur is still sorting posts into this category…' : undefined}
                  className="flex items-center gap-1 rounded-full py-1 pl-3 pr-2"
                >
                  {cat}
                  {sorting && (
                    <span className="inline-block h-2 w-2 animate-spin rounded-full border border-current border-t-transparent" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${cat}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemoveFavourite(cat)
                  }}
                  className={`mr-1 h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-black/10 md:inline-flex landscape:inline-flex ${
                    showMobileDelete ? 'inline-flex' : 'hidden'
                  }`}
                >
                  <X size={10} />
                </button>
              </span>
            )
          })}
          <button
            onClick={() => setEditingFavourites((v) => !v)}
            className="ml-1 flex-shrink-0 rounded-full bg-zinc-100 p-1.5 text-zinc-500 hover:bg-zinc-200"
            title="Edit favourite categories"
          >
            <Plus size={12} />
          </button>
        </div>

        {editingFavourites && (
          <div className="border-t border-zinc-100 px-4 pb-3 pt-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                handleAddFavourite()
              }}
            >
              <input
                ref={newCategoryRef}
                type="text"
                value={newCategoryInput}
                onChange={(e) => setNewCategoryInput(e.target.value)}
                placeholder="Add category…"
                maxLength={50}
                className="min-w-0 flex-1 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs outline-none focus:border-zinc-400"
              />
              <button
                type="submit"
                className="flex-shrink-0 rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white"
              >
                Add
              </button>
            </form>
          </div>
        )}
      </header>

      <main className="flex flex-1 flex-col gap-3 p-4 pb-16 md:ml-32 md:pb-4 landscape:ml-32 landscape:pb-4">
        {rescansInProgress.some((c) => activeFilters.has(c)) && (
          <p className="text-center text-xs text-zinc-400">
            Murmur is still sorting some posts into your selected categories…
          </p>
        )}
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
                onJoinGroup={() => handleJoinGroup(post).catch(console.error)}
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

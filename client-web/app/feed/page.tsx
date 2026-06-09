'use client'

import { useEffect, useReducer, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, X } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import {
  getPosts,
  createPost,
  ackPost,
  joinGroup,
} from '@/lib/relay'
import * as ws from '@/lib/ws'
import { db } from '@/lib/db'
import { normalizePostTag } from '@/lib/postTags'
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
    tags: env.tags ?? [],
    image_url: env.image_url,
    attachment_url: env.attachment_url,
    attachment_type: env.attachment_type,
    attachments: env.attachments,
    rally_group_id: env.rally_group_id,
    rally_max_members: env.rally_max_members,
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
  const router = useRouter()

  const [reactions, setReactions] = useReducer(
    (state: Reactions, action: { postId: string; emoji: string }) =>
      toggleReaction(state, action.postId, action.emoji),
    new Map(),
  )
  const [composeOpen, setComposeOpen] = useState(false)
  const [reachPost, setReachPost] = useState<Post | null>(null)
  const [favoritePostTags, setFavoritePostTags] = useState<string[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [resultQuery, setResultQuery] = useState<string | null>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  const [customTagInput, setCustomTagInput] = useState('')
  const [deleteVisibleTag, setDeleteVisibleTag] = useState<string | null>(null)
  const searchBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchDropdownRef = useRef<HTMLDivElement>(null)
  const tagLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tagLongPressTriggeredRef = useRef(false)

  // Load local favourite post tags on mount.
  useEffect(() => {
    if (!bootstrapped) return
    db.favoritePostTags.orderBy('createdAt').reverse().toArray()
      .then((rows) => setFavoritePostTags(rows.map((row) => row.tag)))
      .catch(console.error)
  }, [bootstrapped])

  async function addFavoritePostTag(tag: string) {
    const normalized = normalizePostTag(tag)
    if (!normalized || favoritePostTags.includes(normalized)) return
    setFavoritePostTags((prev) => [normalized, ...prev])
    await db.favoritePostTags.put({ tag: normalized, createdAt: Date.now() }).catch(console.error)
  }

  function keepSearchDropdownOpen() {
    if (searchBlurTimerRef.current) clearTimeout(searchBlurTimerRef.current)
    setSearchFocused(true)
  }

  async function removeFavoritePostTag(tag: string) {
    setDeleteVisibleTag(null)
    setFavoritePostTags((prev) => prev.filter((value) => value !== tag))
    await db.favoritePostTags.delete(tag).catch(console.error)
  }

  async function touchFavoritePostTags(tags: string[]) {
    const existing = tags.filter((tag) => favoritePostTags.includes(tag))
    if (existing.length === 0) return
    const now = Date.now()
    setFavoritePostTags((prev) => [
      ...existing,
      ...prev.filter((tag) => !existing.includes(tag)),
    ])
    await Promise.all(
      existing.map((tag, index) =>
        db.favoritePostTags.put({ tag, createdAt: now - index }).catch(console.error),
      ),
    )
  }

  function startTagLongPress(tag: string) {
    clearTagLongPress()
    tagLongPressTriggeredRef.current = false
    tagLongPressTimerRef.current = setTimeout(() => {
      tagLongPressTriggeredRef.current = true
      setDeleteVisibleTag(tag)
    }, 450)
  }

  function clearTagLongPress() {
    if (!tagLongPressTimerRef.current) return
    clearTimeout(tagLongPressTimerRef.current)
    tagLongPressTimerRef.current = null
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
  useEffect(() => {
    return ws.subscribe((env) => {
      if (env.type === 'post') {
        const t = useAppStore.getState().token
        if (t) ackPost(t, env.id).catch(() => {})
      }
    })
  }, [])

  async function handlePost(
    content: string,
    tags: string[],
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
      tags,
      image_url: imageUrl,
      attachments,
      rally_group_id: groupId,
      rally_max_members: rallyMaxMembers,
    })

    await createPost(t, {
      id,
      content,
      timestamp,
      recipient_ids: recipientIds,
      tags,
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

  function extractSearchParts(query: string): { tags: string[]; terms: string[] } {
    const tags: string[] = []
    const terms: string[] = []
    for (const part of query.trim().split(/\s+/).filter(Boolean)) {
      if (part.startsWith('#')) {
        const tag = normalizePostTag(part)
        if (tag && !tags.includes(tag)) tags.push(tag)
      } else {
        terms.push(part.toLowerCase())
      }
    }
    return { tags, terms }
  }

  function setSearchTag(tag: string, selected: boolean) {
    const normalized = normalizePostTag(tag)
    if (!normalized) return
    const parts = extractSearchParts(searchInput)
    const nextTags = selected
      ? parts.tags.filter((value) => value !== normalized)
      : [...parts.tags, normalized]
    setSearchInput([...parts.terms, ...nextTags].join(' '))
  }

  function runSearch(query: string) {
    const trimmed = query.trim()
    if (!trimmed) {
      setResultQuery(null)
      setSearchInput('')
      return
    }
    setSearchInput(trimmed)
    setResultQuery(trimmed)
    setSearchFocused(false)
    touchFavoritePostTags(extractSearchParts(trimmed).tags)
  }

  function matchesSearch(post: Post, query: string): boolean {
    const { tags, terms } = extractSearchParts(query)
    if (tags.length === 0 && terms.length === 0) return true
    const content = post.content.toLowerCase()
    const tagsMatch = tags.every((tag) => post.tags.includes(tag))
    const textMatch = terms.every((term) => content.includes(term))
    return tagsMatch && textMatch
  }

  const visiblePosts = resultQuery
    ? posts.filter((post) => matchesSearch(post, resultQuery))
    : posts
  const selectedSearchTags = extractSearchParts(searchInput).tags

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur md:ml-32 landscape:ml-32">
        <div className="px-4 py-3">
          <h1 className="text-base font-semibold text-zinc-800">Feed</h1>
        </div>
        <div className="px-4 pb-2.5">
          <div className="relative">
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault()
                runSearch(searchInput)
              }}
            >
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onFocus={() => {
                  if (searchBlurTimerRef.current) clearTimeout(searchBlurTimerRef.current)
                  setSearchFocused(true)
                }}
                onBlur={() => {
                  searchBlurTimerRef.current = setTimeout(() => {
                    if (searchDropdownRef.current?.contains(document.activeElement)) return
                    setSearchFocused(false)
                  }, 120)
                }}
                placeholder="Search posts or tags"
                className="w-full rounded-full border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-9 text-sm text-zinc-800 outline-none focus:border-zinc-400"
              />
              {(searchInput || resultQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('')
                    setResultQuery(null)
                    setSearchFocused(false)
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </form>
            {searchFocused && (
              <div
                ref={searchDropdownRef}
                className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg"
                onMouseDown={keepSearchDropdownOpen}
                onFocus={keepSearchDropdownOpen}
              >
              <div className="mb-2 flex flex-wrap gap-1.5">
                {favoritePostTags.map((tag) => (
                  <span
                    key={tag}
                    className={`inline-flex items-center rounded-md border text-xs font-medium ${
                      selectedSearchTags.includes(tag)
                        ? 'border-zinc-900 bg-zinc-900 text-white'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-700'
                    }`}
                  >
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        if (tagLongPressTriggeredRef.current) {
                          tagLongPressTriggeredRef.current = false
                          return
                        }
                        setSearchTag(tag, selectedSearchTags.includes(tag))
                      }}
                      onPointerDown={() => startTagLongPress(tag)}
                      onPointerUp={clearTagLongPress}
                      onPointerCancel={clearTagLongPress}
                      onPointerLeave={clearTagLongPress}
                      className="px-2 py-1"
                    >
                      {tag}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${tag}`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        removeFavoritePostTag(tag)
                      }}
                      className={`mr-1 h-4 w-4 items-center justify-center rounded-sm hover:bg-black/10 md:inline-flex landscape:inline-flex ${
                        deleteVisibleTag === tag ? 'inline-flex' : 'hidden'
                      }`}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {favoritePostTags.length === 0 && (
                  <span className="px-1 py-1 text-xs text-zinc-400">No saved tags.</span>
                )}
              </div>
              <form
                className="flex gap-1.5 border-t border-zinc-100 pt-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  addFavoritePostTag(customTagInput)
                  setCustomTagInput('')
                }}
              >
                <input
                  value={customTagInput}
                  onChange={(e) => setCustomTagInput(e.target.value)}
                  onFocus={keepSearchDropdownOpen}
                  placeholder="Add favorite keyword"
                  maxLength={50}
                  className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-800 outline-none focus:border-zinc-400"
                />
                <button
                  type="submit"
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-zinc-900 text-white"
                  aria-label="Add favorite keyword"
                >
                  <Plus size={13} />
                </button>
              </form>
            </div>
          )}
          </div>
          {favoritePostTags.length > 0 && (
            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
              {favoritePostTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => runSearch(tag)}
                  className="flex-shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-400"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-3 p-4 pb-16 md:ml-32 md:pb-4 landscape:ml-32 landscape:pb-4">
        {resultQuery && (
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Results for {resultQuery}</span>
            <button
              type="button"
              onClick={() => {
                setResultQuery(null)
                setSearchInput('')
              }}
              className="rounded-full border border-zinc-200 px-2.5 py-1 text-zinc-600 hover:border-zinc-400"
            >
              Back to feed
            </button>
          </div>
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
                onTagClick={(tag) => runSearch(tag)}
                onFavoriteTag={(tag) => addFavoritePostTag(tag)}
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

      <button
        onClick={() => setComposeOpen(true)}
        className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg md:bottom-6 landscape:bottom-6"
        aria-label="Create post"
      >
        <Plus size={22} />
      </button>

      <TabBar />
    </>
  )
}

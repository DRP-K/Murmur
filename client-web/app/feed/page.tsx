'use client'

import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
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
import { normalizePostTag, fuzzyMatchTag } from '@/lib/postTags'
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
  const [searchHistory, setSearchHistory] = useState<string[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [resultQuery, setResultQuery] = useState<string | null>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  const searchBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchDropdownRef = useRef<HTMLDivElement>(null)

  const allPostTags = useMemo(() => {
    const tagSet = new Set<string>()
    for (const post of posts) {
      for (const tag of post.tags) {
        tagSet.add(tag)
      }
    }
    return Array.from(tagSet).sort()
  }, [posts])

  // Load search history on mount.
  useEffect(() => {
    if (!bootstrapped) return
    db.searchHistory.orderBy('searchedAt').reverse().limit(5).toArray()
      .then((rows) => setSearchHistory(rows.map((row) => row.query)))
      .catch(console.error)
  }, [bootstrapped])

  function keepSearchDropdownOpen() {
    if (searchBlurTimerRef.current) clearTimeout(searchBlurTimerRef.current)
    setSearchFocused(true)
  }

  async function addToSearchHistory(query: string) {
    if (!query) return
    setSearchHistory((prev) => [query, ...prev.filter((q) => q !== query)].slice(0, 5))
    await db.searchHistory.put({ query, searchedAt: Date.now() }).catch(console.error)
    const all = await db.searchHistory.orderBy('searchedAt').toArray().catch(() => [])
    if (all.length > 5) {
      const toDelete = all.slice(0, all.length - 5).map((e) => e.query)
      await db.searchHistory.bulkDelete(toDelete).catch(console.error)
    }
  }

  async function removeFromSearchHistory(query: string) {
    setSearchHistory((prev) => prev.filter((q) => q !== query))
    await db.searchHistory.delete(query).catch(console.error)
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

  function getActiveSuggestions(input: string): string[] {
    const currentTags = extractSearchParts(input).tags
    const available = allPostTags.filter(tag => !currentTags.includes(tag))
    const words = input.split(/\s+/)
    const lastWord = words[words.length - 1] ?? ''
    if (lastWord && !input.endsWith(' ')) {
      // Typing: fuzzy-matched tags first, then the rest
      const matched = available.filter(tag => fuzzyMatchTag(tag, lastWord))
      const rest = available.filter(tag => !fuzzyMatchTag(tag, lastWord))
      return [...matched, ...rest].slice(0, 15)
    }
    return available.slice(0, 15)
  }

  function applySuggestion(tag: string) {
    const words = searchInput.trim().split(/\s+/).filter(Boolean)
    const withoutLast = words.slice(0, -1)
    setSearchInput([...withoutLast, tag].join(' '))
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
    addToSearchHistory(trimmed)
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
  const tagSuggestions = getActiveSuggestions(searchInput)

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
                onChange={(e) => { setSearchInput(e.target.value); setSearchFocused(true) }}
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
                className={`w-full rounded-full border border-zinc-200 bg-zinc-50 py-2 pl-9 text-sm text-zinc-800 outline-none focus:border-zinc-400 ${searchInput || resultQuery ? 'pr-9' : ''}`}
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
              {tagSuggestions.length > 0 && (
                <div className="mb-2">
                  <div className="mb-1 px-1 text-xs text-zinc-400">Suggestions</div>
                  <div className="flex flex-wrap gap-1.5">
                    {tagSuggestions.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          applySuggestion(tag)
                        }}
                        className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-400 hover:bg-zinc-100"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {searchHistory.length > 0 && (
                <div className={tagSuggestions.length > 0 ? 'border-t border-zinc-100 pt-2' : ''}>
                  <div className="mb-1 px-1 text-xs text-zinc-400">Recent</div>
                  <div className="flex flex-col gap-0.5">
                    {searchHistory.map((query) => (
                      <div key={query} className="flex items-center gap-1">
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            runSearch(query)
                          }}
                          className="flex-1 truncate rounded-md px-2 py-1 text-left text-xs text-zinc-700 hover:bg-zinc-100"
                        >
                          {query}
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${query}`}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            removeFromSearchHistory(query)
                          }}
                          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-sm text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {searchHistory.length === 0 && tagSuggestions.length === 0 && (
                <span className="px-1 py-1 text-xs text-zinc-400">No recent searches.</span>
              )}
            </div>
          )}
          </div>
          {searchHistory.length > 0 && (
            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
              {searchHistory.map((query) => (
                <button
                  key={query}
                  type="button"
                  onClick={() => runSearch(query)}
                  className="flex-shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-400"
                >
                  {query}
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

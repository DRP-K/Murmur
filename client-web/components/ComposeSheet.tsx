'use client'

import { useEffect, useState } from 'react'
import { X, Send, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import { db, type LocalTag } from '@/lib/db'
import { PostSuggestions, type SelectedSuggestion } from './PostSuggestions'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (
    content: string,
    expiresAt: number | null,
    audienceTagIds: string[] | null,
    category?: string | null,
    mediaRefName?: string | null,
    imageUrl?: string | null,
  ) => Promise<void>
}

const CATEGORY_EMOJI: Record<string, string> = { movies: '🎬', music: '🎵', games: '🎮' }

const EXPIRY_OPTIONS = [
  { label: 'Never', value: null },
  { label: '24 hours', value: 86400 },
  { label: '7 days', value: 604800 },
]

export function ComposeSheet({ open, onClose, onSubmit }: Props) {
  const [content, setContent] = useState('')
  const [expirySeconds, setExpirySeconds] = useState<number | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allTags, setAllTags] = useState<LocalTag[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set())
  const [audienceOpen, setAudienceOpen] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [mediaCategory, setMediaCategory] = useState<string | null>(null)
  const [mediaRefName, setMediaRefName] = useState<string | null>(null)
  const [mediaImageUrl, setMediaImageUrl] = useState<string | null>(null)

  useEffect(() => {
    if (open) db.tags.orderBy('name').toArray().then(setAllTags)
  }, [open])

  if (!open) return null

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev)
      next.has(tagId) ? next.delete(tagId) : next.add(tagId)
      return next
    })
  }

  function audienceLabel() {
    if (selectedTagIds.size === 0) return 'Everyone'
    const names = allTags.filter((t) => selectedTagIds.has(t.id)).map((t) => t.name)
    return names.join(', ')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    setSending(true)
    setError(null)
    try {
      const expiresAt = expirySeconds ? Math.floor(Date.now() / 1000) + expirySeconds : null
      const tagIds = selectedTagIds.size > 0 ? [...selectedTagIds] : null
      await onSubmit(content.trim(), expiresAt, tagIds, mediaCategory, mediaRefName, mediaImageUrl)
      setContent('')
      setExpirySeconds(null)
      setSelectedTagIds(new Set())
      setAudienceOpen(false)
      setMediaCategory(null)
      setMediaRefName(null)
      setMediaImageUrl(null)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl dark:bg-zinc-900 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-500">New anonymous post</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="relative">
            <textarea
              autoFocus
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What's on your mind?"
              rows={4}
              maxLength={500}
              className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-3 pr-10 text-sm text-zinc-800 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              type="button"
              onClick={() => setShowSuggestions((v) => !v)}
              title="Get inspired"
              className={`absolute right-2 top-2 rounded-lg p-1.5 transition-colors ${
                showSuggestions
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
              }`}
            >
              <Sparkles size={15} />
            </button>
          </div>

          {mediaRefName && (
            <div className="flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs dark:bg-zinc-800">
              <span>{CATEGORY_EMOJI[mediaCategory ?? ''] ?? ''} {mediaRefName}</span>
              <button
                type="button"
                onClick={() => { setMediaCategory(null); setMediaRefName(null); setMediaImageUrl(null) }}
                className="ml-auto text-zinc-400 hover:text-zinc-600"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {showSuggestions && (
            <PostSuggestions
              onSelect={(s: SelectedSuggestion) => {
                setContent(s.text)
                setMediaCategory(s.category)
                setMediaRefName(s.mediaRefName)
                setMediaImageUrl(s.imageUrl)
                setShowSuggestions(false)
              }}
            />
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 dark:text-zinc-500">Expires:</span>
              <select
                value={expirySeconds ?? ''}
                onChange={(e) => setExpirySeconds(e.target.value ? Number(e.target.value) : null)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={String(o.value)} value={o.value ?? ''}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <span className="text-xs text-zinc-400">{content.length}/500</span>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={sending || !content.trim()}
            className="flex items-center justify-center gap-2 rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            <Send size={14} />
            {sending ? 'Posting…' : 'Post'}
          </button>
        </form>
      </div>
    </div>
  )
}

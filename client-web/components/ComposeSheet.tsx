'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Send, Hash, Image as ImageIcon, Users } from 'lucide-react'
import { db, type LocalTag } from '@/lib/db'
import { assistPost, uploadMedia } from '@/lib/relay'
import { useAppStore } from '@/lib/store'
import { fetchMediaImage, PostSuggestions, type Category, type SelectedSuggestion } from './PostSuggestions'
import type { MediaItem } from '@/lib/types'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_VIDEO_BYTES = 50 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm']

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
    attachments?: MediaItem[] | null,
    scheduledAt?: number | null,
    rallyMaxMembers?: number | null,
  ) => Promise<void>
}

const CATEGORY_EMOJI: Record<string, string> = { movies: '🎬', music: '🎵', games: '🎮' }

const EXPIRY_OPTIONS = [
  { label: 'Never', value: null },
  { label: '24 hours', value: 86400 },
  { label: '7 days', value: 604800 },
]

interface AssistSuggestion {
  requestedPrefix: string
  completedContent: string
  category: Category | null
  mediaRefName: string | null
}

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
  const [assistSuggestion, setAssistSuggestion] = useState<AssistSuggestion | null>(null)
  const [assisting, setAssisting] = useState(false)
  const [applyingAssistMedia, setApplyingAssistMedia] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [scheduleMode, setScheduleMode] = useState<'now' | '+1h' | '+4h' | '+1d' | 'custom'>('now')
  const [customSchedule, setCustomSchedule] = useState<string>('')
  const [postMode, setPostMode] = useState<'anonymous' | 'rally'>('anonymous')
  const [rallyMaxMembers, setRallyMaxMembers] = useState(4)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const assistRequestRef = useRef(0)
  const contentRef = useRef('')

  useEffect(() => {
    if (!open) return
    db.tags.orderBy('name').toArray().then(setAllTags)
    setShowSuggestions(true)
  }, [open])

  if (!open) return null

  const expandedSuggestion =
    assistSuggestion && assistSuggestion.completedContent !== content
      ? assistSuggestion.completedContent
      : ''
  const canRephrase = content.trim().split(/\s+/).filter(Boolean).length >= 2

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!fileInputRef.current) return
    const files = Array.from(e.target.files ?? [])
    fileInputRef.current.value = ''
    if (files.length === 0) return

    const validFiles: File[] = []
    const validUrls: string[] = []
    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        setError('Unsupported file type. Use JPEG, PNG, GIF, WEBP, MP4, or WEBM.')
        continue
      }
      const isVideo = file.type.startsWith('video/')
      if (isVideo && file.size > MAX_VIDEO_BYTES) {
        setError('Video must be under 50 MB.')
        continue
      }
      if (!isVideo && file.size > MAX_IMAGE_BYTES) {
        setError('Image must be under 10 MB.')
        continue
      }
      validFiles.push(file)
      validUrls.push(URL.createObjectURL(file))
    }

    if (validFiles.length > 0) {
      setError(null)
      setPendingFiles((prev) => [...prev, ...validFiles].slice(0, 4))
      setPreviewUrls((prev) => [...prev, ...validUrls].slice(0, 4))
    }
  }

  function clearAttachment(index: number) {
    setPreviewUrls((prev) => {
      URL.revokeObjectURL(prev[index])
      return prev.filter((_, i) => i !== index)
    })
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  function setContentValue(value: string) {
    contentRef.current = value
    setContent(value)
  }

  function resolveScheduledAt(): number | null {
    const now = Math.floor(Date.now() / 1000)
    if (scheduleMode === '+1h') return now + 3600
    if (scheduleMode === '+4h') return now + 4 * 3600
    if (scheduleMode === '+1d') return now + 86400
    if (scheduleMode === 'custom' && customSchedule) {
      const t = Math.floor(new Date(customSchedule).getTime() / 1000)
      return t > now ? t : null
    }
    return null
  }

  function handleContentChange(value: string) {
    setContentValue(value)
    setAssistSuggestion((suggestion) => {
      if (!suggestion) return null
      if (suggestion.requestedPrefix !== value.trim()) return null
      return suggestion
    })
  }

  async function requestAssist() {
    const outline = contentRef.current.trim()
    if (outline.split(/\s+/).filter(Boolean).length < 2) {
      setError('Type at least a few words first.')
      return
    }
    const token = useAppStore.getState().token
    if (!token) {
      setError('not authenticated')
      return
    }

    const requestId = assistRequestRef.current + 1
    assistRequestRef.current = requestId
    setAssisting(true)
    setError(null)
    try {
      const suggestion = await assistPost(token, outline)
      if (assistRequestRef.current !== requestId) return
      const current = contentRef.current.trim()
      if (current !== outline) return
      setAssistSuggestion({
        requestedPrefix: current,
        completedContent: suggestion.completed_content,
        category: suggestion.category,
        mediaRefName: suggestion.media_ref_name,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Expansion failed')
    } finally {
      if (assistRequestRef.current === requestId) setAssisting(false)
    }
  }

  function applyAssistText() {
    if (!assistSuggestion) return
    setContentValue(assistSuggestion.completedContent)
    setAssistSuggestion((suggestion) => {
      if (!suggestion?.category || !suggestion.mediaRefName) return null
      return {
        ...suggestion,
        requestedPrefix: suggestion.completedContent,
        completedContent: suggestion.completedContent,
      }
    })
  }

  async function applyAssistMedia() {
    if (!assistSuggestion?.category || !assistSuggestion.mediaRefName) return
    const category = assistSuggestion.category
    const mediaRefName = assistSuggestion.mediaRefName
    setMediaCategory(category)
    setMediaRefName(mediaRefName)
    setMediaImageUrl(null)
    setAssistSuggestion((suggestion) =>
      suggestion ? { ...suggestion, category: null, mediaRefName: null } : null,
    )
    setApplyingAssistMedia(true)
    try {
      const imageUrl = await fetchMediaImage(category, mediaRefName)
      setMediaImageUrl(imageUrl)
    } catch {
      setMediaImageUrl(null)
    } finally {
      setApplyingAssistMedia(false)
    }
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) {
        next.delete(tagId)
      } else {
        next.add(tagId)
      }
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
      let attachments: MediaItem[] | null = null

      if (pendingFiles.length > 0) {
        const token = useAppStore.getState().token
        if (!token) throw new Error('not authenticated')
        const results = await Promise.all(pendingFiles.map((f) => uploadMedia(token, f)))
        attachments = results.map((r) => ({ url: r.url, media_type: r.media_type }))
      }

      const expiresAt = expirySeconds ? Math.floor(Date.now() / 1000) + expirySeconds : null
      const tagIds = selectedTagIds.size > 0 ? [...selectedTagIds] : null
      const scheduledAt = resolveScheduledAt()
      await onSubmit(
        content.trim(),
        expiresAt,
        tagIds,
        mediaCategory,
        mediaRefName,
        mediaImageUrl,
        attachments,
        scheduledAt,
        postMode === 'rally' ? rallyMaxMembers : null,
      )
      setContentValue('')
      setExpirySeconds(null)
      setSelectedTagIds(new Set())
      setAudienceOpen(false)
      setMediaCategory(null)
      setMediaRefName(null)
      setMediaImageUrl(null)
      setAssistSuggestion(null)
      previewUrls.forEach((u) => URL.revokeObjectURL(u))
      setPendingFiles([])
      setPreviewUrls([])
      setScheduleMode('now')
      setCustomSchedule('')
      setPostMode('anonymous')
      setRallyMaxMembers(4)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-500">
            {postMode === 'rally' ? 'New rally post' : 'New anonymous post'}
          </span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
            <X size={18} />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 p-1">
            <button
              type="button"
              onClick={() => setPostMode('anonymous')}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                postMode === 'anonymous' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
              }`}
            >
              Anonymous
            </button>
            <button
              type="button"
              onClick={() => setPostMode('rally')}
              className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                postMode === 'rally' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
              }`}
            >
              <Users size={13} />
              Rally
            </button>
          </div>

          <div className="relative">
            <textarea
              autoFocus
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder="What's on your mind?"
              rows={4}
              maxLength={500}
              className="relative w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-3 pr-24 text-sm leading-normal text-zinc-800 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
            <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
              <button
                type="button"
                onClick={requestAssist}
                disabled={assisting || !canRephrase}
                title="Rephrase post"
                className={`rounded-lg border px-2 py-1 text-[10px] font-semibold transition-colors ${
                  assisting
                    ? 'border-zinc-200 bg-zinc-100 text-zinc-400'
                    : canRephrase
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'border-zinc-200 bg-zinc-100 text-zinc-300'
                }`}
              >
                {assisting ? '...' : 'Rephrase'}
              </button>
              <button
                type="button"
                onClick={() => setShowSuggestions((v) => !v)}
                title="Choose category"
                className={`rounded-lg border p-1.5 transition-colors ${
                  showSuggestions
                    ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-900'
                }`}
              >
                <Hash size={15} />
              </button>
            </div>
          </div>

          {(expandedSuggestion || (assistSuggestion?.category && assistSuggestion.mediaRefName)) && (
            <div className="flex flex-col gap-2">
              {expandedSuggestion && (
                <button
                  type="button"
                  onClick={applyAssistText}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-sm leading-relaxed text-emerald-800 hover:bg-emerald-100"
                >
                  {expandedSuggestion}
                </button>
              )}
              {assistSuggestion?.category && assistSuggestion.mediaRefName && (
                <button
                  type="button"
                  onClick={applyAssistMedia}
                  disabled={applyingAssistMedia}
                  className="self-start rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-200 disabled:opacity-60"
                >
                  {CATEGORY_EMOJI[assistSuggestion.category]} {assistSuggestion.mediaRefName}
                  {applyingAssistMedia ? ' ...' : ''}
                </button>
              )}
            </div>
          )}

          {pendingFiles.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {pendingFiles.map((file, i) => (
                <div key={i} className="relative flex-shrink-0 h-24 w-24 overflow-hidden rounded-xl border border-zinc-200">
                  {file.type.startsWith('video/') ? (
                    <video src={previewUrls[i]} className="h-full w-full object-cover bg-black" />
                  ) : (
                    <img src={previewUrls[i]} alt="" className="h-full w-full object-cover" />
                  )}
                  <button
                    type="button"
                    onClick={() => clearAttachment(i)}
                    className="absolute right-1 top-1 rounded-full bg-black/50 p-0.5 text-white hover:bg-black/70"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {mediaRefName && (
            <div className="flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs">
              <span>{CATEGORY_EMOJI[mediaCategory ?? ''] ?? ''} {mediaRefName}</span>
              <button
                type="button"
                onClick={() => {
                  setMediaCategory(null)
                  setMediaRefName(null)
                  setMediaImageUrl(null)
                  setShowSuggestions(true)
                }}
                className="ml-auto text-zinc-400 hover:text-zinc-600"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {showSuggestions && (
            <PostSuggestions
              onSelect={(s: SelectedSuggestion) => {
                setContentValue(s.text)
                setMediaCategory(s.category)
                setMediaRefName(s.mediaRefName)
                setMediaImageUrl(s.imageUrl)
                setAssistSuggestion(null)
                setShowSuggestions(false)
              }}
            />
          )}

          {postMode === 'rally' && (
            <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-zinc-600">
                <Users size={14} />
                <span>Group size</span>
              </div>
              <select
                value={rallyMaxMembers}
                onChange={(e) => setRallyMaxMembers(Number(e.target.value))}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 focus:outline-none"
              >
                {Array.from({ length: 19 }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>{n} people</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Expires:</span>
              <select
                value={expirySeconds ?? ''}
                onChange={(e) => setExpirySeconds(e.target.value ? Number(e.target.value) : null)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 focus:outline-none"
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={String(o.value)} value={o.value ?? ''}>
                    {o.label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Add image or video"
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  pendingFiles.length > 0
                    ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900'
                }`}
              >
                <ImageIcon size={14} />
                <span>Add media</span>
              </button>
            </div>

            <span className="text-xs text-zinc-400">{content.length}/500</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-zinc-400">Send:</span>
            {(['now', '+1h', '+4h', '+1d'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => { setScheduleMode(opt); setCustomSchedule('') }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  scheduleMode === opt
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                {opt === 'now' ? 'Now' : opt}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setScheduleMode('custom')}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                scheduleMode === 'custom'
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              Custom
            </button>
            {scheduleMode === 'custom' && (
              <input
                type="datetime-local"
                value={customSchedule}
                min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                onChange={(e) => setCustomSchedule(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 focus:outline-none"
              />
            )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={sending || !content.trim()}
            className="flex items-center justify-center gap-2 rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            <Send size={14} />
            {sending ? 'Posting…' : 'Post'}
          </button>
        </form>
      </div>
    </div>
  )
}

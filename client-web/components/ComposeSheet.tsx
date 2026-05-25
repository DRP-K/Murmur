'use client'

import { useState } from 'react'
import { X, Send } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (content: string, expiresAt: number | null) => Promise<void>
}

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

  if (!open) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    setSending(true)
    setError(null)
    try {
      const expiresAt = expirySeconds ? Math.floor(Date.now() / 1000) + expirySeconds : null
      await onSubmit(content.trim(), expiresAt)
      setContent('')
      setExpirySeconds(null)
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
          <textarea
            autoFocus
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What's on your mind?"
            rows={4}
            maxLength={500}
            className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-800 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />

          <div className="flex items-center justify-between">
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

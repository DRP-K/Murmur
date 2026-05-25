'use client'

import { Heart, Waves, MessageCircle } from 'lucide-react'
import type { Post } from '@/lib/types'

interface Props {
  post: Post
  liked: boolean
  resonated: boolean
  onToggleLike: () => void
  onToggleResonate: () => void
  onReach: () => void
}

function relativeTime(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSec
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function PostCard({ post, liked, resonated, onToggleLike, onToggleResonate, onReach }: Props) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
        <span className="font-mono font-semibold text-zinc-500"># anon</span>
        <span>{relativeTime(post.timestamp)}</span>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-zinc-800 dark:text-zinc-100">
        {post.content}
      </p>

      <div className="flex items-center gap-4">
        <button
          onClick={onToggleLike}
          className={`flex items-center gap-1 text-xs transition-colors ${
            liked ? 'text-rose-500' : 'text-zinc-400 hover:text-rose-400'
          }`}
        >
          <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
          <span>&lt;3</span>
        </button>

        <button
          onClick={onToggleResonate}
          className={`flex items-center gap-1 text-xs transition-colors ${
            resonated ? 'text-violet-500' : 'text-zinc-400 hover:text-violet-400'
          }`}
        >
          <Waves size={14} />
          <span>~</span>
        </button>

        {/* Only show Reach on posts you didn't write */}
        {!post.is_own && (
          <button
            onClick={onReach}
            className="ml-auto flex items-center gap-1 rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-800 dark:border-zinc-600 dark:text-zinc-300"
          >
            <MessageCircle size={12} />
            Reach
          </button>
        )}
      </div>
    </div>
  )
}

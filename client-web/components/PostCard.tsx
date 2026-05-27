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

const CATEGORY_EMOJI: Record<string, string> = { movies: '🎬', music: '🎵', games: '🎮' }

function relativeTime(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSec
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function PostCard({ post, liked, resonated, onToggleLike, onToggleResonate, onReach }: Props) {
  const hasImage = !!post.image_url

  return (
    <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      {/* Background cover art */}
      {hasImage && (
        <>
          <img
            src={post.image_url!}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm dark:bg-zinc-900/85" />
        </>
      )}

      <div className="relative p-4">
        <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-1.5">
            {post.category && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {CATEGORY_EMOJI[post.category] ?? ''} {post.category}
              </span>
            )}
            <span className="font-mono font-semibold text-zinc-500"># anon</span>
          </div>
          <span>{relativeTime(post.timestamp)}</span>
        </div>

        <p className="mb-1 text-sm leading-relaxed text-zinc-800 dark:text-zinc-100">
          {post.content}
        </p>

        {post.media_ref_name && (
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{post.media_ref_name}</p>
        )}

        {!post.media_ref_name && <div className="mb-4" />}

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
    </div>
  )
}

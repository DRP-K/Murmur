'use client'

import { Heart, Waves, MessageCircle, Users } from 'lucide-react'
import type { Post } from '@/lib/types'

interface Props {
  post: Post
  liked: boolean
  resonated: boolean
  onToggleLike: () => void
  onToggleResonate: () => void
  onReach: () => void
  onJoinGroup: () => void
}

const CATEGORY_EMOJI: Record<string, string> = { movies: '🎬', music: '🎵', games: '🎮' }

function relativeTime(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSec
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function PostCard({ post, liked, resonated, onToggleLike, onToggleResonate, onReach, onJoinGroup }: Props) {
  const hasImage = !!post.image_url
  const isRally = !!post.rally_group_id

  return (
    <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      {/* Background cover art */}
      {hasImage && (
        <>
          <img
            src={post.image_url!}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
            style={{ filter: 'blur(3px)', transform: 'scale(1.03)' }}
          />
          <div className="absolute inset-0 bg-white/80" />
        </>
      )}

      <div className="relative p-4">
        <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-1.5">
            {post.category && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
                {CATEGORY_EMOJI[post.category] ?? ''} {post.category}
              </span>
            )}
            {post.is_own && post.scheduled_at && post.scheduled_at > Math.floor(Date.now() / 1000) && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                Scheduled {new Date(post.scheduled_at * 1000).toLocaleString()}
              </span>
            )}
            <span className="font-mono font-semibold text-zinc-500"># anon</span>
            {isRally && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                <Users size={10} />
                Rally
              </span>
            )}
          </div>
          <span>{relativeTime(post.timestamp)}</span>
        </div>

        <p className="mb-1 text-sm leading-relaxed text-zinc-800">
          {post.content}
        </p>

        {post.media_ref_name && (
          <p className="mb-3 text-xs text-zinc-500">{post.media_ref_name}</p>
        )}

        {isRally && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <Users size={14} />
            <span>Up to {post.rally_max_members ?? 4} people</span>
          </div>
        )}

        {post.attachments && post.attachments.length > 0 ? (
          <div className="mb-3 flex gap-2 overflow-x-auto">
            {post.attachments.map((item, i) =>
              item.media_type === 'video' ? (
                <video
                  key={i}
                  src={item.url}
                  controls
                  className="flex-shrink-0 max-h-64 max-w-[80%] rounded-lg bg-black"
                />
              ) : (
                <img
                  key={i}
                  src={item.url}
                  alt=""
                  className="flex-shrink-0 max-h-64 max-w-[80%] rounded-lg object-contain"
                />
              )
            )}
          </div>
        ) : (
          <>
            {post.attachment_url && post.attachment_type === 'image' && (
              <img
                src={post.attachment_url}
                alt=""
                className="mb-3 max-h-64 w-full rounded-lg object-contain"
              />
            )}
            {post.attachment_url && post.attachment_type === 'video' && (
              <video
                src={post.attachment_url}
                controls
                className="mb-3 max-h-64 w-full rounded-lg bg-black"
              />
            )}
          </>
        )}

        {!post.media_ref_name && !post.attachment_url && !post.attachments?.length && <div className="mb-4" />}

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

          {isRally ? (
            <button
              onClick={onJoinGroup}
              className="ml-auto flex items-center gap-1 rounded-full border border-emerald-300 px-3 py-1 text-xs text-emerald-700 transition-colors hover:border-emerald-500 hover:text-emerald-900"
            >
              <Users size={12} />
              {post.is_own ? 'Open group' : 'Join'}
            </button>
          ) : !post.is_own && (
            <button
              onClick={onReach}
              className="ml-auto flex items-center gap-1 rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-800"
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

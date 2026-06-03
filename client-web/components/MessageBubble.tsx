'use client'

import { CheckCheck, Check } from 'lucide-react'

interface Props {
  content: string
  sentAt: number
  isOwn: boolean
  status?: 'sent' | 'delivered'
  senderName?: string | null
}

function formatTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MessageBubble({ content, sentAt, isOwn, status, senderName }: Props) {
  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isOwn
            ? 'rounded-br-sm bg-zinc-900 text-white'
            : 'rounded-bl-sm bg-white text-zinc-800 shadow-sm'
        }`}
      >
        {!isOwn && senderName && (
          <p className="mb-1 text-[10px] font-semibold text-zinc-500">{senderName}</p>
        )}
        <p>{content}</p>
        <div className={`mt-1 flex items-center gap-1 text-[10px] ${isOwn ? 'justify-end text-zinc-400' : 'text-zinc-400'}`}>
          <span>{formatTime(sentAt)}</span>
          {isOwn && (
            status === 'delivered'
              ? <CheckCheck size={10} className="text-blue-400" />
              : <Check size={10} />
          )}
        </div>
      </div>
    </div>
  )
}

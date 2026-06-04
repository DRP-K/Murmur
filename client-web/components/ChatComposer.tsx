'use client'

import { Send } from 'lucide-react'
import type { FormEvent, KeyboardEvent } from 'react'

interface ChatComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  sending: boolean
  placeholder: string
  className?: string
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  sending,
  placeholder,
  className = '',
}: ChatComposerProps) {
  const canSend = value.trim().length > 0 && !sending

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSend) return
    onSubmit()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    if (!canSend) return
    onSubmit()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`flex items-end gap-2 border-t border-zinc-200 bg-white p-4 ${className}`}
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        className="flex-1 resize-none rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-800 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none"
      />
      <button
        type="submit"
        disabled={!canSend}
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white transition-opacity disabled:opacity-40"
      >
        <Send size={16} />
      </button>
    </form>
  )
}

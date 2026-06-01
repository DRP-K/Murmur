'use client'

interface Props {
  name: string
  metAtEvent?: string | null
  preview: string
  timestamp: number
  unread?: number
  isAnon?: boolean
  active?: boolean
  onClick: () => void
}

function relativeTime(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSec
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

export function ChatRow({ name, metAtEvent, preview, timestamp, unread, isAnon, active, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left shadow-sm transition-colors ${
        active ? 'bg-zinc-900 text-white hover:bg-zinc-800' : 'bg-white hover:bg-zinc-50'
      }`}
    >
      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
        active ? 'bg-white/15 text-white' : 'bg-zinc-100 text-zinc-600'
      }`}>
        {isAnon ? '?' : name.charAt(0).toUpperCase()}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className={`truncate text-sm font-medium ${active ? 'text-white' : 'text-zinc-800'}`}>
              {name}
            </span>
            {!!metAtEvent && !isAnon && (
              <span className={`truncate text-xs ${active ? 'text-zinc-300' : 'text-zinc-400'}`}>· {metAtEvent}</span>
            )}
          </div>
          <span className={`flex-shrink-0 text-xs ${active ? 'text-zinc-300' : 'text-zinc-400'}`}>{relativeTime(timestamp)}</span>
        </div>
        <p className={`truncate text-xs ${active ? 'text-zinc-300' : 'text-zinc-400'}`}>{preview}</p>
      </div>

      {!!unread && (
        <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold ${
          active ? 'bg-white text-zinc-900' : 'bg-zinc-900 text-white'
        }`}>
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  )
}

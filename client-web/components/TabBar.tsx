'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Newspaper, MessageCircle, User } from 'lucide-react'

const tabs = [
  { label: 'Feed', path: '/feed', icon: Newspaper },
  { label: 'Chats', path: '/chats', icon: MessageCircle },
  { label: 'Me', path: '/me', icon: User },
] as const

export function TabBar() {
  const pathname = usePathname()
  const router = useRouter()

  function isActive(path: string) {
    return pathname === path || pathname.startsWith(path + '/')
  }

  return (
    <nav className="fixed bottom-0 left-1/2 z-10 w-full max-w-md -translate-x-1/2 flex border-t border-zinc-200 bg-white">
      {tabs.map(({ label, path, icon: Icon }) => {
        const active = isActive(path)
        return (
          <button
            key={path}
            onClick={() => router.push(path)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
              active
                ? 'text-zinc-900'
                : 'text-zinc-400 hover:text-zinc-600'
            }`}
          >
            <Icon size={18} strokeWidth={active ? 2.5 : 1.5} />
            {active ? `[${label}]` : label}
          </button>
        )
      })}
    </nav>
  )
}

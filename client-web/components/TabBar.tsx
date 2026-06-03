'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Newspaper, MessageCircle, User } from 'lucide-react'

const tabs = [
  { label: 'Feed', sideLabel: 'Feed', path: '/feed', icon: Newspaper },
  { label: 'Chats', sideLabel: 'Chat', path: '/chats', icon: MessageCircle },
  { label: 'Me', sideLabel: 'Me', path: '/me', icon: User },
] as const

interface TabBarProps {
  sideOnly?: boolean
}

export function TabBar({ sideOnly = false }: TabBarProps) {
  const pathname = usePathname()
  const router = useRouter()

  function isActive(path: string) {
    return pathname === path || pathname.startsWith(path + '/')
  }

  return (
    <>
      <nav
        className={
          sideOnly
            ? 'hidden'
            : 'fixed bottom-0 left-1/2 z-10 flex w-full max-w-md -translate-x-1/2 border-t border-zinc-200 bg-white shadow-[0_-8px_24px_rgba(24,24,27,0.04)] md:hidden landscape:hidden'
        }
      >
        {tabs.map(({ label, path, icon: Icon }) => {
          const active = isActive(path)
          return (
            <button
              key={path}
              onClick={() => router.push(path)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors ${
                active
                  ? 'text-zinc-900'
                  : 'text-zinc-400 hover:text-zinc-600'
              }`}
            >
              <span className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                active ? 'bg-zinc-900 text-white' : 'bg-transparent'
              }`}>
                <Icon size={16} strokeWidth={active ? 2.5 : 1.75} />
              </span>
              {label}
            </button>
          )
        })}
      </nav>

      <nav className="fixed left-0 top-0 z-20 hidden h-dvh w-32 flex-col border-r border-zinc-200 bg-white px-3 py-4 shadow-[8px_0_24px_rgba(24,24,27,0.04)] md:flex landscape:flex">
        <div className="mb-6 flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 text-sm font-semibold text-white">
          M
        </div>
        <div className="flex flex-1 flex-col gap-2">
          {tabs.map(({ label, sideLabel, path, icon: Icon }) => {
            const active = isActive(path)
            return (
              <button
                key={path}
                onClick={() => router.push(path)}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                title={label}
                className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-zinc-900 text-white'
                    : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700'
                }`}
              >
                <Icon size={19} strokeWidth={active ? 2.5 : 1.75} />
                <span>{sideLabel}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </>
  )
}

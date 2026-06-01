'use client'

import { useState } from 'react'
import { X, UserCheck } from 'lucide-react'
import { db } from '@/lib/db'
import { TagSelector } from '@/components/TagSelector'

interface Props {
  friendId: string
  initialNickname: string | null
  initialMetAtEvent?: string | null
  onDone: () => void
}

export function FriendSetupModal({ friendId, initialNickname, initialMetAtEvent, onDone }: Props) {
  const [nickname, setNickname] = useState(initialNickname ?? '')
  const [metAtEvent, setMetAtEvent] = useState(initialMetAtEvent ?? '')

  async function handleDone() {
    const nick = nickname.trim() || null
    const event = metAtEvent.trim() || null
    await db.friends.update(friendId, { nickname: nick, metAtEvent: event })
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-800">Friend added!</h2>
          <button onClick={onDone} className="mt-0.5 text-zinc-400 hover:text-zinc-600">
            <X size={16} />
          </button>
        </div>

        <p className="mb-5 text-xs text-zinc-400">
          Optionally give them a nickname and assign tags so you can filter posts by group.
        </p>

        <div className="flex flex-col gap-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">
              Nickname <span className="font-normal text-zinc-400">(optional)</span>
            </label>
            <input
              autoFocus
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDone()}
              placeholder="e.g. Alice"
              maxLength={40}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">
              Met at event <span className="font-normal text-zinc-400">(optional)</span>
            </label>
            <input
              value={metAtEvent}
              onChange={(e) => setMetAtEvent(e.target.value)}
              placeholder="e.g. JSConf 2026"
              maxLength={80}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-zinc-500">
              Common Experience Tags <span className="font-normal text-zinc-400">(optional)</span>
            </p>
            <TagSelector friendId={friendId} />
          </div>

          <button
            type="button"
            onClick={handleDone}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-800"
          >
            <UserCheck size={15} />
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { db, type LocalTag } from '@/lib/db'
import { createTag, getFriendTags, setFriendTags } from '@/lib/tags'

interface Props {
  friendId: string
}

export function TagSelector({ friendId }: Props) {
  const [allTags, setAllTags] = useState<LocalTag[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    db.tags.orderBy('name').toArray().then(setAllTags)
    getFriendTags(friendId).then((tags) => setSelected(new Set(tags.map((t) => t.id))))
  }, [friendId])

  function toggle(tagId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(tagId) ? next.delete(tagId) : next.add(tagId)
      setFriendTags(friendId, [...next])
      return next
    })
  }

  async function handleCreate(e: React.SyntheticEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const tag = await createTag(name)
      setAllTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)))
      setSelected((prev) => {
        const next = new Set(prev)
        next.add(tag.id)
        setFriendTags(friendId, [...next])
        return next
      })
      setNewName('')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {allTags.length === 0 && (
        <p className="text-xs text-zinc-400">No tags yet. Create one below.</p>
      )}
      {allTags.map((tag) => (
        <label key={tag.id} className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={selected.has(tag.id)}
            onChange={() => toggle(tag.id)}
            className="h-4 w-4 rounded border-zinc-300 accent-zinc-800"
          />
          <span className="text-sm text-zinc-700">{tag.name}</span>
        </label>
      ))}

      <form onSubmit={handleCreate} className="mt-1 flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New tag…"
          className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-800 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!newName.trim() || creating}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-white disabled:opacity-40"
        >
          <Plus size={14} />
        </button>
      </form>
    </div>
  )
}

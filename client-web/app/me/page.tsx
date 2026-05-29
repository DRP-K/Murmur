'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Copy, Check, Pencil, Sun, Moon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { getIdentity, updateDisplayName } from '@/lib/identity'
import { TabBar } from '@/components/TabBar'

function getTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function setTheme(theme: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem('murmur-theme', theme)
}

export default function MePage() {
  const bootstrapped = useAppStore((s) => s.bootstrapped)
  const bootstrapError = useAppStore((s) => s.bootstrapError)
  const userId = useAppStore((s) => s.userId)
  const pubkeyHex = useAppStore((s) => s.pubkeyHex)
  const router = useRouter()

  const [displayName, setDisplayName] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState(false)
  const [copiedPubkey, setCopiedPubkey] = useState(false)
  const [theme, setThemeState] = useState<'light' | 'dark'>(getTheme)

  useEffect(() => {
    if (!bootstrapped) return
    getIdentity().then((id) => {
      if (id?.displayName) setDisplayName(id.displayName)
    })
  }, [bootstrapped])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }

  async function handleSaveName() {
    setSaving(true)
    try {
      await updateDisplayName(displayName)
      setEditing(false)
    } catch (err) {
      console.error('[me] save name', err)
    } finally {
      setSaving(false)
    }
  }

  async function copyId() {
    if (!userId) return
    await navigator.clipboard.writeText(userId)
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 2000)
  }

  async function copyPubkey() {
    if (!pubkeyHex) return
    await navigator.clipboard.writeText(pubkeyHex)
    setCopiedPubkey(true)
    setTimeout(() => setCopiedPubkey(false), 2000)
  }

  if (!bootstrapped) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        {bootstrapError ? (
          <span className="text-red-500">Error: {bootstrapError}</span>
        ) : (
          <span>Connecting…</span>
        )}
      </div>
    )
  }

  return (
    <>
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <button onClick={() => router.back()} className="text-zinc-500 hover:text-zinc-800">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">Me</h1>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-4 pb-16">
        {/* Avatar + display name */}
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-200 text-xl font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
            {displayName ? displayName.charAt(0).toUpperCase() : '?'}
          </div>

          <div className="flex-1">
            {editing ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={40}
                  className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName()
                    if (e.key === 'Escape') setEditing(false)
                  }}
                />
                <button
                  onClick={handleSaveName}
                  disabled={saving}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 text-lg font-semibold text-zinc-800 hover:text-zinc-600 dark:text-zinc-100"
              >
                {displayName || 'Set display name'}
                <Pencil size={13} className="text-zinc-400" />
              </button>
            )}
            <p className="mt-0.5 text-xs text-zinc-400">Tap to edit</p>
          </div>
        </div>

        {/* Theme toggle */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {theme === 'dark' ? (
                <Moon size={18} className="text-zinc-500" />
              ) : (
                <Sun size={18} className="text-amber-500" />
              )}
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                {theme === 'dark' ? 'Dark mode' : 'Light mode'}
              </span>
            </div>
            <button
              onClick={toggleTheme}
              className={`relative h-7 w-12 rounded-full transition-colors ${
                theme === 'dark' ? 'bg-zinc-700' : 'bg-zinc-300'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                  theme === 'dark' ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* User ID */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="mb-2 text-xs font-medium text-zinc-500">Your ID</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all text-xs text-zinc-600 dark:text-zinc-300">
              {userId}
            </code>
            <button
              onClick={copyId}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
            >
              {copiedId ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* Pubkey */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="mb-2 text-xs font-medium text-zinc-500">Public key (Ed25519)</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all text-[10px] text-zinc-400">
              {pubkeyHex}
            </code>
            <button
              onClick={copyPubkey}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"
            >
              {copiedPubkey ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* App info */}
        <div className="mt-auto rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-xs text-zinc-400">
            Murmur v0.1.0 — whisper to your friends.
          </p>
        </div>
      </main>

      <TabBar />
    </>
  )
}

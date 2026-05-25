'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeCanvas } from 'qrcode.react'
import { ArrowLeft, Copy, Check, UserPlus, Hash } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { ecdh } from '@/lib/crypto'
import { addFriend } from '@/lib/relay'
import { db } from '@/lib/db'
import { QrScanner } from '@/components/QrScanner'
import { TabBar } from '@/components/TabBar'
import type { QrPayload } from '@/lib/types'

type Tab = 'my-qr' | 'scan' | 'by-id'

export default function FriendsPage() {
  const bootstrapped = useAppStore((s) => s.bootstrapped)
  const bootstrapError = useAppStore((s) => s.bootstrapError)
  const userId = useAppStore((s) => s.userId)
  const pubkeyHex = useAppStore((s) => s.pubkeyHex)
  const token = useAppStore((s) => s.token)
  const router = useRouter()

  const [tab, setTab] = useState<Tab>('my-qr')
  const [copied, setCopied] = useState(false)
  const [scanResult, setScanResult] = useState<QrPayload | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Manual "add by ID" fields.
  const [manualId, setManualId] = useState('')
  const [manualPubkey, setManualPubkey] = useState('')
  const [manualNickname, setManualNickname] = useState('')

  // QR payload for others to scan me.
  const myQrPayload: QrPayload = useMemo(
    () => ({
      user_id: userId ?? '',
      pubkey_hex: pubkeyHex ?? '',
      relay_address: null,
      nickname: null,
    }),
    [userId, pubkeyHex],
  )
  const myQrJson = JSON.stringify(myQrPayload)

  async function copyId() {
    if (!userId) return
    await navigator.clipboard.writeText(userId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleScan(payload: QrPayload) {
    setScanResult(payload)
    setError(null)
  }

  async function doAddFriend(
    friendId: string,
    friendPubkey: string,
    nickname: string | null,
  ) {
    if (!token || !userId) return
    console.log('[friends] doAddFriend: adding', friendId.slice(0,8), 'pubkey len:', friendPubkey.length)
    setAdding(true)
    setError(null)

    try {
      const identity = await db.identity.get(userId)
      if (!identity) throw new Error('No identity in Dexie')

      const shared = ecdh(identity.privkeyHex, friendPubkey)
      console.log('[friends] ECDH shared secret computed, length:', shared.length)

      await db.friends.put({
        userId: friendId,
        pubkeyHex: friendPubkey,
        dhSharedHex: shared,
        nickname,
        blockedAt: null,
      })
      console.log('[friends] stored in local Dexie')

      console.log('[friends] posting to relay /api/friends')
      await addFriend(token, friendId)
      console.log('[friends] relay addFriend OK')

      setScanResult(null)
      setManualId('')
      setManualPubkey('')
      setManualNickname('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add friend')
    } finally {
      setAdding(false)
    }
  }

  function handleAddFromScan() {
    if (!scanResult) return
    doAddFriend(scanResult.user_id, scanResult.pubkey_hex, scanResult.nickname)
  }

  function handleAddById(e: React.FormEvent) {
    e.preventDefault()
    const id = manualId.trim()
    const pk = manualPubkey.trim()
    if (!id || !pk) { setError('User ID and pubkey are required'); return }
    doAddFriend(id, pk, manualNickname.trim() || null)
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

  const tabClass = (t: Tab) =>
    `flex-1 py-3 text-center text-sm font-medium transition-colors ${
      tab === t
        ? 'border-b-2 border-zinc-900 text-zinc-900 dark:border-white dark:text-white'
        : 'text-zinc-400'
    }`

  return (
    <>
      <header className="flex items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <button onClick={() => router.back()} className="text-zinc-500 hover:text-zinc-800">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">Add Friend</h1>
      </header>

      <div className="flex border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <button onClick={() => setTab('my-qr')} className={tabClass('my-qr')}>My QR</button>
        <button onClick={() => setTab('scan')} className={tabClass('scan')}>Scan</button>
        <button onClick={() => setTab('by-id')} className={tabClass('by-id')}>By ID</button>
      </div>

      <main className="flex flex-1 flex-col items-center px-4 py-8">
        {tab === 'my-qr' && (
          <>
            <p className="mb-6 text-xs text-zinc-400">Show this to your friend:</p>
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
              <QRCodeCanvas value={myQrJson} size={200} level="M" fgColor="currentColor"
                className="text-zinc-900 dark:text-zinc-100" includeMargin />
            </div>
            <div className="mt-6 w-full max-w-xs">
              <p className="mb-2 text-center text-xs text-zinc-400">Your ID:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {userId}
                </code>
                <button onClick={copyId}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300">
                  {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </button>
              </div>
              <button onClick={copyId}
                className="mt-3 w-full rounded-full border border-zinc-200 py-2 text-sm text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300">
                Copy ID
              </button>
            </div>
          </>
        )}

        {tab === 'scan' && (
          <>
            <QrScanner onScan={handleScan} onError={setError} />
            {scanResult && (
              <div className="mt-6 w-full max-w-xs rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
                <p className="mb-1 text-xs font-medium text-green-700 dark:text-green-300">Friend found:</p>
                <code className="text-xs text-green-600 dark:text-green-400">{scanResult.user_id.slice(0, 16)}…</code>
                {scanResult.nickname && <p className="mt-1 text-xs text-green-600 dark:text-green-400">&quot;{scanResult.nickname}&quot;</p>}
                <button onClick={handleAddFromScan} disabled={adding}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-40">
                  <UserPlus size={14} />{adding ? 'Adding…' : 'Add Friend'}
                </button>
              </div>
            )}
            {error && <p className="mt-4 text-xs text-red-500">{error}</p>}
          </>
        )}

        {tab === 'by-id' && (
          <form onSubmit={handleAddById} className="w-full max-w-xs">
            <p className="mb-4 text-xs text-zinc-400">
              Paste your friend&apos;s User ID and public key (from their Me page).
            </p>

            <label className="mb-1 block text-xs font-medium text-zinc-500">User ID</label>
            <input value={manualId} onChange={(e) => setManualId(e.target.value)}
              placeholder="e.g. a3f9c7b2..."
              className="mb-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />

            <label className="mb-1 block text-xs font-medium text-zinc-500">Public key (hex)</label>
            <input value={manualPubkey} onChange={(e) => setManualPubkey(e.target.value)}
              placeholder="Ed25519 pubkey in hex..."
              className="mb-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />

            <label className="mb-1 block text-xs font-medium text-zinc-500">Nickname (optional)</label>
            <input value={manualNickname} onChange={(e) => setManualNickname(e.target.value)}
              placeholder="Alice"
              maxLength={40}
              className="mb-4 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />

            <button type="submit" disabled={adding}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-zinc-900">
              <Hash size={14} />{adding ? 'Adding…' : 'Add by ID'}
            </button>

            {error && <p className="mt-4 text-xs text-red-500">{error}</p>}
          </form>
        )}
      </main>

      <TabBar />
    </>
  )
}

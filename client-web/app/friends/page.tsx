'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeCanvas } from 'qrcode.react'
import { ArrowLeft, UserPlus } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { ecdh } from '@/lib/crypto'
import { addFriend, createInviteToken, redeemInviteToken } from '@/lib/relay'
import { db } from '@/lib/db'
import { QrScanner } from '@/components/QrScanner'
import type { QrPayload } from '@/lib/types'

type Tab = 'my-qr' | 'scan' | 'token'

export default function FriendsPage() {
  const bootstrapped = useAppStore((s) => s.bootstrapped)
  const bootstrapError = useAppStore((s) => s.bootstrapError)
  const userId = useAppStore((s) => s.userId)
  const pubkeyHex = useAppStore((s) => s.pubkeyHex)
  const token = useAppStore((s) => s.token)
  const pushFriendSetup = useAppStore((s) => s.pushFriendSetup)
  const router = useRouter()

  const [tab, setTab] = useState<Tab>('my-qr')
  const [scanResult, setScanResult] = useState<QrPayload | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Token tab state.
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [inviteExpiresAt, setInviteExpiresAt] = useState<number | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [generatingCode, setGeneratingCode] = useState(false)
  const [redeemInput, setRedeemInput] = useState('')
  const [redeeming, setRedeeming] = useState(false)

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

  // Countdown timer for invite code.
  useEffect(() => {
    if (!inviteExpiresAt) return
    const interval = setInterval(() => {
      const remaining = Math.max(0, inviteExpiresAt - Math.floor(Date.now() / 1000))
      setCountdown(remaining)
      if (remaining === 0) {
        setInviteCode(null)
        setInviteExpiresAt(null)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [inviteExpiresAt])

  function handleScan(payload: QrPayload) {
    setScanResult(payload)
    setError(null)
  }

  async function doAddFriend(
    friendId: string,
    friendPubkey: string,
    nickname: string | null,
    metAtEvent: string | null,
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
        metAtEvent,
        blockedAt: null,
      })
      console.log('[friends] stored in local Dexie')

      console.log('[friends] posting to relay /api/friends')
      await addFriend(token, friendId)
      console.log('[friends] relay addFriend OK')

      setScanResult(null)
      pushFriendSetup({ friendId, nickname, metAtEvent })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add friend')
    } finally {
      setAdding(false)
    }
  }

  function handleAddFromScan() {
    if (!scanResult) return
    doAddFriend(
      scanResult.user_id,
      scanResult.pubkey_hex,
      scanResult.nickname ?? null,
      null,
    )
  }

  async function generateToken() {
    if (!token) return
    setGeneratingCode(true)
    setError(null)
    try {
      const resp = await createInviteToken(token)
      setInviteCode(resp.code)
      setInviteExpiresAt(resp.expires_at)
      setCountdown(Math.max(0, resp.expires_at - Math.floor(Date.now() / 1000)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate code')
    } finally {
      setGeneratingCode(false)
    }
  }

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault()
    const code = redeemInput.trim()
    if (!token || code.length !== 6) { setError('Enter the 6-digit code'); return }
    setRedeeming(true)
    setError(null)
    try {
      await redeemInviteToken(token, code)
      setRedeemInput('')
      // The server sends friend_added WS messages to both parties;
      // useFriendSink processes them and saves to Dexie automatically.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired code')
    } finally {
      setRedeeming(false)
    }
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
        ? 'border-b-2 border-zinc-900 text-zinc-900'
        : 'text-zinc-400'
    }`

  return (
    <>
      <header className="flex items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur">
        <button onClick={() => router.back()} className="text-zinc-500 hover:text-zinc-800">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-semibold text-zinc-800">Add Friend</h1>
      </header>

      <div className="flex border-b border-zinc-200 bg-white">
        <button onClick={() => setTab('my-qr')} className={tabClass('my-qr')}>My QR</button>
        <button onClick={() => setTab('scan')} className={tabClass('scan')}>Scan</button>
        <button onClick={() => setTab('token')} className={tabClass('token')}>Token</button>
      </div>

      <main className="flex flex-1 flex-col items-center px-4 py-8">
        {tab === 'my-qr' && (
          <>
            <p className="mb-6 text-xs text-zinc-400">Show this to your friend:</p>
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <QRCodeCanvas value={myQrJson} size={200} level="M" fgColor="currentColor"
                className="text-zinc-900" includeMargin />
            </div>
          </>
        )}

        {tab === 'scan' && (
          <>
            <QrScanner onScan={handleScan} onError={setError} />
            {scanResult && (
              <div className="mt-6 w-full max-w-xs rounded-xl border border-green-200 bg-green-50 p-4">
                <p className="mb-1 text-xs font-medium text-green-700">Friend found:</p>
                <code className="text-xs text-green-600">{scanResult.user_id.slice(0, 16)}…</code>
                {scanResult.nickname && <p className="mt-1 text-xs text-green-600">&quot;{scanResult.nickname}&quot;</p>}

                <button onClick={handleAddFromScan} disabled={adding}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-40">
                  <UserPlus size={14} />{adding ? 'Adding…' : 'Add Friend'}
                </button>
              </div>
            )}
            {error && <p className="mt-4 text-xs text-red-500">{error}</p>}
          </>
        )}

        {tab === 'token' && (
          <div className="w-full max-w-xs space-y-8">
            {/* Generate section */}
            <div>
              <p className="mb-4 text-xs text-zinc-400">Share this code with your friend:</p>
              {inviteCode ? (
                <div className="flex flex-col items-center gap-3">
                  <code className="rounded-2xl border border-zinc-200 bg-white px-6 py-4 text-5xl font-mono tracking-widest text-zinc-900 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
                    {inviteCode}
                  </code>
                  <p className="text-xs text-zinc-400">Expires in {countdown}s</p>
                  <button onClick={generateToken} disabled={generatingCode}
                    className="text-xs text-zinc-400 underline hover:text-zinc-600 disabled:opacity-40">
                    Regenerate
                  </button>
                </div>
              ) : (
                <button onClick={generateToken} disabled={generatingCode}
                  className="w-full rounded-full bg-zinc-900 py-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-zinc-900">
                  {generatingCode ? 'Generating…' : 'Generate Code'}
                </button>
              )}
            </div>

            {/* Redeem section */}
            <form onSubmit={handleRedeem}>
              <p className="mb-4 text-xs text-zinc-400">Or enter your friend&apos;s code:</p>
              <input
                value={redeemInput}
                onChange={(e) => setRedeemInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="000000"
                className="mb-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-3 text-center text-2xl font-mono tracking-widest text-zinc-800 placeholder-zinc-300 focus:border-zinc-400 focus:outline-none"
              />
              <button type="submit" disabled={redeeming || redeemInput.length !== 6}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40">
                <UserPlus size={14} />{redeeming ? 'Adding…' : 'Add Friend'}
              </button>
            </form>

            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          </div>
        )}
      </main>

    </>
  )
}

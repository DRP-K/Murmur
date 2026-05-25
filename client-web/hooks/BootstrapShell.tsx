'use client'

import { useEffect, useState } from 'react'
import { initIdentity } from '@/lib/identity'
import { register, setReauthHandler } from '@/lib/relay'
import { useAppStore } from '@/lib/store'
import * as ws from '@/lib/ws'
import { useAnonSink } from '@/hooks/useAnonSink'
import { useFriendSink } from '@/hooks/useFriendSink'
import { useMessageSink } from '@/hooks/useMessageSink'
import { usePostSink } from '@/hooks/usePostSink'

/**
 * Runs the full app boot sequence once on mount inside the root layout.
 * Sets bootstrapped/bootstrapError on the Zustand store so pages can
 * check readiness without calling useBootstrap individually.
 *
 * All content (loading, error, children) shares the same centered max-w-md
 * container so the page width never changes during transitions.
 *
 * Global WS sinks are registered here so all message types are captured
 * regardless of which page the user is on.
 */
export function BootstrapShell({ children }: { children: React.ReactNode }) {
  const authenticate = useAppStore((s) => s.authenticate)
  const setWsStatus = useAppStore((s) => s.setWsStatus)
  const setBootstrapped = useAppStore((s) => s.setBootstrapped)
  const bootstrapped = useAppStore((s) => s.bootstrapped)
  const bootstrapError = useAppStore((s) => s.bootstrapError)

  // Global sinks — always active once booted.
  useAnonSink()
  useFriendSink()
  useMessageSink()
  usePostSink()

  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (running) return
    setRunning(true)

    let cancelled = false

    async function boot() {
      try {
        const identity = await initIdentity()
        if (cancelled) return

        await register(identity.userId, identity.pubkeyHex)
        if (cancelled) return

        await authenticate()
        if (cancelled) return

        setReauthHandler(() => useAppStore.getState().authenticate())

        ws.connect(() => useAppStore.getState().token)
        ws.subscribeStatus(setWsStatus)

        if (!cancelled) setBootstrapped(true)
      } catch (err) {
        if (!cancelled) {
          setBootstrapped(false, err instanceof Error ? err.message : String(err))
        }
      }
    }

    boot()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Show a global loading screen until bootstrap finishes.
  if (!bootstrapped && !bootstrapError) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-3 bg-zinc-50">
        <div className="h-2 w-32 overflow-hidden rounded-full bg-zinc-200">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-zinc-400" />
        </div>
        <p className="text-sm text-zinc-400">Starting Murmur…</p>
      </div>
    )
  }

  // Show a global error screen if bootstrap failed.
  if (bootstrapError) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-3 bg-zinc-50">
        <p className="text-sm text-red-500">Failed to start</p>
        <p className="max-w-xs text-center text-xs text-zinc-400">{bootstrapError}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 rounded-full border border-zinc-200 px-6 py-2 text-sm text-zinc-600 hover:border-zinc-400"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-zinc-50">
      {children}
    </div>
  )
}
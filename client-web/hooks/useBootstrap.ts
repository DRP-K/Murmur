'use client'

import { useEffect, useState } from 'react'
import { initIdentity } from '@/lib/identity'
import { register, setReauthHandler } from '@/lib/relay'
import { useAppStore } from '@/lib/store'
import * as ws from '@/lib/ws'

export type BootstrapState =
  | { ready: false; error: null }
  | { ready: false; error: string }
  | { ready: true; error: null }

/**
 * Runs the full app boot sequence once on mount:
 *   initIdentity → register → authenticate → wire reauth → connect WS
 *
 * Safe to call from multiple components — ws.connect() is a no-op when already
 * connected, and initIdentity/register are idempotent.
 */
export function useBootstrap(): BootstrapState {
  const [state, setState] = useState<BootstrapState>({ ready: false, error: null })
  const authenticate = useAppStore((s) => s.authenticate)
  const setWsStatus = useAppStore((s) => s.setWsStatus)

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        const identity = await initIdentity()
        if (cancelled) return

        await register(identity.userId, identity.pubkeyHex)
        if (cancelled) return

        await authenticate()
        if (cancelled) return

        // Wire up auto-reauth so relay.ts can self-heal on 401.
        setReauthHandler(() => useAppStore.getState().authenticate())

        // Connect WS; reads token lazily so reauth refreshes are picked up.
        ws.connect(() => useAppStore.getState().token)
        ws.subscribeStatus(setWsStatus)

        if (!cancelled) setState({ ready: true, error: null })
      } catch (err) {
        if (!cancelled) {
          setState({ ready: false, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }

    boot()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return state
}

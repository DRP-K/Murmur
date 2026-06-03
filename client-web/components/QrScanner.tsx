'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff } from 'lucide-react'
import type { QrPayload } from '@/lib/types'

interface Props {
  onScan: (payload: QrPayload) => void
  onError: (error: string) => void
}

export function QrScanner({ onScan, onError }: Props) {
  const [scanning, setScanning] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null)

  async function startScanning() {
    if (typeof window === 'undefined') {
      onError('Camera not available')
      return
    }

    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const Html5QrCode = Html5Qrcode
      const scanner = new Html5QrCode('qr-reader')
      scannerRef.current = scanner
      setScanning(true)

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText: string) => {
          try {
            const payload: QrPayload = JSON.parse(decodedText)
            if (!payload.user_id || !payload.pubkey_hex) {
              onError('Invalid QR code — missing user_id or pubkey')
              return
            }
            stopScanning()
            onScan(payload)
          } catch {
            onError('Invalid QR code — not a valid Murmur friend payload')
          }
        },
        () => {}, // ignore partial reads
      )
    } catch (err) {
      setScanning(false)
      onError(err instanceof Error ? err.message : 'Camera access denied')
    }
  }

  function stopScanning() {
    scannerRef.current?.stop().catch(() => {})
    scannerRef.current = null
    setScanning(false)
  }

  useEffect(() => {
    return () => { stopScanning() }
  }, [])

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        id="qr-reader"
        className="w-full max-w-sm overflow-hidden rounded-xl"
      />

      {!scanning ? (
        <button
          onClick={startScanning}
          className="flex items-center gap-2 rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white"
        >
          <Camera size={16} />
          Start scanning
        </button>
      ) : (
        <button
          onClick={stopScanning}
          className="flex items-center gap-2 rounded-full border border-zinc-200 px-6 py-2.5 text-sm text-zinc-600"
        >
          <CameraOff size={16} />
          Stop scanning
        </button>
      )}

      <p className="text-xs text-zinc-400">
        Point your camera at a friend&apos;s QR code.
      </p>
    </div>
  )
}

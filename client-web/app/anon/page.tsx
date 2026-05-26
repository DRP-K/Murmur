'use client'

import { Suspense } from 'react'
import AnonThreadPage from './view'

export default function Page() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-zinc-400">Loading…</div>}>
      <AnonThreadPage />
    </Suspense>
  )
}

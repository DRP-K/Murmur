// Uses Deezer — no API key required, album art always present.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q')?.trim()
  const url = q
    ? `https://api.deezer.com/search/track?q=${encodeURIComponent(q)}&limit=10`
    : `https://api.deezer.com/chart/0/tracks?limit=10`

  const res = await fetch(url, { next: { revalidate: q ? 0 : 3600 } })
  if (!res.ok) return Response.json({ error: 'upstream error' }, { status: 502 })

  const data = await res.json()
  const tracks: Record<string, unknown>[] = data.data ?? []
  const items = tracks.map((t) => ({
    id: String(t.id),
    track: t.title as string,
    artist: (t.artist as Record<string, string>).name,
    imageUrl: (t.album as Record<string, string>).cover_medium ?? null,
  }))

  return Response.json(items)
}

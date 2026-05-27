export async function GET(request: Request) {
  const key = process.env.LASTFM_API_KEY
  if (!key) return Response.json({ error: 'LASTFM_API_KEY not set' }, { status: 500 })

  const q = new URL(request.url).searchParams.get('q')?.trim()
  const url = q
    ? `https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(q)}&api_key=${key}&format=json&limit=10`
    : `https://ws.audioscrobbler.com/2.0/?method=chart.gettoptracks&api_key=${key}&format=json&limit=10`

  const res = await fetch(url, { next: { revalidate: q ? 0 : 3600 } })
  if (!res.ok) return Response.json({ error: 'upstream error' }, { status: 502 })

  const data = await res.json()
  const tracks: Record<string, unknown>[] = q
    ? (data.results?.trackmatches?.track ?? [])
    : (data.tracks?.track ?? [])
  const items = tracks.map((t) => {
    const images = (t.image as Record<string, string>[]) ?? []
    const img = images.find((i) => i.size === 'large') ?? images[images.length - 1]
    return {
      id: `${t.name}-${(t.artist as Record<string, string>).name}`,
      track: t.name as string,
      artist: (t.artist as Record<string, string>).name,
      imageUrl: img?.['#text'] || null,
    }
  })

  return Response.json(items)
}

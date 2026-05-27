export async function GET(request: Request) {
  const key = process.env.RAWG_API_KEY
  if (!key) return Response.json({ error: 'RAWG_API_KEY not set' }, { status: 500 })

  const q = new URL(request.url).searchParams.get('q')?.trim()
  const url = q
    ? `https://api.rawg.io/api/games?search=${encodeURIComponent(q)}&page_size=10&key=${key}`
    : `https://api.rawg.io/api/games?ordering=-added&page_size=10&key=${key}`

  const res = await fetch(url, { next: { revalidate: q ? 0 : 3600 } })
  if (!res.ok) return Response.json({ error: 'upstream error' }, { status: 502 })

  const data = await res.json()
  const items = (data.results ?? []).map((g: Record<string, unknown>) => {
    const genres = ((g.genres as { name: string }[]) ?? []).map((x) => x.name).join(', ')
    return {
      id: String(g.id),
      name: g.name as string,
      genres,
      imageUrl: g.background_image as string | null,
    }
  })

  return Response.json(items)
}

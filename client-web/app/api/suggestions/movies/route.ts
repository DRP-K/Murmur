export async function GET(request: Request) {
  const key = process.env.TMDB_API_KEY
  if (!key) return Response.json({ error: 'TMDB_API_KEY not set' }, { status: 500 })

  const q = new URL(request.url).searchParams.get('q')?.trim()
  const url = q
    ? `https://api.themoviedb.org/3/search/movie?api_key=${key}&query=${encodeURIComponent(q)}`
    : `https://api.themoviedb.org/3/trending/movie/day?api_key=${key}`

  const res = await fetch(url, { next: { revalidate: q ? 0 : 3600 } })
  if (!res.ok) return Response.json({ error: 'upstream error' }, { status: 502 })

  const data = await res.json()
  const items = (data.results ?? []).slice(0, 10).map((m: Record<string, unknown>) => ({
    id: String(m.id),
    title: m.title as string,
    year: m.release_date ? String(m.release_date).slice(0, 4) : '',
    overview: m.overview as string,
    posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : null,
  }))

  return Response.json(items)
}

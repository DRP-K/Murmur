'use client'

import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'

type Category = 'movies' | 'music' | 'games'

interface MovieItem {
  id: string
  title: string
  year: string
  overview: string
  posterUrl: string | null
}

interface MusicItem {
  id: string
  track: string
  artist: string
  imageUrl: string | null
}

interface GameItem {
  id: string
  name: string
  genres: string
  imageUrl: string | null
}

type AnyItem = MovieItem | MusicItem | GameItem

function buildTemplate(category: Category, item: AnyItem): string {
  if (category === 'movies') {
    const m = item as MovieItem
    const year = m.year ? ` (${m.year})` : ''
    const snippet = m.overview ? ' — ' + m.overview.slice(0, 120).trimEnd() + (m.overview.length > 120 ? '…' : '') : ''
    return `Just watched ${m.title}${year}${snippet} 🎬`
  }
  if (category === 'music') {
    const s = item as MusicItem
    return `Can't stop listening to "${s.track}" by ${s.artist} 🎵`
  }
  const g = item as GameItem
  const genrePart = g.genres ? ` (${g.genres})` : ''
  return `Recently playing ${g.name}${genrePart} 🎮`
}

function itemLabel(category: Category, item: AnyItem): string {
  if (category === 'movies') return (item as MovieItem).title
  if (category === 'music') {
    const s = item as MusicItem
    return `${s.track}\n${s.artist}`
  }
  return (item as GameItem).name
}

function itemImage(category: Category, item: AnyItem): string | null {
  if (category === 'movies') return (item as MovieItem).posterUrl
  if (category === 'music') return (item as MusicItem).imageUrl
  return (item as GameItem).imageUrl
}

const TABS: { key: Category; label: string }[] = [
  { key: 'movies', label: '🎬 Movie' },
  { key: 'music', label: '🎵 Music' },
  { key: 'games', label: '🎮 Game' },
]

export interface SelectedSuggestion {
  text: string
  category: Category
  mediaRefName: string
  imageUrl: string | null
}

interface Props {
  onSelect: (suggestion: SelectedSuggestion) => void
}

export function PostSuggestions({ onSelect }: Props) {
  const [tab, setTab] = useState<Category>('movies')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<AnyItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function buildUrl(category: Category, q: string): string {
    const tmdb = process.env.NEXT_PUBLIC_TMDB_API_KEY
    const rawg = process.env.NEXT_PUBLIC_RAWG_API_KEY
    if (category === 'movies') {
      return q
        ? `https://api.themoviedb.org/3/search/movie?api_key=${tmdb}&query=${encodeURIComponent(q)}`
        : `https://api.themoviedb.org/3/trending/movie/day?api_key=${tmdb}`
    }
    if (category === 'music') {
      return q
        ? `https://api.deezer.com/search/track?q=${encodeURIComponent(q)}&limit=10`
        : `https://api.deezer.com/chart/0/tracks?limit=10`
    }
    return q
      ? `https://api.rawg.io/api/games?search=${encodeURIComponent(q)}&page_size=10&key=${rawg}`
      : `https://api.rawg.io/api/games?ordering=-added&page_size=10&key=${rawg}`
  }

  function normalise(category: Category, data: Record<string, unknown>): AnyItem[] {
    if (category === 'movies') {
      return ((data.results as Record<string, unknown>[]) ?? []).slice(0, 10).map((m) => ({
        id: String(m.id),
        title: m.title as string,
        year: m.release_date ? String(m.release_date).slice(0, 4) : '',
        overview: m.overview as string,
        posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : null,
      }))
    }
    if (category === 'music') {
      return ((data.data as Record<string, unknown>[]) ?? []).map((t) => ({
        id: String(t.id),
        track: t.title as string,
        artist: (t.artist as Record<string, string>).name,
        imageUrl: (t.album as Record<string, string>).cover_medium ?? null,
      }))
    }
    return ((data.results as Record<string, unknown>[]) ?? []).map((g) => ({
      id: String(g.id),
      name: g.name as string,
      genres: ((g.genres as { name: string }[]) ?? []).map((x) => x.name).join(', '),
      imageUrl: g.background_image as string | null,
    }))
  }

  function doFetch(category: Category, q: string) {
    setItems([])
    setError(null)
    setLoading(true)
    fetch(buildUrl(category, q))
      .then((r) => r.json())
      .then((data) => setItems(normalise(category, data)))
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setQuery('')
    doFetch(tab, '')
  }, [tab])

  function handleSearch(value: string) {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doFetch(tab, value.trim()), 400)
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
      <div className="mb-2.5 relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder={`Search ${tab}…`}
          className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-7 pr-3 text-xs text-zinc-800 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
        />
      </div>

      <div className="mb-2.5 flex gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              tab === t.key
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex-shrink-0 w-20 h-28 rounded-lg bg-zinc-200 animate-pulse dark:bg-zinc-700"
            />
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-500 py-1">{error}</p>}

      {!loading && !error && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {items.map((item) => {
            const img = itemImage(tab, item)
            const label = itemLabel(tab, item)
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  const mediaRefName =
                    tab === 'movies' ? (item as MovieItem).title
                    : tab === 'music' ? (item as MusicItem).track
                    : (item as GameItem).name
                  onSelect({ text: buildTemplate(tab, item), category: tab, mediaRefName, imageUrl: itemImage(tab, item) })
                }}
                className="flex-shrink-0 w-20 rounded-lg overflow-hidden border border-zinc-200 bg-white hover:border-zinc-400 transition-colors dark:border-zinc-600 dark:bg-zinc-700 dark:hover:border-zinc-400 text-left"
              >
                {img ? (
                  <img
                    src={img}
                    alt={label}
                    className="w-full h-28 object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-28 bg-zinc-200 dark:bg-zinc-600 flex items-center justify-center text-zinc-400 text-xs">
                    No art
                  </div>
                )}
                <div className="p-1.5">
                  <p className="text-[10px] text-zinc-700 dark:text-zinc-200 leading-tight line-clamp-2">
                    {label}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function normalizePostTag(input: string): string | null {
  const trimmed = input.trim().replace(/^#+/, '')
  if (!trimmed) return null

  let out = '#'
  let lastDash = false
  for (const char of trimmed.toLowerCase()) {
    if (/[a-z0-9]/.test(char)) {
      out += char
      lastDash = false
    } else if (!lastDash && out.length > 1) {
      out += '-'
      lastDash = true
    }
  }

  out = out.replace(/-+$/, '')
  if (out.length <= 1 || out.length > 50) return null
  if (out === '#games') return '#game'
  if (out === '#movies') return '#movie'
  return out
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  let row = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const next = [i]
    for (let j = 1; j <= n; j++) {
      next[j] = a[i - 1] === b[j - 1]
        ? row[j - 1]
        : 1 + Math.min(row[j - 1], row[j], next[j - 1])
    }
    row = next
  }
  return row[n]
}

// Returns true if `query` fuzzy-matches `tag` (tolerates typos).
// maxDist: 0 for queries ≤2 chars, 1 for 3–5 chars, 2 for ≥6 chars.
export function fuzzyMatchTag(tag: string, query: string): boolean {
  const t = tag.replace(/^#/, '').toLowerCase()
  const q = query.replace(/^#/, '').toLowerCase()
  if (!q) return true
  if (t.includes(q)) return true

  const maxDist = q.length <= 2 ? 0 : q.length <= 5 ? 1 : 2
  if (maxDist === 0) return false

  if (levenshtein(t, q) <= maxDist) return true

  // Sliding window: fuzzy-match query against each substring of similar length in tag
  for (let i = 0; i <= t.length - q.length + maxDist; i++) {
    for (let w = Math.max(1, q.length - maxDist); w <= q.length + maxDist && i + w <= t.length; w++) {
      if (levenshtein(t.slice(i, i + w), q) <= maxDist) return true
    }
  }

  return false
}

export function normalizePostTags(tags: string[]): string[] {
  const normalized: string[] = []
  for (const tag of tags) {
    const next = normalizePostTag(tag)
    if (next && !normalized.includes(next)) normalized.push(next)
  }
  return normalized
}

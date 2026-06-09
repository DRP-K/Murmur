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

export function normalizePostTags(tags: string[]): string[] {
  const normalized: string[] = []
  for (const tag of tags) {
    const next = normalizePostTag(tag)
    if (next && !normalized.includes(next)) normalized.push(next)
  }
  return normalized
}

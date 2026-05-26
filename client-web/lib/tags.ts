import { db, type LocalTag } from './db'

export async function createTag(name: string, color?: string): Promise<LocalTag> {
  const tag: LocalTag = {
    id: crypto.randomUUID(),
    name,
    color,
    createdAt: Math.floor(Date.now() / 1000),
  }
  await db.tags.add(tag)
  return tag
}

export async function renameTag(tagId: string, name: string): Promise<void> {
  await db.tags.update(tagId, { name })
}

export async function deleteTag(tagId: string): Promise<void> {
  await db.transaction('rw', [db.tags, db.friendTags, db.posts], async () => {
    await db.tags.delete(tagId)
    await db.friendTags.where('tagId').equals(tagId).delete()
    // Clear this tag from any local post audience records.
    const affected = await db.posts
      .filter((p) => Array.isArray(p.audienceTagIds) && p.audienceTagIds.includes(tagId))
      .toArray()
    for (const post of affected) {
      const next = (post.audienceTagIds ?? []).filter((id) => id !== tagId)
      await db.posts.update(post.id, { audienceTagIds: next.length ? next : undefined })
    }
  })
}

export async function setFriendTags(friendId: string, tagIds: string[]): Promise<void> {
  await db.transaction('rw', db.friendTags, async () => {
    await db.friendTags.where('friendId').equals(friendId).delete()
    for (const tagId of tagIds) {
      await db.friendTags.put({ friendId, tagId })
    }
  })
}

export async function getFriendTags(friendId: string): Promise<LocalTag[]> {
  const rows = await db.friendTags.where('friendId').equals(friendId).toArray()
  const tags = await Promise.all(rows.map((r) => db.tags.get(r.tagId)))
  return tags.filter((t): t is LocalTag => t !== undefined)
}

/** Returns the set of friend IDs that carry at least one of the given tag IDs. */
export async function resolveTags(tagIds: string[]): Promise<Set<string>> {
  const result = new Set<string>()
  for (const tagId of tagIds) {
    const rows = await db.friendTags.where('tagId').equals(tagId).toArray()
    for (const r of rows) result.add(r.friendId)
  }
  return result
}

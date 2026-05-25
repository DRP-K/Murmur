import { db, type Identity } from './db'
import { generateKeypair } from './crypto'

// Returns existing identity or generates one on first run.
export async function initIdentity(): Promise<Identity> {
  const existing = await db.identity.toCollection().first()
  if (existing) return existing

  const { privkeyHex, pubkeyHex, userId } = generateKeypair()
  const identity: Identity = { userId, pubkeyHex, privkeyHex, displayName: null }
  await db.identity.add(identity)
  return identity
}

export async function getIdentity(): Promise<Identity | undefined> {
  return db.identity.toCollection().first()
}

export async function updateDisplayName(displayName: string): Promise<void> {
  const identity = await getIdentity()
  if (!identity) throw new Error('no identity')
  await db.identity.update(identity.userId, { displayName })
}

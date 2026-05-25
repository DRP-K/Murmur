import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

export { bytesToHex, hexToBytes }

export interface Keypair {
  privkeyHex: string
  pubkeyHex: string
  userId: string
}

export function generateKeypair(): Keypair {
  const privkey = ed25519.utils.randomSecretKey()
  const pubkey = ed25519.getPublicKey(privkey)
  const hash = sha256(pubkey)
  const userId = bytesToHex(hash.slice(0, 16)) // 32 hex chars
  return {
    privkeyHex: bytesToHex(privkey),
    pubkeyHex: bytesToHex(pubkey),
    userId,
  }
}

// Signs "$user_id:$unix_ts" for relay auth challenge.
export function signAuthChallenge(privkeyHex: string, userId: string, timestamp: number): string {
  const msg = new TextEncoder().encode(`${userId}:${timestamp}`)
  const sig = ed25519.sign(msg, hexToBytes(privkeyHex))
  return bytesToHex(sig)
}

// Derives shared secret from Ed25519 keys via standard Ed25519→X25519 conversion
// (toMontgomerySecret on private, toMontgomery on public). The SPEC mentions a
// "SHA256-hash then DH" scheme but that is not commutative and cannot produce a
// matching shared secret on both sides — this correct conversion is used instead.
export function ecdh(ourPrivkeyHex: string, theirPubkeyHex: string): string {
  const x25519Priv = ed25519.utils.toMontgomerySecret(hexToBytes(ourPrivkeyHex))
  const x25519Pub = ed25519.utils.toMontgomery(hexToBytes(theirPubkeyHex))
  const shared = x25519.getSharedSecret(x25519Priv, x25519Pub)
  return bytesToHex(shared)
}

export interface EphemeralKeypair {
  privHex: string
  pubHex: string
}

export function generateEphemeralKeypair(): EphemeralKeypair {
  const priv = x25519.utils.randomSecretKey()
  const pub = x25519.getPublicKey(priv)
  return { privHex: bytesToHex(priv), pubHex: bytesToHex(pub) }
}

// thread_id = hex(SHA256(post_id_utf8_bytes || ephemeral_pub_bytes)[0..16])
export function computeThreadId(postId: string, ephemeralPubHex: string): string {
  const postIdBytes = new TextEncoder().encode(postId)
  const ephPubBytes = hexToBytes(ephemeralPubHex)
  const combined = new Uint8Array(postIdBytes.length + ephPubBytes.length)
  combined.set(postIdBytes)
  combined.set(ephPubBytes, postIdBytes.length)
  return bytesToHex(sha256(combined).slice(0, 16))
}

export function encodePayload(plaintext: string): string {
  return bytesToHex(new TextEncoder().encode(plaintext))
}

export function decodePayload(payloadHex: string): string {
  return new TextDecoder().decode(hexToBytes(payloadHex))
}

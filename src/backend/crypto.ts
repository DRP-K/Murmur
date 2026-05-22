import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/curves/utils.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return new Uint8Array(buf);
}

export interface CryptoKeypair {
  user_id: string;
  pubkey_hex: string;
  privkey_hex: string;
}

// ── Keypair ───────────────────────────────────────────────────────────────────

// Mirrors crypto.rs::generate_keypair().
// privkey_hex = 32-byte Ed25519 seed hex
// pubkey_hex  = 32-byte Ed25519 verifying key hex
// user_id     = hex(SHA256(pubkey_bytes)[0..16])
export async function generateKeypair(): Promise<CryptoKeypair> {
  const privBytes = ed25519.utils.randomSecretKey();
  const pubBytes = ed25519.getPublicKey(privBytes);
  const hash = await sha256(pubBytes);
  const user_id = bytesToHex(hash.slice(0, 16));
  return {
    user_id,
    pubkey_hex: bytesToHex(pubBytes),
    privkey_hex: bytesToHex(privBytes),
  };
}

// ── Signing ───────────────────────────────────────────────────────────────────

// Sign a UTF-8 message with an Ed25519 private key. Returns hex signature.
export function signMessage(privkeyHex: string, message: string): string {
  const sig = ed25519.sign(
    new TextEncoder().encode(message),
    hexToBytes(privkeyHex)
  );
  return bytesToHex(sig);
}

// ── ECDH ──────────────────────────────────────────────────────────────────────

// Mirrors crypto.rs::derive_shared_secret().
// Custom scheme: SHA256 both Ed25519 keys to obtain X25519 scalars, then DH.
export async function deriveSharedSecret(
  ourPrivkeyHex: string,
  theirPubkeyHex: string
): Promise<string> {
  const ourScalar = await sha256(hexToBytes(ourPrivkeyHex));
  const theirScalar = await sha256(hexToBytes(theirPubkeyHex));
  const shared = x25519.getSharedSecret(ourScalar, theirScalar);
  return bytesToHex(shared);
}

// ── Ephemeral keypair ─────────────────────────────────────────────────────────

// Generates a real X25519 ephemeral keypair (unlike the broken Rust version
// which discards the secret). Both halves are stored so DH can be performed.
export function generateEphemeralKeypair(): { pub_hex: string; prv_hex: string } {
  const prv = x25519.utils.randomSecretKey();
  const pub = x25519.getPublicKey(prv);
  return { pub_hex: bytesToHex(pub), prv_hex: bytesToHex(prv) };
}

// ── Encryption ────────────────────────────────────────────────────────────────

// ChaCha20-Poly1305 encrypt. Returns hex-encoded ciphertext + 12-byte nonce.
export function encryptMessage(
  sharedSecretHex: string,
  plaintext: string
): { payload_hex: string; nonce_hex: string } {
  const key = hexToBytes(sharedSecretHex);
  const nonce = randomBytes(12);
  const cipher = chacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(new TextEncoder().encode(plaintext));
  return { payload_hex: bytesToHex(ciphertext), nonce_hex: bytesToHex(nonce) };
}

// ChaCha20-Poly1305 decrypt. Returns plaintext string.
export function decryptMessage(
  sharedSecretHex: string,
  payload_hex: string,
  nonce_hex: string
): string {
  const key = hexToBytes(sharedSecretHex);
  const nonce = hexToBytes(nonce_hex);
  const cipher = chacha20poly1305(key, nonce);
  const plain = cipher.decrypt(hexToBytes(payload_hex));
  return new TextDecoder().decode(plain);
}

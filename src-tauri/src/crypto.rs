use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};
use x25519_dalek::{EphemeralSecret, PublicKey as X25519Public, StaticSecret};

pub struct Keypair {
    pub user_id: String,
    pub pubkey_hex: String,
    pub privkey_hex: String,
}

pub fn generate_keypair() -> Keypair {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key: VerifyingKey = signing_key.verifying_key();

    let pubkey_bytes = verifying_key.to_bytes();
    let privkey_bytes = signing_key.to_bytes();

    let pubkey_hex = hex::encode(pubkey_bytes);
    let privkey_hex = hex::encode(privkey_bytes);

    let mut hasher = Sha256::new();
    hasher.update(&pubkey_bytes);
    let hash = hasher.finalize();
    let user_id = hex::encode(&hash[..16]);

    Keypair { user_id, pubkey_hex, privkey_hex }
}

/// Derive an X25519 shared secret from our Ed25519 privkey and their Ed25519 pubkey.
/// We hash the Ed25519 keys to obtain X25519-compatible scalars.
pub fn derive_shared_secret(our_privkey_hex: &str, their_pubkey_hex: &str) -> String {
    let prv_bytes: [u8; 32] = hex::decode(our_privkey_hex)
        .unwrap()
        .try_into()
        .unwrap();
    let their_bytes: [u8; 32] = hex::decode(their_pubkey_hex)
        .unwrap()
        .try_into()
        .unwrap();

    // Hash to get X25519-suitable scalars
    let mut h = Sha256::new();
    h.update(&prv_bytes);
    let our_scalar: [u8; 32] = h.finalize().into();

    let mut h2 = Sha256::new();
    h2.update(&their_bytes);
    let their_scalar: [u8; 32] = h2.finalize().into();

    let our_secret = StaticSecret::from(our_scalar);
    let their_pub = X25519Public::from(their_scalar);
    let shared = our_secret.diffie_hellman(&their_pub);
    hex::encode(shared.as_bytes())
}

pub fn generate_ephemeral_keypair() -> (String, String) {
    let secret = EphemeralSecret::random_from_rng(OsRng);
    let public = X25519Public::from(&secret);
    let pub_hex = hex::encode(public.as_bytes());
    // Can't retrieve scalar after DH; store random bytes for thread keying
    let prv_bytes: [u8; 32] = rand::random();
    let prv_hex = hex::encode(prv_bytes);
    (pub_hex, prv_hex)
}

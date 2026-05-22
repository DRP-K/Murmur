use ed25519_dalek::{Signature, VerifyingKey, Verifier};
use std::collections::HashMap;
use std::sync::Mutex;
use once_cell::sync::Lazy;

/// In-memory session store: token → user_id
static SESSIONS: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn create_session(user_id: &str) -> String {
    let token = uuid::Uuid::new_v4().to_string();
    SESSIONS.lock().unwrap().insert(token.clone(), user_id.to_string());
    token
}

pub fn resolve_token(token: &str) -> Option<String> {
    SESSIONS.lock().unwrap().get(token).cloned()
}

/// Verify Ed25519 signature of `message` bytes using the stored pubkey.
pub fn verify_signature(
    pubkey_hex: &str,
    message: &[u8],
    signature_hex: &str,
) -> Result<(), String> {
    let pk_bytes: [u8; 32] = hex::decode(pubkey_hex)
        .map_err(|e| e.to_string())?
        .try_into()
        .map_err(|_| "bad pubkey length".to_string())?;
    let sig_bytes: [u8; 64] = hex::decode(signature_hex)
        .map_err(|e| e.to_string())?
        .try_into()
        .map_err(|_| "bad signature length".to_string())?;

    let vk = VerifyingKey::from_bytes(&pk_bytes).map_err(|e| e.to_string())?;
    let sig = Signature::from_bytes(&sig_bytes);
    vk.verify(message, &sig).map_err(|e| e.to_string())
}

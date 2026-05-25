use diesel::SqliteConnection;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};

use crate::db::repository;
use crate::wire::AuthRequest;

pub const AUTH_WINDOW_SECONDS: i64 = 5 * 60;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AuthError {
    #[error("malformed public key")]
    MalformedPublicKey,
    #[error("user id does not match public key")]
    UserIdMismatch,
    #[error("unknown user")]
    UnknownUser,
    #[error("timestamp outside auth window")]
    TimestampOutsideWindow,
    #[error("malformed signature")]
    MalformedSignature,
    #[error("invalid signature")]
    InvalidSignature,
}

pub fn user_id_for_pubkey(pubkey_bytes: &[u8]) -> String {
    // Stable identity digest.
    let digest = Sha256::digest(pubkey_bytes);
    hex::encode(&digest[..16])
}

pub fn validate_registration(user_id: &str, pubkey_hex: &str) -> Result<(), AuthError> {
    // Hex-encoded Ed25519 key.
    let pubkey = hex::decode(pubkey_hex).map_err(|_| AuthError::MalformedPublicKey)?;
    let pubkey: [u8; 32] = pubkey
        .try_into()
        .map_err(|_| AuthError::MalformedPublicKey)?;

    // User id binds to pubkey.
    if user_id_for_pubkey(&pubkey) != user_id {
        return Err(AuthError::UserIdMismatch);
    }

    // Reject invalid curve encodings.
    VerifyingKey::from_bytes(&pubkey).map_err(|_| AuthError::MalformedPublicKey)?;
    Ok(())
}

pub fn verify_auth_request(
    conn: &mut SqliteConnection,
    request: &AuthRequest,
    now: i64,
) -> Result<(), AuthError> {
    // Replay window check.
    if (request.timestamp - now).abs() > AUTH_WINDOW_SECONDS {
        return Err(AuthError::TimestampOutsideWindow);
    }

    // Stored registration key.
    let user = repository::get_user(conn, &request.user_id).map_err(|_| AuthError::UnknownUser)?;
    let pubkey = hex::decode(user.pubkey_hex).map_err(|_| AuthError::MalformedPublicKey)?;
    let pubkey: [u8; 32] = pubkey
        .try_into()
        .map_err(|_| AuthError::MalformedPublicKey)?;
    let verifying_key =
        VerifyingKey::from_bytes(&pubkey).map_err(|_| AuthError::MalformedPublicKey)?;
    let signature = Signature::from_slice(
        &hex::decode(&request.signature_hex).map_err(|_| AuthError::MalformedSignature)?,
    )
    .map_err(|_| AuthError::MalformedSignature)?;

    // Spec challenge string.
    let message = format!("{}:{}", request.user_id, request.timestamp);
    verifying_key
        .verify(message.as_bytes(), &signature)
        .map_err(|_| AuthError::InvalidSignature)
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::{Signer, SigningKey};

    use crate::db::repository;
    use crate::db::{establish_connection, run_migrations};

    use super::*;

    fn setup_conn() -> SqliteConnection {
        let mut conn = establish_connection(":memory:").expect("in-memory sqlite should open");
        run_migrations(&mut conn).expect("migrations should run");
        conn
    }

    fn signing_key() -> SigningKey {
        SigningKey::from_bytes(&[7; 32])
    }

    fn signed_request(timestamp: i64) -> AuthRequest {
        let key = signing_key();
        let pubkey = key.verifying_key().to_bytes();
        let user_id = user_id_for_pubkey(&pubkey);
        let message = format!("{user_id}:{timestamp}");
        let signature = key.sign(message.as_bytes());

        AuthRequest {
            user_id,
            timestamp,
            signature_hex: hex::encode(signature.to_bytes()),
        }
    }

    #[test]
    fn verifies_valid_signature() {
        let mut conn = setup_conn();
        let key = signing_key();
        let pubkey_hex = hex::encode(key.verifying_key().to_bytes());
        let req = signed_request(1_000);
        repository::register_user(&mut conn, &req.user_id, &pubkey_hex, 1)
            .expect("user should register");

        assert_eq!(verify_auth_request(&mut conn, &req, 1_000), Ok(()));
    }

    #[test]
    fn rejects_invalid_auth_cases() {
        let mut conn = setup_conn();
        let key = signing_key();
        let pubkey_hex = hex::encode(key.verifying_key().to_bytes());
        let req = signed_request(1_000);
        repository::register_user(&mut conn, &req.user_id, &pubkey_hex, 1)
            .expect("user should register");

        assert_eq!(
            verify_auth_request(&mut conn, &req, 2_000),
            Err(AuthError::TimestampOutsideWindow)
        );

        let mut bad_signature = signed_request(1_000);
        bad_signature.signature_hex = hex::encode([0; 64]);
        assert_eq!(
            verify_auth_request(&mut conn, &bad_signature, 1_000),
            Err(AuthError::InvalidSignature)
        );

        let unknown = AuthRequest {
            user_id: user_id_for_pubkey(&[8; 32]),
            timestamp: 1_000,
            signature_hex: req.signature_hex,
        };
        assert_eq!(
            verify_auth_request(&mut conn, &unknown, 1_000),
            Err(AuthError::UnknownUser)
        );

        let malformed = AuthRequest {
            signature_hex: "not-hex".to_string(),
            ..signed_request(1_000)
        };
        assert_eq!(
            verify_auth_request(&mut conn, &malformed, 1_000),
            Err(AuthError::MalformedSignature)
        );
    }
}

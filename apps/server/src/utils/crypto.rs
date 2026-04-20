use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    AeadCore, Aes256Gcm,
};
use anyhow::{anyhow, Result};
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

// v1: SHA-256 key derivation (legacy, decrypt-only)
const ENCRYPTED_V1_PREFIX: &str = "enc:";
// v2: HKDF key derivation (current, used for all new encryptions)
const ENCRYPTED_V2_PREFIX: &str = "enc2:";

/// Derive a 32-byte key using HKDF-SHA256.
/// HKDF provides proper domain separation and avoids the length-extension
/// weakness of raw SHA-256 hashing.
fn derive_key_hkdf(secret: &str) -> [u8; 32] {
    // RFC 5869 HKDF-Extract: PRK = HMAC-SHA256(salt=key, IKM=secret)
    // salt = b"bugwatch-token-key-v2" (fixed, domain-separating)
    // IKM  = secret (the raw encryption key material)
    let mut mac = <HmacSha256 as KeyInit>::new_from_slice(b"bugwatch-token-key-v2")
        .expect("HMAC accepts any key size");
    mac.update(secret.as_bytes());
    let prk = mac.finalize().into_bytes();

    // RFC 5869 HKDF-Expand (single block): T(1) = HMAC-SHA256(PRK, info=b"aes256gcm" || 0x01)
    let mut mac = <HmacSha256 as KeyInit>::new_from_slice(&prk).expect("HMAC accepts any key size");
    mac.update(b"aes256gcm\x01");
    mac.finalize().into_bytes().into()
}

/// Legacy SHA-256 key derivation — used only for decrypting v1 tokens.
fn derive_key_v1(secret: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.finalize().into()
}

/// Check if a token string is in encrypted format (either v1 or v2).
pub fn is_encrypted(token: &str) -> bool {
    token.starts_with(ENCRYPTED_V2_PREFIX) || token.starts_with(ENCRYPTED_V1_PREFIX)
}

/// Encrypt a plaintext token using AES-256-GCM with HKDF key derivation.
/// Returns `enc2:nonce_base64:ciphertext_base64`.
pub fn encrypt_token(plaintext: &str, key: &str) -> Result<String> {
    let key_bytes = derive_key_hkdf(key);
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| anyhow!("Failed to create cipher: {}", e))?;

    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| anyhow!("Encryption failed: {}", e))?;

    let engine = base64::engine::general_purpose::STANDARD;
    let nonce_b64 = engine.encode(nonce);
    let ct_b64 = engine.encode(ciphertext);

    Ok(format!("{}{}:{}", ENCRYPTED_V2_PREFIX, nonce_b64, ct_b64))
}

/// Decrypt a token encrypted with `encrypt_token`.
/// Supports both v2 (`enc2:`) and legacy v1 (`enc:`) formats so existing
/// tokens remain readable during the transition window.
pub fn decrypt_token(encrypted: &str, key: &str) -> Result<String> {
    let (data, key_bytes) = if let Some(d) = encrypted.strip_prefix(ENCRYPTED_V2_PREFIX) {
        (d, derive_key_hkdf(key))
    } else if let Some(d) = encrypted.strip_prefix(ENCRYPTED_V1_PREFIX) {
        (d, derive_key_v1(key))
    } else {
        return Err(anyhow!(
            "Token is not in encrypted format — expected 'enc:' or 'enc2:' prefix"
        ));
    };

    let parts: Vec<&str> = data.splitn(2, ':').collect();
    if parts.len() != 2 {
        return Err(anyhow!("Invalid encrypted token format"));
    }

    let engine = base64::engine::general_purpose::STANDARD;
    let nonce_bytes = engine
        .decode(parts[0])
        .map_err(|e| anyhow!("Invalid nonce encoding: {}", e))?;
    let ciphertext = engine
        .decode(parts[1])
        .map_err(|e| anyhow!("Invalid ciphertext encoding: {}", e))?;

    if nonce_bytes.len() != 12 {
        return Err(anyhow!(
            "Invalid nonce length: expected 12 bytes, got {}",
            nonce_bytes.len()
        ));
    }

    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| anyhow!("Failed to create cipher: {}", e))?;

    let nonce = aes_gcm::Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).map_err(|e| {
        tracing::warn!(
            "AES-GCM decryption failed — possible key mismatch or tampered token: {}",
            e
        );
        anyhow!("Decryption failed: {}", e)
    })?;

    String::from_utf8(plaintext).map_err(|e| anyhow!("Invalid UTF-8 in decrypted token: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = "my-super-secret-encryption-key-32chars";
        let plaintext = "ghp_1234567890abcdef";

        let encrypted = encrypt_token(plaintext, key).unwrap();
        assert_ne!(encrypted, plaintext);
        assert!(encrypted.starts_with("enc2:"));
        assert!(is_encrypted(&encrypted));

        let decrypted = decrypt_token(&encrypted, key).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_different_keys_fail() {
        let key1 = "key-one-for-encryption";
        let key2 = "key-two-for-decryption";
        let plaintext = "secret-token";

        let encrypted = encrypt_token(plaintext, key1).unwrap();
        assert!(decrypt_token(&encrypted, key2).is_err());
    }

    #[test]
    fn test_invalid_format() {
        assert!(decrypt_token("no-colon-here", "key").is_err());
    }

    #[test]
    fn test_plaintext_with_colon_not_detected_as_encrypted() {
        // Plaintext tokens containing ':' should NOT be detected as encrypted
        assert!(!is_encrypted("ghp_abc:def"));
        assert!(!is_encrypted("token:with:colons"));
    }

    #[test]
    fn test_v1_legacy_tokens_still_decrypt() {
        let key = "legacy-key";
        let key_bytes = derive_key_v1(key);
        let cipher = Aes256Gcm::new_from_slice(&key_bytes).unwrap();
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ct = cipher
            .encrypt(&nonce, b"legacy-plaintext".as_ref())
            .unwrap();
        let engine = base64::engine::general_purpose::STANDARD;
        let v1_token = format!("enc:{}:{}", engine.encode(nonce), engine.encode(ct));
        assert_eq!(decrypt_token(&v1_token, key).unwrap(), "legacy-plaintext");
    }

    #[test]
    fn test_v2_and_v1_are_distinct_keys() {
        let key = "shared-key";
        let v1 = derive_key_v1(key);
        let v2 = derive_key_hkdf(key);
        assert_ne!(v1, v2, "HKDF and SHA-256 keys must differ");
    }

    #[test]
    fn test_invalid_nonce_length() {
        // Craft a token with wrong nonce length
        use base64::Engine;
        let engine = base64::engine::general_purpose::STANDARD;
        let bad_nonce = engine.encode(&[0u8; 5]); // 5 bytes, not 12
        let fake_ct = engine.encode(b"fake");
        let bad_token = format!("enc:{}:{}", bad_nonce, fake_ct);
        assert!(decrypt_token(&bad_token, "key").is_err());
    }
}

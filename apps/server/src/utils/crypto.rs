use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    AeadCore, Aes256Gcm,
};
use anyhow::{anyhow, Result};
use base64::Engine;
use sha2::{Digest, Sha256};

/// Derive a 32-byte AES-256 key from a variable-length secret.
fn derive_key(secret: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.finalize().into()
}

/// Prefix for encrypted tokens to reliably distinguish from plaintext.
const ENCRYPTED_PREFIX: &str = "enc:";

/// Encrypt a plaintext token using AES-256-GCM.
/// Returns a string in the format `enc:nonce_base64:ciphertext_base64`.
pub fn encrypt_token(plaintext: &str, key: &str) -> Result<String> {
    let key_bytes = derive_key(key);
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| anyhow!("Failed to create cipher: {}", e))?;

    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| anyhow!("Encryption failed: {}", e))?;

    let engine = base64::engine::general_purpose::STANDARD;
    let nonce_b64 = engine.encode(nonce);
    let ct_b64 = engine.encode(ciphertext);

    Ok(format!("{}{}:{}", ENCRYPTED_PREFIX, nonce_b64, ct_b64))
}

/// Check if a token string is in encrypted format.
pub fn is_encrypted(token: &str) -> bool {
    token.starts_with(ENCRYPTED_PREFIX)
}

/// Decrypt a token that was encrypted with `encrypt_token`.
/// Input must be in the format `enc:nonce_base64:ciphertext_base64`.
/// Also accepts legacy format `nonce_base64:ciphertext_base64` (without prefix).
pub fn decrypt_token(encrypted: &str, key: &str) -> Result<String> {
    // Strip the "enc:" prefix if present
    let data = encrypted
        .strip_prefix(ENCRYPTED_PREFIX)
        .unwrap_or(encrypted);

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

    // AES-256-GCM nonce must be exactly 12 bytes (96 bits)
    if nonce_bytes.len() != 12 {
        return Err(anyhow!(
            "Invalid nonce length: expected 12 bytes, got {}",
            nonce_bytes.len()
        ));
    }

    let key_bytes = derive_key(key);
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| anyhow!("Failed to create cipher: {}", e))?;

    let nonce = aes_gcm::Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| anyhow!("Decryption failed: {}", e))?;

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
        assert!(encrypted.starts_with("enc:"));
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

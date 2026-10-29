use bcrypt::{hash, verify, DEFAULT_COST};

use crate::{AppError, AppResult};

/// Hash a password using bcrypt
pub fn hash_password(password: &str) -> AppResult<String> {
    hash(password, DEFAULT_COST)
        .map_err(|e| AppError::Internal(format!("Failed to hash password: {}", e)))
}

/// Verify a password against a hash
pub fn verify_password(password: &str, hash: &str) -> AppResult<bool> {
    verify(password, hash)
        .map_err(|e| AppError::Internal(format!("Failed to verify password: {}", e)))
}

/// Validate password requirements
pub fn validate_password(password: &str) -> AppResult<()> {
    if password.len() > 128 {
        return Err(AppError::Validation(
            "Password must be at most 128 characters".to_string(),
        ));
    }
    if password.len() < 8 {
        return Err(AppError::Validation(
            "Password must be at least 8 characters".to_string(),
        ));
    }

    let has_uppercase = password.chars().any(|c| c.is_uppercase());
    let has_lowercase = password.chars().any(|c| c.is_lowercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());

    if !has_uppercase {
        return Err(AppError::Validation(
            "Password must contain at least one uppercase letter".to_string(),
        ));
    }

    if !has_lowercase {
        return Err(AppError::Validation(
            "Password must contain at least one lowercase letter".to_string(),
        ));
    }

    if !has_digit {
        return Err(AppError::Validation(
            "Password must contain at least one number".to_string(),
        ));
    }

    Ok(())
}

/// Validate email format using a proper regex pattern
pub fn validate_email(email: &str) -> AppResult<()> {
    use regex::Regex;
    use std::sync::LazyLock;

    // HTML5 email pattern - good enough for practical use
    static EMAIL_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$").unwrap()
    });

    if email.len() < 3 {
        return Err(AppError::Validation("Email address too short".to_string()));
    }

    if email.len() > 254 {
        return Err(AppError::Validation(
            "Email address too long (max 254 characters)".to_string(),
        ));
    }

    if !EMAIL_RE.is_match(email) {
        return Err(AppError::Validation("Invalid email format".to_string()));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── validate_password ────────────────────────────────────────────────────

    #[test]
    fn test_valid_password() {
        assert!(validate_password("Password1").is_ok());
    }

    #[test]
    fn test_password_too_short() {
        let err = validate_password("short").unwrap_err();
        assert!(
            err.to_string().contains("at least 8 characters"),
            "unexpected message: {err}"
        );
    }

    #[test]
    fn test_password_exactly_8_chars() {
        // "Passwor1" — 8 chars, has upper, lower, digit
        assert!(validate_password("Passwor1").is_ok());
    }

    #[test]
    fn test_password_128_chars() {
        // 125 lowercase 'a' + 'A' + '1' + 'a' = 128 chars, satisfies all rules
        let pw = format!("{}A1a", "a".repeat(125));
        assert_eq!(pw.len(), 128);
        assert!(validate_password(&pw).is_ok());
    }

    #[test]
    fn test_password_129_chars_too_long() {
        // 126 'a' + 'A' + '1' + 'a' = 129 chars
        let pw = format!("{}A1a", "a".repeat(126));
        assert_eq!(pw.len(), 129);
        let err = validate_password(&pw).unwrap_err();
        assert!(
            err.to_string().contains("at most 128 characters"),
            "unexpected message: {err}"
        );
    }

    #[test]
    fn test_password_no_uppercase() {
        let err = validate_password("password1").unwrap_err();
        assert!(
            err.to_string().contains("uppercase"),
            "unexpected message: {err}"
        );
    }

    #[test]
    fn test_password_no_lowercase() {
        let err = validate_password("PASSWORD1").unwrap_err();
        assert!(
            err.to_string().contains("lowercase"),
            "unexpected message: {err}"
        );
    }

    #[test]
    fn test_password_no_digit() {
        let err = validate_password("PasswordA").unwrap_err();
        assert!(
            err.to_string().contains("number"),
            "unexpected message: {err}"
        );
    }

    // ── validate_email ───────────────────────────────────────────────────────

    #[test]
    fn test_valid_email_simple() {
        assert!(validate_email("user@example.com").is_ok());
    }

    #[test]
    fn test_valid_email_subdomain() {
        assert!(validate_email("user@sub.example.co.uk").is_ok());
    }

    #[test]
    fn test_email_too_short() {
        // "ab" is 2 chars, below the 3-char minimum
        let err = validate_email("ab").unwrap_err();
        assert!(
            err.to_string().contains("too short"),
            "unexpected message: {err}"
        );
    }

    #[test]
    fn test_email_too_long() {
        // 255-char string exceeds the 254-char maximum
        let long_email = "a".repeat(255);
        let err = validate_email(&long_email).unwrap_err();
        assert!(
            err.to_string().contains("too long"),
            "unexpected message: {err}"
        );
    }

    #[test]
    fn test_email_no_at_sign() {
        let err = validate_email("notanemail").unwrap_err();
        assert!(
            err.to_string().contains("Invalid email format"),
            "unexpected message: {err}"
        );
    }

    #[test]
    fn test_email_at_sign_only_domain() {
        // "@example.com" — local part is empty; the HTML5 regex requires at least one
        // character before '@', so this should fail.
        let err = validate_email("@example.com").unwrap_err();
        assert!(
            err.to_string().contains("Invalid email format"),
            "unexpected message: {err}"
        );
    }

    #[test]
    fn test_email_no_domain() {
        let err = validate_email("user@").unwrap_err();
        assert!(
            err.to_string().contains("Invalid email format"),
            "unexpected message: {err}"
        );
    }

    // ── hash_password / verify_password ─────────────────────────────────────

    #[test]
    fn test_hash_password_produces_hash() {
        let hashed = hash_password("Password1").expect("hash should succeed");
        assert_ne!(hashed, "Password1", "hash must differ from plaintext");
        // bcrypt hashes start with "$2b$" or "$2a$"
        assert!(
            hashed.starts_with("$2"),
            "expected a bcrypt hash, got: {hashed}"
        );
    }

    #[test]
    fn test_verify_password_correct() {
        let hashed = hash_password("Password1").expect("hash should succeed");
        let result = verify_password("Password1", &hashed).expect("verify should succeed");
        assert!(result, "correct password should verify as true");
    }

    #[test]
    fn test_verify_password_wrong() {
        let hashed = hash_password("Password1").expect("hash should succeed");
        let result = verify_password("WrongPass1", &hashed).expect("verify should succeed");
        assert!(!result, "wrong password should verify as false");
    }

    #[test]
    fn test_hash_password_random_salt() {
        // bcrypt uses a random salt per call — two hashes of the same input must differ
        let hash1 = hash_password("Password1").expect("first hash should succeed");
        let hash2 = hash_password("Password1").expect("second hash should succeed");
        assert_ne!(
            hash1, hash2,
            "bcrypt hashes should differ due to random salt"
        );
    }
}

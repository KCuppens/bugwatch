use anyhow::Result;

use crate::{db::repositories::LogRepository, db::DbPool};

// ============================================================================
// Service
// ============================================================================

/// Background service that links recent error/fatal log entries to open issues
/// by matching a SHA-256 fingerprint of the log message against open issue
/// fingerprints in the same project. Runs every 60 seconds.
pub struct LogIssueLinker {
    #[allow(dead_code)] // used once Slice A creates the log_entries table
    db: DbPool,
}

impl LogIssueLinker {
    pub fn new(db: DbPool) -> Self {
        Self { db }
    }

    /// Run one link cycle:
    /// 1. Find error/fatal log entries from the last 5 minutes with no issue_id.
    /// 2. For each log, hash its message → 16-char hex fingerprint.
    /// 3. Look for an open issue with matching fingerprint in the same project.
    /// 4. If found, update the log row to set `issue_id`.
    pub async fn run_once(&self) -> Result<()> {
        // ── Step 1: fetch recent unlinked error/fatal logs ─────────────────────
        let since = chrono::Utc::now() - chrono::Duration::minutes(5);

        #[derive(sqlx::FromRow)]
        struct LogRow {
            id: String,
            project_id: String,
            message: String,
        }

        let rows: Vec<LogRow> = sqlx::query_as(
            "SELECT id, project_id, message \
             FROM logs \
             WHERE level IN ('error', 'fatal') \
               AND issue_id IS NULL \
               AND timestamp >= $1::timestamptz \
             LIMIT 500",
        )
        .bind(since.to_rfc3339())
        .fetch_all(&self.db)
        .await?;

        let total = rows.len();
        let mut linked: usize = 0;

        for row in &rows {
            if row.message.is_empty() {
                continue;
            }

            // ── Step 2: compute 16-char hex fingerprint ────────────────────
            let fingerprint = log_message_fingerprint(&row.message);

            // ── Step 3: look for an open issue with matching fingerprint ───
            #[derive(sqlx::FromRow)]
            struct IssueRow {
                id: String,
            }

            let maybe_issue: Option<IssueRow> = sqlx::query_as(
                "SELECT id FROM issues \
                 WHERE project_id = $1 \
                   AND fingerprint = $2 \
                   AND status != 'resolved' \
                 LIMIT 1",
            )
            .bind(&row.project_id)
            .bind(&fingerprint)
            .fetch_optional(&self.db)
            .await?;

            // ── Step 4: set issue_id if a match was found ──────────────────
            if let Some(issue) = maybe_issue {
                LogRepository::set_issue_link(&self.db, &row.project_id, &row.id, Some(&issue.id))
                    .await?;
                linked += 1;
            }
        }

        tracing::debug!(
            total_processed = total,
            linked = linked,
            "Issue linker: processed {} logs, linked {}",
            total,
            linked
        );

        Ok(())
    }
}

// ============================================================================
// Fingerprint helper
// ============================================================================

/// Compute a 16-character lowercase hex fingerprint for a log message.
///
/// Uses the first 8 bytes of SHA-256(message), producing a 16-char hex string
/// that matches the fingerprint format used elsewhere in the codebase (e.g.
/// `events.rs` → `sha256_fingerprint`).
pub(crate) fn log_message_fingerprint(message: &str) -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(message.as_bytes());
    hex::encode(&hash[..8]) // 8 bytes → 16 hex chars
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ── fingerprint properties ────────────────────────────────────────────────

    /// The fingerprint must be exactly 16 lowercase hex characters.
    #[test]
    fn fingerprint_is_16_hex_chars() {
        let fp = log_message_fingerprint("database connection refused");
        assert_eq!(
            fp.len(),
            16,
            "fingerprint must be 16 chars, got {}",
            fp.len()
        );
        assert!(
            fp.chars().all(|c| c.is_ascii_hexdigit()),
            "fingerprint must be all hex digits, got '{}'",
            fp
        );
    }

    /// The same message always produces the same fingerprint (deterministic).
    #[test]
    fn fingerprint_is_deterministic() {
        let msg = "NullPointerException in OrderService";
        let fp1 = log_message_fingerprint(msg);
        let fp2 = log_message_fingerprint(msg);
        assert_eq!(fp1, fp2);
    }

    /// Different messages produce different fingerprints.
    #[test]
    fn fingerprint_different_messages_differ() {
        let fp1 = log_message_fingerprint("error: timeout on /api/orders");
        let fp2 = log_message_fingerprint("error: timeout on /api/users");
        assert_ne!(fp1, fp2);
    }

    /// An empty message produces a valid 16-char hex fingerprint.
    #[test]
    fn fingerprint_empty_message_is_valid() {
        let fp = log_message_fingerprint("");
        assert_eq!(fp.len(), 16);
        assert!(fp.chars().all(|c| c.is_ascii_hexdigit()));
    }

    /// Fingerprint is lowercase hex (matches fingerprint format in events.rs).
    #[test]
    fn fingerprint_is_lowercase() {
        let fp = log_message_fingerprint("UPPERCASE ERROR MESSAGE");
        assert_eq!(fp, fp.to_lowercase());
    }

    /// Known-value test: SHA-256("hello") first 8 bytes → "2cf24dba5f".
    /// Verifies we're using the correct truncation.
    #[test]
    fn fingerprint_known_value() {
        // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
        // First 8 bytes (16 hex chars) = "2cf24dba5fb0a30e"
        let fp = log_message_fingerprint("hello");
        assert_eq!(fp, "2cf24dba5fb0a30e");
    }
}

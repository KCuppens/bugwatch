use crate::db::{models::SourceMapMeta, DbPool};
use anyhow::Result;
use chrono::Utc;
use uuid::Uuid;

/// Column list for metadata queries; deliberately excludes the `data` payload.
const META_COLUMNS: &str = "id, project_id, release, dist, bundle, size, \
     octet_length(data)::BIGINT AS compressed_size, created_at";

pub struct SourceMapRepository;

impl SourceMapRepository {
    /// Insert a source map, or replace the existing one for the same
    /// (project, release, dist, bundle). `data` is the already-compressed
    /// payload and `size` the uncompressed length.
    pub async fn upsert(
        pool: &DbPool,
        project_id: &str,
        release: &str,
        dist: &str,
        bundle: &str,
        data: &[u8],
        size: i64,
    ) -> Result<SourceMapMeta> {
        let id = Uuid::new_v4().to_string();
        let sql = format!(
            r#"
            INSERT INTO source_maps (id, project_id, release, dist, bundle, data, size, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (project_id, release, dist, bundle)
            DO UPDATE SET data = EXCLUDED.data, size = EXCLUDED.size, created_at = EXCLUDED.created_at
            RETURNING {META_COLUMNS}
            "#
        );
        sqlx::query_as::<_, SourceMapMeta>(&sql)
            .bind(&id)
            .bind(project_id)
            .bind(release)
            .bind(dist)
            .bind(bundle)
            .bind(data)
            .bind(size)
            .bind(Utc::now())
            .fetch_one(pool)
            .await
            .map_err(Into::into)
    }

    /// List source maps for a project, optionally restricted to one release.
    pub async fn list(
        pool: &DbPool,
        project_id: &str,
        release: Option<&str>,
    ) -> Result<Vec<SourceMapMeta>> {
        let sql = format!(
            r#"
            SELECT {META_COLUMNS} FROM source_maps
            WHERE project_id = $1 AND ($2::TEXT IS NULL OR release = $2)
            ORDER BY created_at DESC
            LIMIT 1000
            "#
        );
        sqlx::query_as::<_, SourceMapMeta>(&sql)
            .bind(project_id)
            .bind(release)
            .fetch_all(pool)
            .await
            .map_err(Into::into)
    }

    /// Fetch the compressed payload for an exact (project, release, dist, bundle) key.
    pub async fn find_data(
        pool: &DbPool,
        project_id: &str,
        release: &str,
        dist: &str,
        bundle: &str,
    ) -> Result<Option<Vec<u8>>> {
        sqlx::query_scalar::<_, Vec<u8>>(
            r#"
            SELECT data FROM source_maps
            WHERE project_id = $1 AND release = $2 AND dist = $3 AND bundle = $4
            "#,
        )
        .bind(project_id)
        .bind(release)
        .bind(dist)
        .bind(bundle)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
    }

    /// Delete a source map by id, scoped to the project. Returns the deleted
    /// row's metadata (so callers can invalidate caches) or `None` if absent.
    pub async fn delete(
        pool: &DbPool,
        id: &str,
        project_id: &str,
    ) -> Result<Option<SourceMapMeta>> {
        let sql = format!(
            "DELETE FROM source_maps WHERE id = $1 AND project_id = $2 RETURNING {META_COLUMNS}"
        );
        sqlx::query_as::<_, SourceMapMeta>(&sql)
            .bind(id)
            .bind(project_id)
            .fetch_optional(pool)
            .await
            .map_err(Into::into)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repositories::ProjectRepository;
    use crate::db::test_helpers::test_any_pool;

    async fn project(pool: &DbPool, slug: &str) -> String {
        ProjectRepository::create(pool, "App", slug, "owner-sm", None, None, None)
            .await
            .unwrap()
            .id
    }

    #[tokio::test]
    async fn upsert_inserts_then_replaces_on_same_key() {
        let pool = test_any_pool().await;
        let pid = project(&pool, "sm-upsert").await;

        let first =
            SourceMapRepository::upsert(&pool, &pid, "1.0.0", "", "main.jsbundle", b"aaa", 30)
                .await
                .unwrap();
        assert_eq!(first.size, 30);
        assert_eq!(first.compressed_size, 3);
        assert_eq!(first.dist, "");

        let second =
            SourceMapRepository::upsert(&pool, &pid, "1.0.0", "", "main.jsbundle", b"bbbbb", 50)
                .await
                .unwrap();
        assert_eq!(second.id, first.id, "upsert keeps the row identity");
        assert_eq!(second.size, 50);
        assert_eq!(second.compressed_size, 5);

        let data = SourceMapRepository::find_data(&pool, &pid, "1.0.0", "", "main.jsbundle")
            .await
            .unwrap();
        assert_eq!(data.as_deref(), Some(&b"bbbbb"[..]));
        assert_eq!(
            SourceMapRepository::list(&pool, &pid, None)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn key_distinguishes_dist_and_bundle() {
        let pool = test_any_pool().await;
        let pid = project(&pool, "sm-key").await;

        for (dist, bundle) in [("", "a.bundle"), ("7", "a.bundle"), ("", "b.bundle")] {
            SourceMapRepository::upsert(&pool, &pid, "2.0.0", dist, bundle, b"x", 1)
                .await
                .unwrap();
        }
        assert_eq!(
            SourceMapRepository::list(&pool, &pid, Some("2.0.0"))
                .await
                .unwrap()
                .len(),
            3
        );
        assert!(
            SourceMapRepository::find_data(&pool, &pid, "2.0.0", "7", "b.bundle")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn list_filters_by_release_and_project() {
        let pool = test_any_pool().await;
        let a = project(&pool, "sm-list-a").await;
        let b = project(&pool, "sm-list-b").await;

        SourceMapRepository::upsert(&pool, &a, "1", "", "x", b"1", 1)
            .await
            .unwrap();
        SourceMapRepository::upsert(&pool, &a, "2", "", "x", b"1", 1)
            .await
            .unwrap();
        SourceMapRepository::upsert(&pool, &b, "1", "", "x", b"1", 1)
            .await
            .unwrap();

        assert_eq!(
            SourceMapRepository::list(&pool, &a, None)
                .await
                .unwrap()
                .len(),
            2
        );
        let only_one = SourceMapRepository::list(&pool, &a, Some("1"))
            .await
            .unwrap();
        assert_eq!(only_one.len(), 1);
        assert_eq!(only_one[0].release, "1");
        assert_eq!(
            SourceMapRepository::list(&pool, &b, None)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn delete_is_scoped_to_project() {
        let pool = test_any_pool().await;
        let a = project(&pool, "sm-del-a").await;
        let b = project(&pool, "sm-del-b").await;
        let meta = SourceMapRepository::upsert(&pool, &a, "1", "d", "x", b"1", 1)
            .await
            .unwrap();

        assert!(SourceMapRepository::delete(&pool, &meta.id, &b)
            .await
            .unwrap()
            .is_none());
        let deleted = SourceMapRepository::delete(&pool, &meta.id, &a)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            (
                deleted.release.as_str(),
                deleted.dist.as_str(),
                deleted.bundle.as_str()
            ),
            ("1", "d", "x")
        );
        assert!(SourceMapRepository::delete(&pool, &meta.id, &a)
            .await
            .unwrap()
            .is_none());
    }
}

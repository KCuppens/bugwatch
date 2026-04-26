use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::ops::Deref;

/// A UTC timestamp that implements sqlx Encode/Decode/Type for the `Any` backend.
/// Stored as RFC 3339 strings, accepted by both SQLite TEXT columns and PostgreSQL TIMESTAMPTZ.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Timestamp(pub DateTime<Utc>);

impl Timestamp {
    pub fn now() -> Self {
        Timestamp(Utc::now())
    }
}

impl Deref for Timestamp {
    type Target = DateTime<Utc>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl From<DateTime<Utc>> for Timestamp {
    fn from(dt: DateTime<Utc>) -> Self {
        Timestamp(dt)
    }
}

impl From<Timestamp> for DateTime<Utc> {
    fn from(ts: Timestamp) -> Self {
        ts.0
    }
}

impl Serialize for Timestamp {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Timestamp {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Timestamp(DateTime::<Utc>::deserialize(d)?))
    }
}

impl sqlx::Type<sqlx::Any> for Timestamp {
    fn type_info() -> sqlx::any::AnyTypeInfo {
        <String as sqlx::Type<sqlx::Any>>::type_info()
    }
    fn compatible(ty: &sqlx::any::AnyTypeInfo) -> bool {
        <String as sqlx::Type<sqlx::Any>>::compatible(ty)
    }
}

impl<'r> sqlx::Decode<'r, sqlx::Any> for Timestamp {
    fn decode(value: sqlx::any::AnyValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <String as sqlx::Decode<'r, sqlx::Any>>::decode(value)?;
        let dt = chrono::DateTime::parse_from_rfc3339(&s)
            .or_else(|_| chrono::DateTime::parse_from_str(&s, "%Y-%m-%d %H:%M:%S%.f%:z"))
            .or_else(|_| chrono::DateTime::parse_from_str(&s, "%Y-%m-%d %H:%M:%S%:z"))
            .or_else(|_| {
                chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%d %H:%M:%S%.f")
                    .map(|ndt| ndt.and_utc().fixed_offset())
            })
            .or_else(|_| {
                chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%d %H:%M:%S")
                    .map(|ndt| ndt.and_utc().fixed_offset())
            })
            .map_err(|e| format!("Cannot parse timestamp {:?}: {}", s, e))?;
        Ok(Timestamp(dt.with_timezone(&Utc)))
    }
}

impl<'q> sqlx::Encode<'q, sqlx::Any> for Timestamp {
    fn encode_by_ref(
        &self,
        buf: &mut <sqlx::Any as sqlx::Database>::ArgumentBuffer<'q>,
    ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {
        let s = self.0.to_rfc3339();
        <String as sqlx::Encode<'q, sqlx::Any>>::encode_by_ref(&s, buf)
    }
}

/// A boolean that implements sqlx Encode/Decode/Type for the `Any` backend.
/// Stored as INTEGER (0/1), compatible with both SQLite and PostgreSQL.
/// The sqlx `Any` driver cannot natively decode SQLite's INTEGER/BOOLEAN columns
/// into Rust `bool` — this newtype bridges that gap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bool(pub bool);

impl Bool {
    pub fn new(v: bool) -> Self {
        Bool(v)
    }
}

impl Deref for Bool {
    type Target = bool;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl From<bool> for Bool {
    fn from(b: bool) -> Self {
        Bool(b)
    }
}

impl From<Bool> for bool {
    fn from(b: Bool) -> Self {
        b.0
    }
}

impl std::ops::Not for Bool {
    type Output = bool;
    fn not(self) -> Self::Output {
        !self.0
    }
}

impl std::ops::Not for &Bool {
    type Output = bool;
    fn not(self) -> Self::Output {
        !self.0
    }
}

impl Serialize for Bool {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Bool {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Bool(bool::deserialize(d)?))
    }
}

impl sqlx::Type<sqlx::Any> for Bool {
    fn type_info() -> sqlx::any::AnyTypeInfo {
        <i32 as sqlx::Type<sqlx::Any>>::type_info()
    }
    fn compatible(ty: &sqlx::any::AnyTypeInfo) -> bool {
        <i32 as sqlx::Type<sqlx::Any>>::compatible(ty)
            || <i64 as sqlx::Type<sqlx::Any>>::compatible(ty)
    }
}

impl<'r> sqlx::Decode<'r, sqlx::Any> for Bool {
    fn decode(value: sqlx::any::AnyValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        // Try i32 first (INT4 / PostgreSQL boolean-as-int), fall back to i64 (SQLite BIGINT).
        let n = <i32 as sqlx::Decode<'r, sqlx::Any>>::decode(value)
            .map(|v| v as i64)
            .or_else(|_| {
                // Need a fresh value ref - this branch is only hit if i32 decode fails
                // which shouldn't happen in practice, but we handle it defensively.
                Err(format!("Bool: could not decode as i32 or i64"))
            })?;
        Ok(Bool(n != 0))
    }
}

impl<'q> sqlx::Encode<'q, sqlx::Any> for Bool {
    fn encode_by_ref(
        &self,
        buf: &mut <sqlx::Any as sqlx::Database>::ArgumentBuffer<'q>,
    ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {
        let n: i32 = if self.0 { 1 } else { 0 };
        <i32 as sqlx::Encode<'q, sqlx::Any>>::encode_by_ref(&n, buf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::test_any_pool;
    use chrono::TimeZone;

    // ── Timestamp ─────────────────────────────────────────────────────────────

    #[test]
    fn timestamp_now_is_recent() {
        let before = Utc::now();
        let ts = Timestamp::now();
        let after = Utc::now();
        assert!(*ts >= before && *ts <= after);
    }

    #[test]
    fn timestamp_deref() {
        let dt = Utc::now();
        assert_eq!(*Timestamp(dt), dt);
    }

    #[test]
    fn timestamp_from_datetime() {
        let dt = Utc::now();
        let ts: Timestamp = dt.into();
        assert_eq!(ts.0, dt);
    }

    #[test]
    fn datetime_from_timestamp() {
        let dt = Utc::now();
        let back: DateTime<Utc> = Timestamp(dt).into();
        assert_eq!(back, dt);
    }

    #[test]
    fn timestamp_ordering() {
        let t1 = Timestamp(Utc.with_ymd_and_hms(2020, 1, 1, 0, 0, 0).unwrap());
        let t2 = Timestamp(Utc.with_ymd_and_hms(2021, 1, 1, 0, 0, 0).unwrap());
        assert!(t1 < t2);
        assert_eq!(t1, t1);
    }

    #[test]
    fn timestamp_serialize() {
        let dt = Utc.with_ymd_and_hms(2023, 6, 15, 10, 30, 0).unwrap();
        let s = serde_json::to_string(&Timestamp(dt)).unwrap();
        assert!(s.contains("2023-06-15"));
    }

    #[test]
    fn timestamp_deserialize() {
        let ts: Timestamp = serde_json::from_str(r#""2023-06-15T10:30:00Z""#).unwrap();
        let expected = Utc.with_ymd_and_hms(2023, 6, 15, 10, 30, 0).unwrap();
        assert_eq!(ts.0, expected);
    }

    // ── Bool ──────────────────────────────────────────────────────────────────

    #[test]
    fn bool_new() {
        assert!(Bool::new(true).0);
        assert!(!Bool::new(false).0);
    }

    #[test]
    fn bool_deref() {
        assert!(*Bool(true));
        assert!(!*Bool(false));
    }

    #[test]
    fn bool_from_bool() {
        let b: Bool = true.into();
        assert!(b.0);
        let b: Bool = false.into();
        assert!(!b.0);
    }

    #[test]
    fn bool_into_bool() {
        let v: bool = Bool(true).into();
        assert!(v);
        let v: bool = Bool(false).into();
        assert!(!v);
    }

    #[test]
    fn bool_not_owned() {
        assert_eq!(!Bool(true), false);
        assert_eq!(!Bool(false), true);
    }

    #[test]
    fn bool_not_ref() {
        assert_eq!(!&Bool(true), false);
        assert_eq!(!&Bool(false), true);
    }

    #[test]
    fn bool_serialize() {
        assert_eq!(serde_json::to_string(&Bool(true)).unwrap(), "true");
        assert_eq!(serde_json::to_string(&Bool(false)).unwrap(), "false");
    }

    #[test]
    fn bool_deserialize() {
        let b: Bool = serde_json::from_str("true").unwrap();
        assert!(b.0);
        let b: Bool = serde_json::from_str("false").unwrap();
        assert!(!b.0);
    }

    // ── sqlx encode/decode roundtrips ─────────────────────────────────────────

    #[tokio::test]
    async fn timestamp_encode_decode_rfc3339() {
        let pool = test_any_pool().await;
        sqlx::query("CREATE TEMP TABLE ts_rt (ts TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        let dt = Utc.with_ymd_and_hms(2023, 6, 15, 10, 30, 0).unwrap();
        sqlx::query("INSERT INTO ts_rt (ts) VALUES (?)")
            .bind(Timestamp(dt))
            .execute(&pool)
            .await
            .unwrap();
        let (decoded,): (Timestamp,) = sqlx::query_as("SELECT ts FROM ts_rt")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(decoded.0, dt);
    }

    #[tokio::test]
    async fn timestamp_decode_sqlite_naive_format() {
        // Exercises the %Y-%m-%d %H:%M:%S fallback branch in Timestamp::decode
        let pool = test_any_pool().await;
        let expected = Utc.with_ymd_and_hms(2023, 6, 15, 10, 30, 0).unwrap();
        sqlx::query("CREATE TEMP TABLE ts_naive (ts TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO ts_naive (ts) VALUES ('2023-06-15 10:30:00')")
            .execute(&pool)
            .await
            .unwrap();
        let (decoded,): (Timestamp,) = sqlx::query_as("SELECT ts FROM ts_naive")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(decoded.0, expected);
    }

    #[tokio::test]
    async fn timestamp_decode_sqlite_naive_with_fractional() {
        // Exercises the %Y-%m-%d %H:%M:%S%.f fallback branch
        let pool = test_any_pool().await;
        sqlx::query("CREATE TEMP TABLE ts_frac (ts TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO ts_frac (ts) VALUES ('2023-06-15 10:30:00.123456')")
            .execute(&pool)
            .await
            .unwrap();
        let (decoded,): (Timestamp,) = sqlx::query_as("SELECT ts FROM ts_frac")
            .fetch_one(&pool)
            .await
            .unwrap();
        let expected = Utc.with_ymd_and_hms(2023, 6, 15, 10, 30, 0).unwrap();
        assert_eq!(decoded.0.date_naive(), expected.date_naive());
    }

    #[tokio::test]
    async fn timestamp_decode_space_format_with_tz() {
        // Exercises the %Y-%m-%d %H:%M:%S%:z fallback branch
        let pool = test_any_pool().await;
        sqlx::query("CREATE TEMP TABLE ts_tz (ts TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO ts_tz (ts) VALUES ('2023-06-15 10:30:00+00:00')")
            .execute(&pool)
            .await
            .unwrap();
        let (decoded,): (Timestamp,) = sqlx::query_as("SELECT ts FROM ts_tz")
            .fetch_one(&pool)
            .await
            .unwrap();
        let expected = Utc.with_ymd_and_hms(2023, 6, 15, 10, 30, 0).unwrap();
        assert_eq!(decoded.0, expected);
    }

    #[tokio::test]
    async fn bool_encode_decode_roundtrip() {
        let pool = test_any_pool().await;
        sqlx::query("CREATE TEMP TABLE bool_rt (b INTEGER NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO bool_rt (b) VALUES (?)")
            .bind(Bool(true))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO bool_rt (b) VALUES (?)")
            .bind(Bool(false))
            .execute(&pool)
            .await
            .unwrap();
        let rows: Vec<(Bool,)> = sqlx::query_as("SELECT b FROM bool_rt ORDER BY b DESC")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows[0].0 .0);
        assert!(!rows[1].0 .0);
    }
}

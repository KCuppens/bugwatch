-- Source maps uploaded per project/release/dist/bundle for JS and React Native
-- symbolication. `data` is the source map JSON, zlib-compressed; `size` is the
-- uncompressed size in bytes.
CREATE TABLE IF NOT EXISTS source_maps (
    id          TEXT        PRIMARY KEY NOT NULL,
    project_id  TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    release     TEXT        NOT NULL,
    dist        TEXT        NOT NULL DEFAULT '',
    bundle      TEXT        NOT NULL,
    data        BYTEA       NOT NULL,
    size        BIGINT      NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT source_maps_project_release_dist_bundle_key
        UNIQUE (project_id, release, dist, bundle)
);

CREATE INDEX IF NOT EXISTS idx_source_maps_project_release
    ON source_maps (project_id, release);

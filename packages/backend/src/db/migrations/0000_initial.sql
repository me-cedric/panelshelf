-- PanelShelf initial schema

CREATE TABLE IF NOT EXISTS "sources" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "type" text NOT NULL CHECK(type IN ('rss','json-api','static-index','local-folder','manual-url')),
  "base_url" text NOT NULL,
  "enabled" integer NOT NULL DEFAULT 1,
  "refresh_interval_min" integer NOT NULL DEFAULT 60,
  "headers" text,
  "rate_limit_ms" integer,
  "last_fetched_at" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "catalog_items" (
  "id" text PRIMARY KEY NOT NULL,
  "source_id" text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  "title" text NOT NULL,
  "series" text,
  "issue_number" text,
  "volume" text,
  "publisher" text,
  "release_date" text,
  "added_at" text NOT NULL DEFAULT (datetime('now')),
  "language" text DEFAULT 'en',
  "format" text,
  "file_size" text,
  "file_size_bytes" integer,
  "tags" text,
  "description" text,
  "cover_url" text,
  "detail_url" text,
  "stable_hash" text NOT NULL,
  "download_available" integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS "stable_hash_idx" ON "catalog_items"("stable_hash");
CREATE INDEX IF NOT EXISTS "catalog_source_idx" ON "catalog_items"("source_id");
CREATE INDEX IF NOT EXISTS "catalog_publisher_idx" ON "catalog_items"("publisher");
CREATE INDEX IF NOT EXISTS "catalog_series_idx" ON "catalog_items"("series");
CREATE INDEX IF NOT EXISTS "catalog_release_date_idx" ON "catalog_items"("release_date");
CREATE INDEX IF NOT EXISTS "catalog_title_idx" ON "catalog_items"("title");
CREATE INDEX IF NOT EXISTS "catalog_added_at_idx" ON "catalog_items"("added_at");

CREATE TABLE IF NOT EXISTS "download_links" (
  "id" text PRIMARY KEY NOT NULL,
  "catalog_item_id" text NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  "provider" text NOT NULL,
  "file_name" text,
  "size" text,
  "url" text NOT NULL,
  "link_type" text NOT NULL DEFAULT 'unknown' CHECK(link_type IN ('direct','redirect','manual','unknown')),
  "direct_download_capable" integer DEFAULT 0,
  "manual_action_required" integer DEFAULT 1
);

CREATE TABLE IF NOT EXISTS "saved_searches" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "query" text,
  "filters" text,
  "sort_by" text,
  "sort_order" text DEFAULT 'desc' CHECK(sort_order IN ('asc','desc')),
  "created_at" text NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "downloads" (
  "id" text PRIMARY KEY NOT NULL,
  "catalog_item_id" text REFERENCES catalog_items(id) ON DELETE SET NULL,
  "download_link_id" text REFERENCES download_links(id) ON DELETE SET NULL,
  "url" text NOT NULL,
  "file_name" text,
  "destination_path" text,
  "status" text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','paused','completed','failed')),
  "progress" real NOT NULL DEFAULT 0,
  "speed" real,
  "eta" real,
  "total_bytes" integer,
  "downloaded_bytes" integer DEFAULT 0,
  "error_log" text,
  "retry_count" integer NOT NULL DEFAULT 0,
  "max_retries" integer NOT NULL DEFAULT 3,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "completed_at" text
);

CREATE TABLE IF NOT EXISTS "settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL
);

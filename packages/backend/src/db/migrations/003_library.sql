CREATE TABLE IF NOT EXISTS library_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  scan_recursive INTEGER NOT NULL DEFAULT 1,
  last_scanned_at TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS library_items (
  id TEXT PRIMARY KEY,
  library_source_id TEXT NOT NULL REFERENCES library_sources(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL,
  file_size_bytes INTEGER,
  page_count INTEGER,
  cover_cached INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS lib_items_source_idx ON library_items(library_source_id);
CREATE UNIQUE INDEX IF NOT EXISTS lib_file_path_idx ON library_items(file_path);

CREATE TABLE IF NOT EXISTS reading_progress (
  id TEXT PRIMARY KEY,
  library_item_id TEXT NOT NULL UNIQUE REFERENCES library_items(id) ON DELETE CASCADE,
  current_page INTEGER NOT NULL DEFAULT 1,
  total_pages INTEGER,
  completed INTEGER NOT NULL DEFAULT 0,
  last_read_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS reading_progress_item_idx ON reading_progress(library_item_id);

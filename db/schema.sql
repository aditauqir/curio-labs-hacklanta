CREATE TABLE IF NOT EXISTS curio_instances (
  id UUID PRIMARY KEY,
  username TEXT,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS curio_workspaces (
  instance_id UUID PRIMARY KEY REFERENCES curio_instances(id) ON DELETE CASCADE,
  design JSONB NOT NULL,
  selected_palette_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS curio_chat_messages (
  instance_id UUID NOT NULL REFERENCES curio_instances(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  source TEXT CHECK (source IS NULL OR source IN ('example', 'demo', 'gemini')),
  suggestions JSONB,
  changes JSONB,
  skipped JSONB,
  notice TEXT,
  asset_suggestions JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (instance_id, message_id)
);

CREATE INDEX IF NOT EXISTS curio_chat_messages_instance_created_idx
  ON curio_chat_messages (instance_id, created_at);

CREATE TABLE IF NOT EXISTS curio_files (
  id UUID PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES curio_instances(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS curio_files_instance_created_idx
  ON curio_files (instance_id, created_at);

CREATE TABLE IF NOT EXISTS curio_library_assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('font', 'palette', 'reference', 'image', 'video', 'audio', 'document', 'other')),
  name TEXT NOT NULL,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url TEXT,
  content_type TEXT,
  size_bytes INTEGER,
  data BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS curio_library_assets_kind_idx
  ON curio_library_assets (kind);

ALTER TABLE curio_chat_messages
  ADD COLUMN IF NOT EXISTS asset_suggestions JSONB;

CREATE TABLE IF NOT EXISTS curio_instances (
  id UUID PRIMARY KEY,
  username TEXT,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS curio_instances_username_unique_idx
  ON curio_instances (LOWER(username))
  WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS curio_sessions (
  token_hash TEXT PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES curio_instances(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS curio_sessions_instance_idx
  ON curio_sessions (instance_id);

CREATE INDEX IF NOT EXISTS curio_sessions_expiry_idx
  ON curio_sessions (expires_at);

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

ALTER TABLE curio_library_assets
  ADD COLUMN IF NOT EXISTS owner_instance_id UUID REFERENCES curio_instances(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS curio_library_assets_owner_idx
  ON curio_library_assets (owner_instance_id);

CREATE INDEX IF NOT EXISTS curio_library_assets_kind_idx
  ON curio_library_assets (kind);

ALTER TABLE curio_chat_messages
  ADD COLUMN IF NOT EXISTS asset_suggestions JSONB;

CREATE TABLE IF NOT EXISTS curio_knowledge_sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  source_hash TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL DEFAULT 'pdf',
  page_count INTEGER NOT NULL CHECK (page_count >= 0),
  extraction_method TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS curio_knowledge_clips (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES curio_knowledge_sources(id) ON DELETE CASCADE,
  clip_key TEXT NOT NULL,
  clip_type TEXT NOT NULL CHECK (clip_type IN ('principle', 'page_extract', 'visual_note', 'method', 'index')),
  title TEXT NOT NULL,
  section TEXT,
  page_start INTEGER CHECK (page_start IS NULL OR page_start >= 1),
  page_end INTEGER CHECK (page_end IS NULL OR page_end >= 1),
  text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, clip_key)
);

CREATE INDEX IF NOT EXISTS curio_knowledge_clips_source_idx
  ON curio_knowledge_clips (source_id, page_start);

CREATE INDEX IF NOT EXISTS curio_knowledge_clips_tags_idx
  ON curio_knowledge_clips USING GIN (tags);

CREATE INDEX IF NOT EXISTS curio_knowledge_clips_search_idx
  ON curio_knowledge_clips USING GIN (to_tsvector('simple', normalized_text));

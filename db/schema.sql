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
  poster_edits JSONB NOT NULL DEFAULT '{}'::jsonb,
  layer_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE curio_workspaces
  ADD COLUMN IF NOT EXISTS poster_edits JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE curio_workspaces
  ADD COLUMN IF NOT EXISTS layer_order JSONB NOT NULL DEFAULT '[]'::jsonb;

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

-- Creative pipeline -----------------------------------------------------------
-- Projects owned by an instance. Every pipeline table hangs off this row, so a
-- single instance_id predicate on curio_projects is enough to scope access.

CREATE TABLE IF NOT EXISTS curio_projects (
  id UUID PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES curio_instances(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'print-poster',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'concepts', 'designing', 'complete')),
  selected_concept_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS curio_projects_instance_created_idx
  ON curio_projects (instance_id, created_at DESC);

CREATE TABLE IF NOT EXISTS curio_project_briefs (
  project_id UUID PRIMARY KEY REFERENCES curio_projects(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  structured JSONB NOT NULL,
  model TEXT,
  provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS curio_project_concepts (
  project_id UUID NOT NULL REFERENCES curio_projects(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  data JSONB NOT NULL,
  model TEXT,
  provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, concept_id)
);

CREATE INDEX IF NOT EXISTS curio_project_concepts_order_idx
  ON curio_project_concepts (project_id, position);

CREATE TABLE IF NOT EXISTS curio_project_assets (
  id TEXT NOT NULL,
  project_id UUID NOT NULL REFERENCES curio_projects(id) ON DELETE CASCADE,
  concept_id TEXT,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'ready', 'unavailable')),
  -- Bytes live in curio_files; this table holds the plan and the provenance.
  file_id UUID REFERENCES curio_files(id) ON DELETE SET NULL,
  plan JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, id)
);

CREATE TABLE IF NOT EXISTS curio_design_versions (
  project_id UUID NOT NULL REFERENCES curio_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  parent_version INTEGER,
  document JSONB NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, version)
);

CREATE INDEX IF NOT EXISTS curio_design_versions_recent_idx
  ON curio_design_versions (project_id, version DESC);

CREATE TABLE IF NOT EXISTS curio_evaluations (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES curio_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'warn', 'fail')),
  deterministic JSONB NOT NULL,
  creative JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS curio_evaluations_project_idx
  ON curio_evaluations (project_id, version DESC);

CREATE TABLE IF NOT EXISTS curio_exports (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES curio_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('svg', 'json')),
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS curio_exports_project_idx
  ON curio_exports (project_id, created_at DESC);

-- One row per pipeline run. request_hash makes an identical in-flight or
-- recently completed request return the first result instead of paying for a
-- second model call.
CREATE TABLE IF NOT EXISTS curio_jobs (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES curio_projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
  request_hash TEXT NOT NULL,
  progress TEXT,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS curio_jobs_dedupe_idx
  ON curio_jobs (project_id, kind, request_hash);

CREATE INDEX IF NOT EXISTS curio_jobs_project_idx
  ON curio_jobs (project_id, created_at DESC);

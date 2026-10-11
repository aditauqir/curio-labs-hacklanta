// Server-only persistence for the creative pipeline.
//
// Follows the conventions already in lib/instance-store.ts: postgres.js tagged
// templates, explicit ::uuid casts, camelCase aliases in SQL, ensureInstance
// before any insert, and ownership enforced by an instance_id predicate rather
// than by a middleware the caller might forget.
import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { getDatabase } from "../db";
import { ensureInstance } from "../instance";
import type { Concept } from "./concepts.ts";
import type { StructuredBrief } from "./brief.ts";
import type { PlannedAsset } from "./assets.ts";
import type { DesignDocument } from "./document.ts";

export type ProjectStatus = "draft" | "concepts" | "designing" | "complete";

export type ProjectRow = {
  id: string;
  name: string;
  format: string;
  status: ProjectStatus;
  selectedConceptId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VersionRow = {
  version: number;
  parentVersion: number | null;
  document: DesignDocument;
  summary: string;
  changes: unknown;
  createdAt: string;
};

export type JobRow = {
  id: string;
  kind: string;
  state: "queued" | "running" | "succeeded" | "failed";
  progress: string | null;
  result: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

function iso(value: Date | string) {
  return new Date(value).toISOString();
}

/**
 * postgres.js types sql.json() against its own JSONValue union. Report and
 * change payloads are plain serialisable objects, but TypeScript cannot prove
 * that structurally, so the cast lives here instead of at each call site.
 */
function json(handle: Sql, value: unknown) {
  return handle.json(value as Parameters<Sql["json"]>[0]);
}

// ----------------------------------------------------------------- projects

export async function createProject(
  instanceId: string,
  input: { name: string; format: string },
): Promise<ProjectRow> {
  const sql = await getDatabase();
  await ensureInstance(sql, instanceId);
  const id = randomUUID();
  const rows = await sql<ProjectRow[]>`
    INSERT INTO curio_projects (id, instance_id, name, format)
    VALUES (${id}::uuid, ${instanceId}::uuid, ${input.name}, ${input.format})
    RETURNING id, name, format, status,
              selected_concept_id AS "selectedConceptId",
              created_at AS "createdAt", updated_at AS "updatedAt"
  `;
  return rows[0];
}

export async function listProjects(instanceId: string): Promise<ProjectRow[]> {
  const sql = await getDatabase();
  await ensureInstance(sql, instanceId);
  return sql<ProjectRow[]>`
    SELECT id, name, format, status,
           selected_concept_id AS "selectedConceptId",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM curio_projects
    WHERE instance_id = ${instanceId}::uuid
    ORDER BY created_at DESC
    LIMIT 100
  `;
}

/** Returns null when the project does not exist OR is owned by someone else. */
export async function getProject(instanceId: string, projectId: string): Promise<ProjectRow | null> {
  const sql = await getDatabase();
  const rows = await sql<ProjectRow[]>`
    SELECT id, name, format, status,
           selected_concept_id AS "selectedConceptId",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM curio_projects
    WHERE id = ${projectId}::uuid AND instance_id = ${instanceId}::uuid
  `;
  return rows[0] ?? null;
}

export async function updateProject(
  projectId: string,
  values: { status?: ProjectStatus; selectedConceptId?: string | null; name?: string },
) {
  const sql = await getDatabase();
  await sql`
    UPDATE curio_projects SET
      status = COALESCE(${values.status ?? null}, status),
      selected_concept_id = CASE WHEN ${values.selectedConceptId !== undefined}
        THEN ${values.selectedConceptId ?? null} ELSE selected_concept_id END,
      name = COALESCE(${values.name ?? null}, name),
      updated_at = NOW()
    WHERE id = ${projectId}::uuid
  `;
}

// -------------------------------------------------------------------- brief

export async function saveBrief(
  projectId: string,
  input: { rawText: string; brief: StructuredBrief; model: string; provider: string },
) {
  const sql = await getDatabase();
  await sql`
    INSERT INTO curio_project_briefs (project_id, raw_text, structured, model, provider, updated_at)
    VALUES (${projectId}::uuid, ${input.rawText}, ${sql.json(input.brief)}, ${input.model}, ${input.provider}, NOW())
    ON CONFLICT (project_id) DO UPDATE SET
      raw_text = EXCLUDED.raw_text,
      structured = EXCLUDED.structured,
      model = EXCLUDED.model,
      provider = EXCLUDED.provider,
      updated_at = NOW()
  `;
}

export async function getBrief(projectId: string): Promise<StructuredBrief | null> {
  const sql = await getDatabase();
  const rows = await sql<{ structured: StructuredBrief }[]>`
    SELECT structured FROM curio_project_briefs WHERE project_id = ${projectId}::uuid
  `;
  return rows[0]?.structured ?? null;
}

// ----------------------------------------------------------------- concepts

export async function saveConcepts(
  projectId: string,
  input: { concepts: Concept[]; model: string; provider: string },
) {
  const sql = await getDatabase();
  await sql.begin(async (tx) => {
    await tx`DELETE FROM curio_project_concepts WHERE project_id = ${projectId}::uuid`;
    for (const [index, concept] of input.concepts.entries()) {
      await tx`
        INSERT INTO curio_project_concepts (project_id, concept_id, position, data, model, provider)
        VALUES (${projectId}::uuid, ${concept.id}, ${index}, ${tx.json(concept)}, ${input.model}, ${input.provider})
      `;
    }
  });
}

export async function listConcepts(projectId: string): Promise<Concept[]> {
  const sql = await getDatabase();
  const rows = await sql<{ data: Concept }[]>`
    SELECT data FROM curio_project_concepts
    WHERE project_id = ${projectId}::uuid
    ORDER BY position
  `;
  return rows.map((row) => row.data);
}

// ------------------------------------------------------------------- assets

export async function saveAssets(projectId: string, conceptId: string, assets: PlannedAsset[]) {
  const sql = await getDatabase();
  await sql.begin(async (tx) => {
    await tx`DELETE FROM curio_project_assets WHERE project_id = ${projectId}::uuid`;
    for (const asset of assets) {
      await tx`
        INSERT INTO curio_project_assets (id, project_id, concept_id, type, source, status, plan)
        VALUES (${asset.id}, ${projectId}::uuid, ${conceptId}, ${asset.type}, ${asset.source}, ${asset.status}, ${tx.json(asset)})
      `;
    }
  });
}

export async function listAssets(projectId: string): Promise<PlannedAsset[]> {
  const sql = await getDatabase();
  const rows = await sql<{ plan: PlannedAsset }[]>`
    SELECT plan FROM curio_project_assets
    WHERE project_id = ${projectId}::uuid
    ORDER BY id
  `;
  return rows.map((row) => row.plan);
}

// ----------------------------------------------------------------- versions

export async function createVersion(
  projectId: string,
  input: { document: DesignDocument; summary: string; changes: unknown; parentVersion: number | null },
): Promise<number> {
  const sql = await getDatabase();
  return sql.begin(async (tx) => {
    const next = await tx<{ version: number }[]>`
      SELECT COALESCE(MAX(version), 0) + 1 AS version
      FROM curio_design_versions
      WHERE project_id = ${projectId}::uuid
    `;
    const version = next[0].version;
    await tx`
      INSERT INTO curio_design_versions (project_id, version, parent_version, document, summary, changes)
      VALUES (
        ${projectId}::uuid, ${version}, ${input.parentVersion},
        ${tx.json(input.document)}, ${input.summary}, ${json(tx, input.changes)}
      )
    `;
    await tx`UPDATE curio_projects SET updated_at = NOW() WHERE id = ${projectId}::uuid`;
    return version;
  });
}

export async function getVersion(projectId: string, version: number): Promise<VersionRow | null> {
  const sql = await getDatabase();
  const rows = await sql<VersionRow[]>`
    SELECT version, parent_version AS "parentVersion", document, summary, changes,
           created_at AS "createdAt"
    FROM curio_design_versions
    WHERE project_id = ${projectId}::uuid AND version = ${version}
  `;
  return rows[0] ?? null;
}

export async function getLatestVersion(projectId: string): Promise<VersionRow | null> {
  const sql = await getDatabase();
  const rows = await sql<VersionRow[]>`
    SELECT version, parent_version AS "parentVersion", document, summary, changes,
           created_at AS "createdAt"
    FROM curio_design_versions
    WHERE project_id = ${projectId}::uuid
    ORDER BY version DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function listVersions(projectId: string) {
  const sql = await getDatabase();
  const rows = await sql<{ version: number; parentVersion: number | null; summary: string; changes: unknown; createdAt: Date }[]>`
    SELECT version, parent_version AS "parentVersion", summary, changes, created_at AS "createdAt"
    FROM curio_design_versions
    WHERE project_id = ${projectId}::uuid
    ORDER BY version DESC
    LIMIT 100
  `;
  return rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
}

// -------------------------------------------------------------- evaluations

export async function saveEvaluation(
  projectId: string,
  input: { version: number; status: "pass" | "warn" | "fail"; deterministic: unknown; creative: unknown },
) {
  const sql = await getDatabase();
  const id = randomUUID();
  await sql`
    INSERT INTO curio_evaluations (id, project_id, version, status, deterministic, creative)
    VALUES (${id}::uuid, ${projectId}::uuid, ${input.version}, ${input.status},
            ${json(sql, input.deterministic)}, ${json(sql, input.creative)})
  `;
  return id;
}

export async function getEvaluation(projectId: string, version: number) {
  const sql = await getDatabase();
  const rows = await sql<{ status: string; deterministic: unknown; creative: unknown; createdAt: Date }[]>`
    SELECT status, deterministic, creative, created_at AS "createdAt"
    FROM curio_evaluations
    WHERE project_id = ${projectId}::uuid AND version = ${version}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { ...row, createdAt: iso(row.createdAt) } : null;
}

// ------------------------------------------------------------------ exports

export async function createExport(
  projectId: string,
  input: { version: number; format: "svg" | "json"; contentType: string; data: Buffer },
) {
  const sql = await getDatabase();
  const id = randomUUID();
  const rows = await sql<{ id: string; createdAt: Date }[]>`
    INSERT INTO curio_exports (id, project_id, version, format, content_type, size_bytes, data)
    VALUES (${id}::uuid, ${projectId}::uuid, ${input.version}, ${input.format},
            ${input.contentType}, ${input.data.length}, ${input.data})
    RETURNING id, created_at AS "createdAt"
  `;
  return { id: rows[0].id, createdAt: iso(rows[0].createdAt), sizeBytes: input.data.length };
}

export async function listExports(projectId: string) {
  const sql = await getDatabase();
  const rows = await sql<{ id: string; version: number; format: string; contentType: string; sizeBytes: number; createdAt: Date }[]>`
    SELECT id, version, format, content_type AS "contentType", size_bytes AS "sizeBytes", created_at AS "createdAt"
    FROM curio_exports
    WHERE project_id = ${projectId}::uuid
    ORDER BY created_at DESC
    LIMIT 50
  `;
  return rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
}

export async function getExport(projectId: string, exportId: string) {
  const sql = await getDatabase();
  const rows = await sql<{ id: string; format: string; contentType: string; sizeBytes: number; data: Buffer }[]>`
    SELECT id, format, content_type AS "contentType", size_bytes AS "sizeBytes", data
    FROM curio_exports
    WHERE project_id = ${projectId}::uuid AND id = ${exportId}::uuid
  `;
  return rows[0] ?? null;
}

// --------------------------------------------------------------------- jobs

export function hashRequest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

/**
 * Claims a job slot. Returns the existing row when the same request is already
 * running or has already succeeded, which is what stops a double-clicked
 * "generate concepts" button paying for two model calls.
 */
export async function claimJob(
  projectId: string,
  input: { kind: string; requestHash: string },
): Promise<{ job: JobRow; fresh: boolean }> {
  const sql = await getDatabase();
  const id = randomUUID();

  const rows = await sql<JobRow[]>`
    INSERT INTO curio_jobs (id, project_id, kind, state, request_hash, progress)
    VALUES (${id}::uuid, ${projectId}::uuid, ${input.kind}, 'running', ${input.requestHash}, 'started')
    ON CONFLICT (project_id, kind, request_hash) DO UPDATE SET
      -- Retry a previously failed job; leave a running or succeeded one alone.
      state = CASE WHEN curio_jobs.state = 'failed' THEN 'running' ELSE curio_jobs.state END,
      updated_at = CASE WHEN curio_jobs.state = 'failed' THEN NOW() ELSE curio_jobs.updated_at END
    RETURNING id, kind, state, progress, result, error,
              created_at AS "createdAt", updated_at AS "updatedAt"
  `;

  const job = rows[0];
  return { job, fresh: job.id === id || job.state === "running" };
}

export async function finishJob(jobId: string, result: unknown) {
  const sql = await getDatabase();
  await sql`
    UPDATE curio_jobs
    SET state = 'succeeded', result = ${json(sql, result)}, progress = 'done', error = NULL, updated_at = NOW()
    WHERE id = ${jobId}::uuid
  `;
}

export async function failJob(jobId: string, message: string) {
  const sql = await getDatabase();
  await sql`
    UPDATE curio_jobs
    SET state = 'failed', error = ${message.slice(0, 500)}, progress = NULL, updated_at = NOW()
    WHERE id = ${jobId}::uuid
  `;
}

export async function getJob(projectId: string, jobId: string): Promise<JobRow | null> {
  const sql = await getDatabase();
  const rows = await sql<JobRow[]>`
    SELECT id, kind, state, progress, result, error,
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM curio_jobs
    WHERE project_id = ${projectId}::uuid AND id = ${jobId}::uuid
  `;
  return rows[0] ?? null;
}

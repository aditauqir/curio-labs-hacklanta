// Server-only access to the shared Curio asset library. Instance files live in
// curio_files; this table is the reusable library that Gemini can reference.
import { randomUUID } from "node:crypto";
import { getDatabase } from "./db";
import type { AssetSuggestion } from "./design-types";

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };
export type JsonObject = { [key: string]: JsonValue | undefined };

export const LIBRARY_KINDS = [
  "font",
  "palette",
  "reference",
  "image",
  "video",
  "audio",
  "document",
  "other",
] as const;

export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export type LibraryAsset = AssetSuggestion & {
  tags: string[];
  metadata: JsonObject;
  sourceUrl: string | null;
  contentType: string | null;
  sizeBytes: number | null;
};

type LibraryRow = {
  id: string;
  kind: LibraryKind;
  name: string;
  description: string | null;
  tags: string[];
  metadata: JsonObject;
  sourceUrl: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  owner_instance_id: string | null;
  createdAt: Date | string;
};

type LibraryFileRow = LibraryRow & { data: Buffer | null };

function summary(asset: LibraryRow): AssetSuggestion {
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    description: asset.description,
  };
}

export async function listLibraryAssets(kind?: LibraryKind, limit = 60, ownerInstanceId?: string): Promise<LibraryAsset[]> {
  const sql = await getDatabase();
  const ownerFilter = ownerInstanceId
    ? sql`AND (owner_instance_id IS NULL OR owner_instance_id = ${ownerInstanceId}::uuid)`
    : sql`AND owner_instance_id IS NULL`;
  const rows = kind
    ? await sql<LibraryRow[]>`
        SELECT id, kind, name, description, tags, metadata,
               source_url AS "sourceUrl", content_type AS "contentType", owner_instance_id,
               size_bytes AS "sizeBytes", created_at AS "createdAt"
        FROM curio_library_assets
        WHERE kind = ${kind} ${ownerFilter}
        ORDER BY name ASC
        LIMIT ${limit}
      `
    : await sql<LibraryRow[]>`
        SELECT id, kind, name, description, tags, metadata,
               source_url AS "sourceUrl", content_type AS "contentType", owner_instance_id,
               size_bytes AS "sizeBytes", created_at AS "createdAt"
        FROM curio_library_assets
        WHERE TRUE ${ownerFilter}
        ORDER BY kind ASC, name ASC
        LIMIT ${limit}
      `;
  return rows.map((asset) => ({ ...summary(asset), tags: asset.tags, metadata: asset.metadata, sourceUrl: asset.sourceUrl, contentType: asset.contentType, sizeBytes: asset.sizeBytes }));
}

/** Search the TigerData-backed library for the small set of references a coach needs. */
export async function searchLibraryAssets(
  query: string,
  options: { kind?: LibraryKind; limit?: number; ownerInstanceId?: string } = {},
): Promise<LibraryAsset[]> {
  const sql = await getDatabase();
  const ownerFilter = options.ownerInstanceId
    ? sql`AND (owner_instance_id IS NULL OR owner_instance_id = ${options.ownerInstanceId}::uuid)`
    : sql`AND owner_instance_id IS NULL`;
  const kindFilter = options.kind ? sql`AND kind = ${options.kind}` : sql``;
  const needle = `%${query.trim().slice(0, 80)}%`;
  const limit = Math.max(1, Math.min(options.limit ?? 6, 12));
  const rows = await sql<LibraryRow[]>`
    SELECT id, kind, name, description, tags, metadata,
           source_url AS "sourceUrl", content_type AS "contentType", owner_instance_id,
           size_bytes AS "sizeBytes", created_at AS "createdAt"
    FROM curio_library_assets
    WHERE (
      name ILIKE ${needle}
      OR COALESCE(description, '') ILIKE ${needle}
      OR array_to_string(tags, ' ') ILIKE ${needle}
    )
    ${kindFilter}
    ${ownerFilter}
    ORDER BY updated_at DESC, name ASC
    LIMIT ${limit}
  `;
  return rows.map((asset) => ({
    ...summary(asset),
    tags: asset.tags,
    metadata: asset.metadata,
    sourceUrl: asset.sourceUrl,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
  }));
}

/** Context sent to Gemini. Failure is intentionally non-fatal: the poster still works. */
export async function libraryContext(ownerInstanceId?: string) {
  try {
    return await listLibraryAssets(undefined, 60, ownerInstanceId);
  } catch {
    return [];
  }
}

export async function createLibraryAsset(input: {
  kind: LibraryKind;
  name: string;
  description: string | null;
  tags: string[];
  metadata: JsonObject;
  sourceUrl: string | null;
  contentType: string | null;
  data: Buffer | null;
  ownerInstanceId?: string;
}) {
  const sql = await getDatabase();
  const id = `asset:${randomUUID()}`;
  const rows = await sql<LibraryRow[]>`
    INSERT INTO curio_library_assets
      (id, kind, name, description, tags, metadata, source_url, content_type, size_bytes, data, owner_instance_id)
    VALUES (
      ${id},
      ${input.kind},
      ${input.name},
      ${input.description},
      ${sql.array(input.tags)},
      ${sql.json(input.metadata)},
      ${input.sourceUrl},
      ${input.contentType},
      ${input.data?.length ?? null},
       ${input.data},
       ${input.ownerInstanceId ?? null}
    )
    RETURNING id, kind, name, description, tags, metadata,
              source_url AS "sourceUrl", content_type AS "contentType",
              size_bytes AS "sizeBytes", created_at AS "createdAt"
  `;
  return rows[0];
}

export async function getLibraryAsset(id: string, ownerInstanceId?: string): Promise<(LibraryAsset & { data: Buffer | null }) | null> {
  const sql = await getDatabase();
  const ownerFilter = ownerInstanceId
    ? sql`AND (owner_instance_id IS NULL OR owner_instance_id = ${ownerInstanceId}::uuid)`
    : sql`AND owner_instance_id IS NULL`;
  const rows = await sql<LibraryFileRow[]>`
    SELECT id, kind, name, description, tags, metadata,
           source_url AS "sourceUrl", content_type AS "contentType", owner_instance_id,
           size_bytes AS "sizeBytes", created_at AS "createdAt", data
    FROM curio_library_assets
    WHERE id = ${id} ${ownerFilter}
  `;
  const asset = rows[0];
  return asset ? { ...summary(asset), tags: asset.tags, metadata: asset.metadata, sourceUrl: asset.sourceUrl, contentType: asset.contentType, sizeBytes: asset.sizeBytes, data: asset.data } : null;
}

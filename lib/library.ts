// Server-only access to the shared Curio asset library. Instance files live in
// curio_files; this table is the reusable library that Gemini can reference.
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import assetRouting from "@/data/asset-routing.json";
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

/**
 * Rows published by the Python raster engine carry this tag. They are useful
 * renderer inputs, but all 42 should not crowd the director's general asset
 * context or coach search. They remain available to the public asset route.
 */
export const ENGINE_TEXTURE_TAG = "engine-texture";

type LibraryTagOptions = {
  includeTag?: string;
  excludeTag?: string;
};

function tagFilter(sql: Sql, options: LibraryTagOptions) {
  if (options.includeTag && options.excludeTag) {
    return sql`AND ${options.includeTag} = ANY(tags) AND NOT (${options.excludeTag} = ANY(tags))`;
  }
  if (options.includeTag) return sql`AND ${options.includeTag} = ANY(tags)`;
  if (options.excludeTag) return sql`AND NOT (${options.excludeTag} = ANY(tags))`;
  return sql``;
}

export async function listLibraryAssets(
  kind?: LibraryKind,
  limit = 60,
  ownerInstanceId?: string,
  options: LibraryTagOptions = {},
): Promise<LibraryAsset[]> {
  const sql = await getDatabase();
  const assetTagFilter = tagFilter(sql, options);
  const ownerFilter = ownerInstanceId
    ? sql`AND (owner_instance_id IS NULL OR owner_instance_id = ${ownerInstanceId}::uuid) ${assetTagFilter}`
    : sql`AND owner_instance_id IS NULL ${assetTagFilter}`;
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
  options: { kind?: LibraryKind; limit?: number; ownerInstanceId?: string } & LibraryTagOptions = {},
): Promise<LibraryAsset[]> {
  const sql = await getDatabase();
  const ownerFilter = options.ownerInstanceId
    ? sql`AND (owner_instance_id IS NULL OR owner_instance_id = ${options.ownerInstanceId}::uuid)`
    : sql`AND owner_instance_id IS NULL`;
  const kindFilter = options.kind ? sql`AND kind = ${options.kind}` : sql``;
  const assetTagFilter = tagFilter(sql, options);
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
    ${assetTagFilter}
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
    return await listLibraryAssets(undefined, 60, ownerInstanceId, { excludeTag: ENGINE_TEXTURE_TAG });
  } catch {
    return [];
  }
}

/**
 * A small, deterministic slice of the raster engine's texture catalog. The
 * director can recommend these exact ids without sending 52 MB of image data
 * or displacing the normal font/palette/reference context.
 */
export async function engineTextureContext(ownerInstanceId?: string, limit = 8) {
  try {
    return await listLibraryAssets("image", Math.min(Math.max(limit, 1), 8), ownerInstanceId, {
      includeTag: ENGINE_TEXTURE_TAG,
    });
  } catch {
    return [];
  }
}

/** A bounded slice of server-published reference images for Gemini grounding. */
export async function referenceImageContext(ownerInstanceId?: string, limit = 12, query = "") {
  return referenceImageContextForQuery(ownerInstanceId, limit, query);
}

function queryTokens(query: string) {
  return query
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2)
    .filter((token) => !new Set(["the", "and", "for", "with", "make", "use", "poster", "image", "design"]).has(token));
}

function assetSearchText(asset: LibraryAsset) {
  const tagText = asset.tags.join(" ");
  const collectionTerms = assetRouting.collections
    .filter((collection) => collection.tags.some((tag) => asset.tags.includes(tag)))
    .flatMap((collection) => [collection.domain, ...collection.terms]);
  return [asset.name, asset.description ?? "", tagText, ...collectionTerms, JSON.stringify(asset.metadata)]
    .join(" ")
    .toLocaleLowerCase();
}

/**
 * Returns only references with a positive semantic match. Previously this
 * returned the alphabetically first images even when the brief had no match,
 * which made a restaurant brief inherit Charli XCX and rave references.
 */
export async function referenceImageContextForQuery(
  ownerInstanceId?: string,
  limit = 12,
  query = "",
) {
  try {
    const assets = await listLibraryAssets("image", 200, ownerInstanceId, {
      excludeTag: ENGINE_TEXTURE_TAG,
    });
    const tokens = queryTokens(query);
    if (tokens.length === 0) return [];
    return assets
      .map((asset, index) => ({
        asset,
        index,
        score: tokens.reduce((score, token) => score + (assetSearchText(asset).includes(token) ? 1 : 0), 0),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.asset.name.localeCompare(b.asset.name) || a.index - b.index)
      .slice(0, Math.min(Math.max(limit, 1), 12))
      .map(({ asset }) => asset);
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

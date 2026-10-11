// Server-only retrieval for the user-supplied design-principles corpus in TigerData.
import { getDatabase } from "./db";

export type DesignPrincipleClip = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceFilename: string;
  clipKey: string;
  clipType: string;
  title: string;
  section: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  text: string;
  tags: string[];
  metadata: Record<string, unknown>;
  rank: number;
};

type KnowledgeRow = DesignPrincipleClip;

function termsFor(query: string) {
  return [...new Set(query.toLocaleLowerCase().match(/[a-z0-9][a-z0-9-]{1,}/g) ?? [])].slice(0, 10);
}

function mapClip(row: KnowledgeRow): DesignPrincipleClip {
  return {
    ...row,
    pageStart: row.pageStart === null ? null : Number(row.pageStart),
    pageEnd: row.pageEnd === null ? null : Number(row.pageEnd),
    rank: Number(row.rank ?? 0),
  };
}

export async function searchDesignPrinciples(query: string, limit = 8): Promise<DesignPrincipleClip[]> {
  const sql = await getDatabase();
  const terms = termsFor(query);
  const boundedLimit = Math.max(1, Math.min(limit, 12));
  const searchText = terms.join(" ");
  const tagTerms = terms.length > 0 ? terms : ["foundational"];

  const rows = await sql<KnowledgeRow[]>`
    SELECT
      clips.id,
      clips.source_id AS "sourceId",
      sources.title AS "sourceTitle",
      sources.filename AS "sourceFilename",
      clips.clip_key AS "clipKey",
      clips.clip_type AS "clipType",
      clips.title,
      clips.section,
      clips.page_start AS "pageStart",
      clips.page_end AS "pageEnd",
      clips.text,
      clips.tags,
      clips.metadata,
      (
        ts_rank(
          to_tsvector('simple', clips.normalized_text),
          plainto_tsquery('simple', ${searchText})
        )
        + CASE WHEN clips.tags && ${sql.array(tagTerms)} THEN 0.25 ELSE 0 END
        + CASE WHEN clips.clip_type IN ('principle', 'method', 'index') THEN 0.08 ELSE 0 END
      ) AS rank
    FROM curio_knowledge_clips AS clips
    INNER JOIN curio_knowledge_sources AS sources ON sources.id = clips.source_id
    WHERE (
      (
        ${searchText}
      ) <> '' AND (
        to_tsvector('simple', clips.normalized_text) @@ plainto_tsquery('simple', ${searchText})
        OR clips.tags && ${sql.array(tagTerms)}
        OR clips.title ILIKE ${`%${query.trim().slice(0, 80)}%`}
      )
      OR (${searchText} = '' AND clips.tags && ARRAY['foundational']::text[])
    )
    ORDER BY rank DESC, clips.page_start NULLS LAST, clips.title ASC
    LIMIT ${boundedLimit}
  `;

  return rows.map(mapClip);
}

/**
 * Compact context for Gemini. The corpus stays in TigerData; only the clips
 * relevant to the current brief are sent to the model.
 */
export async function designPrinciplesContext(query: string): Promise<DesignPrincipleClip[]> {
  try {
    const matches = await searchDesignPrinciples(query, 8);
    if (matches.length >= 6) return matches;

    const sql = await getDatabase();
    const remaining = 8 - matches.length;
    const excluded = matches.map((match) => match.id);
    const rows = await sql<KnowledgeRow[]>`
      SELECT
        clips.id,
        clips.source_id AS "sourceId",
        sources.title AS "sourceTitle",
        sources.filename AS "sourceFilename",
        clips.clip_key AS "clipKey",
        clips.clip_type AS "clipType",
        clips.title,
        clips.section,
        clips.page_start AS "pageStart",
        clips.page_end AS "pageEnd",
        clips.text,
        clips.tags,
        clips.metadata,
        0.05 AS rank
      FROM curio_knowledge_clips AS clips
      INNER JOIN curio_knowledge_sources AS sources ON sources.id = clips.source_id
      WHERE clips.tags && ARRAY['foundational', 'grid']::text[]
        AND NOT (clips.id = ANY(${sql.array(excluded)}))
      ORDER BY CASE WHEN clips.clip_type = 'principle' THEN 0 ELSE 1 END, clips.page_start NULLS LAST
      LIMIT ${remaining}
    `;
    return [...matches, ...rows.map(mapClip)];
  } catch {
    return [];
  }
}

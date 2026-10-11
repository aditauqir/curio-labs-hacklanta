import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import postgres from "postgres";

const DATA_PATH = resolve("data/design-principles.json");
const schemaPath = resolve("db/schema.sql");
const apply = process.argv.includes("--apply");
const pdfsArg = process.argv.find((arg) => arg.startsWith("--pdfs="))?.slice("--pdfs=".length);
const maxExtractChars = Number(process.argv.find((arg) => arg.startsWith("--max-extract-chars="))?.split("=")[1] ?? 800);

function loadLocalEnv() {
  if (process.env.DATABASE_URL) return;
  const envPath = resolve(".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function normalize(text) {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function extractPdfPages(paths) {
  if (!paths.length) return [];
  const python = process.env.PDF_PYTHON || "python3";
  const script = String.raw`
import hashlib, json, sys
from pypdf import PdfReader

result = []
for filename in sys.argv[1:]:
    data = open(filename, 'rb').read()
    reader = PdfReader(filename)
    pages = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = ' '.join((page.extract_text() or '').split())
        if text:
            pages.append({
                'page': page_number,
                'text': text,
            })
    result.append({
        'filename': filename.split('/')[-1],
        'sourceHash': hashlib.sha256(data).hexdigest(),
        'pageCount': len(reader.pages),
        'pages': pages,
    })
print(json.dumps(result))
`;
  const result = spawnSync(python, ["-c", script, ...paths], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "PDF extraction failed");
  }
  return JSON.parse(result.stdout);
}

function records() {
  const corpus = JSON.parse(readFileSync(DATA_PATH, "utf8"));
  const extracted = extractPdfPages(
    (pdfsArg ? pdfsArg.split(",") : []).map((path) => resolve(path)).filter((path) => existsSync(path)),
  );
  const byHash = new Map(extracted.map((source) => [source.sourceHash, source]));
  const sources = corpus.sources.map((source) => {
    const actual = byHash.get(source.sourceHash);
    const clips = source.clips.map((clip) => ({
      ...clip,
      sourceId: source.id,
      text: clip.text.trim(),
      normalizedText: normalize(clip.text),
      metadata: clip.metadata ?? {},
    }));
    if (actual) {
      for (const page of actual.pages) {
        const text = page.text.slice(0, Math.max(200, Math.min(maxExtractChars, 2000)));
        clips.push({
          key: `page:${page.page}`,
          type: "page_extract",
          title: `Page ${page.page} extract`,
          section: "PDF page extract",
          pageStart: page.page,
          pageEnd: page.page,
          text,
          normalizedText: normalize(text),
          tags: ["page-extract", "source-text"],
          metadata: {
            extractionMethod: "pypdf",
            truncated: page.text.length > text.length,
            originalCharacterCount: page.text.length,
          },
          sourceId: source.id,
        });
      }
    }
    return {
      ...source,
      pageCount: actual?.pageCount ?? source.pageCount,
      clips,
    };
  });
  return { sources, extractedCount: extracted.reduce((count, source) => count + source.pages.length, 0) };
}

const corpus = records();
const clipCount = corpus.sources.reduce((count, source) => count + source.clips.length, 0);
console.log(`Prepared ${corpus.sources.length} sources and ${clipCount} clips (${corpus.extractedCount} bounded page extracts).`);

if (!apply) {
  for (const source of corpus.sources) console.log(`  ${source.title}: ${source.clips.length} clips`);
  console.log("Dry run only. Re-run with --apply to write this corpus to TigerData.");
  process.exit(0);
}

loadLocalEnv();
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Run this on the app server or provide it in the environment.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15 });
let sourceCount = 0;
let clipCountWritten = 0;

try {
  await sql.unsafe(readFileSync(schemaPath, "utf8"));
  await sql.begin(async (transaction) => {
    for (const source of corpus.sources) {
      await transaction`
        INSERT INTO curio_knowledge_sources
          (id, title, filename, source_hash, source_type, page_count, extraction_method, metadata)
        VALUES (
          ${source.id}, ${source.title}, ${source.filename}, ${source.sourceHash}, 'pdf',
          ${source.pageCount}, ${source.extractionMethod}, ${transaction.json(source.metadata)}
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          filename = EXCLUDED.filename,
          source_hash = EXCLUDED.source_hash,
          page_count = EXCLUDED.page_count,
          extraction_method = EXCLUDED.extraction_method,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `;

      await transaction`
        INSERT INTO curio_library_assets
          (id, kind, name, description, tags, metadata, source_url, content_type, size_bytes, data)
        VALUES (
          ${`document:${source.id}`}, 'document', ${source.title},
          ${`User-supplied design reference with ${source.clips.length} searchable principle and extract clips.`},
          ${transaction.array(["design-principles", "pdf", "source-of-truth", "gemini"])},
          ${transaction.json({ sourceId: source.id, sourceHash: source.sourceHash, pageCount: source.pageCount, extractionMethod: source.extractionMethod })},
          NULL, 'application/pdf', NULL, NULL
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          tags = EXCLUDED.tags,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `;
      sourceCount += 1;

      for (const clip of source.clips) {
        await transaction`
          INSERT INTO curio_knowledge_clips
            (id, source_id, clip_key, clip_type, title, section, page_start, page_end, text, normalized_text, tags, metadata)
          VALUES (
            ${`knowledge:${source.id}:${clip.key}`}, ${source.id}, ${clip.key}, ${clip.type}, ${clip.title},
            ${clip.section ?? null}, ${clip.pageStart ?? null}, ${clip.pageEnd ?? null}, ${clip.text},
            ${clip.normalizedText}, ${transaction.array(clip.tags)}, ${transaction.json(clip.metadata)}
          )
          ON CONFLICT (source_id, clip_key) DO UPDATE SET
            clip_type = EXCLUDED.clip_type,
            title = EXCLUDED.title,
            section = EXCLUDED.section,
            page_start = EXCLUDED.page_start,
            page_end = EXCLUDED.page_end,
            text = EXCLUDED.text,
            normalized_text = EXCLUDED.normalized_text,
            tags = EXCLUDED.tags,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        `;
        clipCountWritten += 1;
      }
    }
  });
} finally {
  await sql.end({ timeout: 5 });
}

console.log(`Stored ${sourceCount} sources and ${clipCountWritten} clips in TigerData.`);

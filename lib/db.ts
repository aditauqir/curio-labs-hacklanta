// Server-only PostgreSQL access. The connection string is read at runtime and
// is never returned to a client or included in an error response.
import postgres, { type Sql } from "postgres";
import { colorPalettes, fontPairs, referenceCards } from "./design-presets";

const SCHEMA_PATH = `${process.cwd()}/db/schema.sql`;

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Database is not configured");
    this.name = "DatabaseUnavailableError";
  }
}

let client: Sql | null = null;
let schemaReady: Promise<void> | null = null;

const BUILTIN_LIBRARY = [
  ...fontPairs.map((font) => ({
    id: `font:${font.id}`,
    kind: "font",
    name: font.name,
    description: font.label,
    tags: ["font", font.label.toLowerCase(), font.heading.toLowerCase(), font.body.toLowerCase()],
    metadata: {
      fontPairId: font.id,
      heading: font.heading,
      body: font.body,
      headingWeight: font.headingWeight,
      widthRatio: font.widthRatio,
    },
  })),
  ...colorPalettes.map((palette) => ({
    id: `palette:${palette.id}`,
    kind: "palette",
    name: palette.name,
    description: palette.note,
    tags: ["palette", palette.name.toLowerCase(), palette.note.toLowerCase()],
    metadata: { paletteId: palette.id, colors: palette.colors },
  })),
  ...referenceCards.map((card) => ({
    id: `reference:${card.id}`,
    kind: "reference",
    name: card.title,
    description: card.category,
    tags: ["reference", card.category.toLowerCase()],
    metadata: { referenceId: card.id, source: card.source },
  })),
];

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function getClient() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new DatabaseUnavailableError();

  if (!client) {
    client = postgres(url, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 5,
      ssl: "require",
    });
  }
  return client;
}

/** Runs the idempotent schema once per application process. */
export async function getDatabase(): Promise<Sql> {
  const sql = getClient();
  if (!schemaReady) {
    schemaReady = sql.file(SCHEMA_PATH).then(async () => {
      for (const asset of BUILTIN_LIBRARY) {
        await sql`
          INSERT INTO curio_library_assets
            (id, kind, name, description, tags, metadata, updated_at)
          VALUES (
            ${asset.id},
            ${asset.kind},
            ${asset.name},
            ${asset.description},
            ${sql.array(asset.tags)},
            ${sql.json(asset.metadata)},
            NOW()
          )
          ON CONFLICT (id) DO UPDATE SET
            kind = EXCLUDED.kind,
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            tags = EXCLUDED.tags,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        `;
      }
    }).then(
      () => undefined,
      (error) => {
        schemaReady = null;
        throw error;
      },
    );
  }
  await schemaReady;
  return sql;
}

export function logDatabaseFailure(scope: string) {
  console.error(`[database] ${scope} failed`);
}

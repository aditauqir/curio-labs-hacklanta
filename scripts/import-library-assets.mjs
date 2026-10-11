import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import postgres from "postgres";

const IMAGE_TYPES = new Map([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

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

function arg(name) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function collectFiles(root, result = []) {
  if (!existsSync(root)) return result;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) collectFiles(path, result);
    else if (entry.isFile() && IMAGE_TYPES.has(extname(entry.name).toLowerCase())) result.push(path);
  }
  return result;
}

function humanize(value) {
  const special = {
    charlixcx: "Charli XCX",
    undergroundraveclubflyers: "Underground rave club flyers",
  };
  return special[value] || value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function classificationFor(group) {
  const key = group.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (key === "charlixcx") {
    return { domain: "music", subject: "artist-poster", suitability: ["music", "club-pop", "concert"] };
  }
  if (key === "undergroundraveclubflyers") {
    return { domain: "music", subject: "event-poster", suitability: ["music", "rave", "nightlife"] };
  }
  if (key === "typographybrutalist") {
    return { domain: "graphic-design", subject: "typography", suitability: ["editorial", "type", "brutalist"] };
  }
  return { domain: "reference", subject: "unclassified", suitability: [] };
}

function recordFor(path, root, importedFrom) {
  const data = readFileSync(path);
  const extension = extname(path).toLowerCase();
  const relativePath = relative(root, path).split(sep).join("/");
  const pathParts = relativePath.split("/");
  const group = pathParts.length > 1 ? pathParts[pathParts.length - 2] : "Curio library";
  const filename = pathParts[pathParts.length - 1].replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  const classification = classificationFor(group);
  const sha256 = createHash("sha256").update(data).digest("hex");
  return {
    id: `server:reference:${sha256}`,
    name: `${humanize(group)} · ${filename}`,
    description: `Server reference image from ${humanize(group)}.`,
    tags: [
      "server-library",
      "reference-image",
      humanize(group).toLowerCase().replace(/\s+/g, "-"),
      `domain:${classification.domain}`,
      `subject:${classification.subject}`,
      ...classification.suitability.map((tag) => `suitable-for:${tag}`),
    ],
    metadata: {
      source: "vultr-curio-library",
      relativePath,
      sha256,
      classification,
      importedFrom,
    },
    contentType: IMAGE_TYPES.get(extension),
    data,
  };
}

const root = resolve(arg("root") || "/var/www/curiolabs/app/api/assets/curiolabs");
const scope = arg("scope") || "references";
const sourceRoot = scope === "all" ? root : resolve(root, scope);
const paths = collectFiles(sourceRoot).sort();
const records = paths.map((path) => recordFor(path, root, scope));

console.log(`Found ${records.length} image files under ${sourceRoot}.`);
if (records.length === 0) process.exit(0);

if (!process.argv.includes("--apply")) {
  for (const record of records) console.log(`  ${record.name} (${record.data.length} bytes)`);
  console.log("Dry run only. Re-run with --apply to write these files to TigerData.");
  process.exit(0);
}

loadLocalEnv();
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Run this on the app server or provide it in the environment.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15 });
let inserted = 0;
let skipped = 0;

try {
  await sql.begin(async (transaction) => {
    for (const record of records) {
      const existing = await transaction`
        SELECT id
        FROM curio_library_assets
        WHERE metadata->>'sha256' = ${record.metadata.sha256}
        LIMIT 1
      `;

      if (existing.length > 0) {
        await transaction`
          UPDATE curio_library_assets
          SET name = ${record.name},
              description = ${record.description},
              tags = ${transaction.array(record.tags)},
              metadata = ${transaction.json(record.metadata)},
              content_type = ${record.contentType},
              size_bytes = ${record.data.length},
              data = ${record.data},
              updated_at = NOW()
          WHERE id = ${existing[0].id}
        `;
        skipped += 1;
        continue;
      }

      await transaction`
        INSERT INTO curio_library_assets
          (id, kind, name, description, tags, metadata, source_url, content_type, size_bytes, data)
        VALUES (
          ${record.id},
          'image',
          ${record.name},
          ${record.description},
          ${transaction.array(record.tags)},
          ${transaction.json(record.metadata)},
          NULL,
          ${record.contentType},
          ${record.data.length},
          ${record.data}
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          tags = EXCLUDED.tags,
          metadata = EXCLUDED.metadata,
          content_type = EXCLUDED.content_type,
          size_bytes = EXCLUDED.size_bytes,
          data = EXCLUDED.data,
          updated_at = NOW()
      `;
      inserted += 1;
    }
  });
} finally {
  await sql.end({ timeout: 5 });
}

console.log(`Imported ${inserted} reference images; skipped ${skipped} existing files.`);

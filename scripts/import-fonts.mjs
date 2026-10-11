import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import postgres from "postgres";

const FONT_EXTENSIONS = new Map([
  [".otf", "font/otf"],
  [".ttf", "font/ttf"],
  [".ttc", "font/collection"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
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

function rootsFromArgs() {
  const value = process.argv.find((arg) => arg.startsWith("--roots="))?.slice("--roots=".length);
  if (value) return value.split(",").map((root) => resolve(root));
  return ["/System/Library/Fonts", "/Library/Fonts", join(homedir(), "Library/Fonts")];
}

function collectFonts(root, result = []) {
  if (!existsSync(root)) return result;
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) collectFonts(path, result);
    else if (entry.isFile() && FONT_EXTENSIONS.has(extname(entry.name).toLowerCase())) result.push(path);
  }
  return result;
}

function fontName(path) {
  return path.split(/[\\/]/).pop()?.replace(/\.(otf|ttf|ttc|woff2?)$/i, "") || path;
}

const roots = rootsFromArgs();
const files = [...new Set(roots.flatMap((root) => collectFonts(root)))].sort();
const records = files.map((path) => {
  const data = readFileSync(path);
  const extension = extname(path).toLowerCase();
  const sha256 = createHash("sha256").update(data).digest("hex");
  return {
    path,
    name: fontName(path),
    contentType: FONT_EXTENSIONS.get(extension),
    data,
    sha256,
  };
});

console.log(`Found ${records.length} font files in ${roots.length} directories.`);
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
        SELECT 1
        FROM curio_library_assets
        WHERE kind = 'font' AND metadata->>'sha256' = ${record.sha256}
        LIMIT 1
      `;
      if (existing.length > 0) {
        skipped += 1;
        continue;
      }

      await transaction`
        INSERT INTO curio_library_assets
          (id, kind, name, description, tags, metadata, source_url, content_type, size_bytes, data)
        VALUES (
          ${`asset:${randomUUID()}`},
          'font',
          ${record.name},
          'Imported from the macOS font library.',
          ${transaction.array(["macos-font", "typography"])},
          ${transaction.json({
            filename: record.path.split(/[\\/]/).pop() || record.name,
            format: record.contentType,
            sha256: record.sha256,
            source: "macos-font-import",
          })},
          NULL,
          ${record.contentType},
          ${record.data.length},
          ${record.data}
        )
      `;
      inserted += 1;
    }
  });
} finally {
  await sql.end({ timeout: 5 });
}

console.log(`Imported ${inserted} fonts; skipped ${skipped} existing files.`);

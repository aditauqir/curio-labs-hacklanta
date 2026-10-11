import { logDatabaseFailure } from "@/lib/db";
import { rateLimited } from "@/lib/rate-limit";
import { parseDesignDocument } from "@/lib/pipeline/document";
import { createVersion, getVersion, listVersions } from "@/lib/pipeline/store";
import { fail, ok, readJson, requireProject } from "@/lib/pipeline/http";

type RouteProps = { params: Promise<{ id: string }> };
type RestoreBody = { version?: unknown };

const MAX_BODY_BYTES = 2 * 1024;

export async function GET(_request: Request, { params }: RouteProps) {
  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;

  try {
    return ok({ versions: await listVersions(resolved.context.project.id) });
  } catch {
    logDatabaseFailure("list versions");
    return fail(503, "database_unavailable");
  }
}

/**
 * Restores an earlier version by appending a copy of it as a new version.
 * History is append-only: restoring never deletes the versions in between, so
 * the restore itself can be undone.
 */
export async function POST(request: Request, { params }: RouteProps) {
  const limited = rateLimited(request, "pipeline-restore", { perClientPerMinute: 20, globalPerHour: 400 });
  if (limited) return limited;

  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;
  const { project } = resolved.context;

  const parsed = await readJson<RestoreBody>(request, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const target = Number(parsed.value.version);
  if (!Number.isInteger(target) || target < 1) return fail(400, "invalid_version");

  try {
    const row = await getVersion(project.id, target);
    if (!row) return fail(404, "version_not_found");

    const validated = parseDesignDocument(row.document);
    if (!validated.ok) return fail(500, "stored_document_invalid", { issues: validated.issues });

    const version = await createVersion(project.id, {
      document: validated.value,
      summary: `Restored version ${target}`,
      changes: [`restored:${target}`],
      parentVersion: target,
    });

    return ok({ version, restoredFrom: target, document: validated.value });
  } catch {
    logDatabaseFailure("restore version");
    return fail(503, "database_unavailable");
  }
}

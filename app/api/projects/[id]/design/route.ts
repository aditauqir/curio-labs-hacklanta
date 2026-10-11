import { logDatabaseFailure } from "@/lib/db";
import { countElements, parseDesignDocument } from "@/lib/pipeline/document";
import { getLatestVersion, getVersion } from "@/lib/pipeline/store";
import { fail, ok, requireProject } from "@/lib/pipeline/http";

type RouteProps = { params: Promise<{ id: string }> };

/** Returns a design document. ?version= selects one, default is the latest. */
export async function GET(request: Request, { params }: RouteProps) {
  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;

  const requested = Number(new URL(request.url).searchParams.get("version"));

  try {
    const row = Number.isInteger(requested) && requested > 0
      ? await getVersion(resolved.context.project.id, requested)
      : await getLatestVersion(resolved.context.project.id);
    if (!row) return fail(404, "no_design");

    const validated = parseDesignDocument(row.document);
    if (!validated.ok) return fail(500, "stored_document_invalid", { issues: validated.issues });

    return ok({
      version: row.version,
      parentVersion: row.parentVersion,
      summary: row.summary,
      createdAt: row.createdAt,
      elementCount: countElements(validated.value),
      document: validated.value,
    });
  } catch {
    logDatabaseFailure("load design");
    return fail(503, "database_unavailable");
  }
}

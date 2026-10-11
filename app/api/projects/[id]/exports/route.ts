import { logDatabaseFailure } from "@/lib/db";
import { rateLimited } from "@/lib/rate-limit";
import { parseDesignDocument } from "@/lib/pipeline/document";
import { renderDocumentToSvg } from "@/lib/pipeline/render";
import { blocksExport, runDeterministicChecks } from "@/lib/pipeline/validator";
import {
  createExport,
  getBrief,
  getLatestVersion,
  getVersion,
  listExports,
  updateProject,
} from "@/lib/pipeline/store";
import { fail, ok, readJson, requireProject } from "@/lib/pipeline/http";
import { oneOf } from "@/lib/pipeline/validate";

type RouteProps = { params: Promise<{ id: string }> };
type Body = { format?: unknown; version?: unknown; width?: unknown; force?: unknown };

const MAX_BODY_BYTES = 2 * 1024;
const FORMATS = ["svg", "json"] as const;

export async function GET(_request: Request, { params }: RouteProps) {
  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;

  try {
    return ok({ exports: await listExports(resolved.context.project.id) });
  } catch {
    logDatabaseFailure("list exports");
    return fail(503, "database_unavailable");
  }
}

/**
 * Produces an export and stores it.
 *
 * Exports are gated on the deterministic checks: a design with a missing
 * headline or an unresolved hero image is not exportable. `force: true` is
 * allowed but the response still reports what was wrong, so a caller can
 * never end up with a broken file and no explanation.
 */
export async function POST(request: Request, { params }: RouteProps) {
  const limited = rateLimited(request, "pipeline-export", { perClientPerMinute: 12, globalPerHour: 300 });
  if (limited) return limited;

  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;
  const { project } = resolved.context;

  const parsed = await readJson<Body>(request, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const format = oneOf(parsed.value.format, FORMATS) ?? "svg";
  const requested = Number(parsed.value.version);
  const width = Number(parsed.value.width);
  const force = parsed.value.force === true;

  let row;
  let brief;
  try {
    row = Number.isInteger(requested) && requested > 0
      ? await getVersion(project.id, requested)
      : await getLatestVersion(project.id);
    if (!row) return fail(404, "no_design");
    brief = await getBrief(project.id);
  } catch {
    logDatabaseFailure("load design for export");
    return fail(503, "database_unavailable");
  }

  const validated = parseDesignDocument(row.document);
  if (!validated.ok) return fail(500, "stored_document_invalid", { issues: validated.issues });

  const report = runDeterministicChecks(validated.value, { brief });
  const blocking = blocksExport(report);
  if (blocking.length > 0 && !force) {
    return fail(409, "export_blocked", {
      blocking: blocking.map((check) => ({ id: check.id, detail: check.detail })),
    });
  }

  const payload =
    format === "svg"
      ? {
          contentType: "image/svg+xml; charset=utf-8",
          body: renderDocumentToSvg(validated.value, {
            width: Number.isFinite(width) && width >= 64 && width <= 4096 ? width : undefined,
          }).svg,
        }
      : {
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify(
            {
              project: { id: project.id, name: project.name, format: project.format },
              version: row.version,
              exportedAt: new Date().toISOString(),
              brief,
              document: validated.value,
              checks: report.checks,
            },
            null,
            2,
          ),
        };

  try {
    const record = await createExport(project.id, {
      version: row.version,
      format,
      contentType: payload.contentType,
      data: Buffer.from(payload.body, "utf8"),
    });
    if (blocking.length === 0) await updateProject(project.id, { status: "complete" });

    return ok(
      {
        export: { ...record, format, version: row.version, contentType: payload.contentType },
        downloadUrl: `/api/projects/${project.id}/exports/${record.id}`,
        forced: blocking.length > 0,
        blocking: blocking.map((check) => ({ id: check.id, detail: check.detail })),
      },
      201,
    );
  } catch {
    logDatabaseFailure("save export");
    return fail(503, "database_unavailable");
  }
}

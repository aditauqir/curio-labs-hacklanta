import { logDatabaseFailure } from "@/lib/db";
import { rateLimited } from "@/lib/rate-limit";
import { getTextProvider } from "@/lib/ai/provider";
import { parseDesignDocument } from "@/lib/pipeline/document";
import { applyOperations, planRevision } from "@/lib/pipeline/revise";
import { createVersion, getLatestVersion, getVersion } from "@/lib/pipeline/store";
import { fail, ok, pipelineFailure, readJson, requireProject } from "@/lib/pipeline/http";
import { text } from "@/lib/pipeline/validate";

type RouteProps = { params: Promise<{ id: string }> };
type Body = { request?: unknown; version?: unknown };

const MAX_BODY_BYTES = 8 * 1024;

/**
 * Applies a targeted revision and saves the result as a NEW version. The base
 * version is never mutated, so every revision is reversible by restoring the
 * parent.
 */
export async function POST(request: Request, { params }: RouteProps) {
  const limited = rateLimited(request, "pipeline-revise", { perClientPerMinute: 15, globalPerHour: 400 });
  if (limited) return limited;

  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;
  const { project } = resolved.context;

  const parsed = await readJson<Body>(request, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const instruction = text(parsed.value.request, 600);
  if (!instruction) return fail(400, "invalid_request");

  const provider = await getTextProvider();
  if (!provider) return fail(503, "ai_not_configured");

  const requested = Number(parsed.value.version);

  let base;
  try {
    base = Number.isInteger(requested) && requested > 0
      ? await getVersion(project.id, requested)
      : await getLatestVersion(project.id);
  } catch {
    logDatabaseFailure("load base version");
    return fail(503, "database_unavailable");
  }
  if (!base) return fail(404, "no_design");

  const validated = parseDesignDocument(base.document);
  if (!validated.ok) return fail(500, "stored_document_invalid", { issues: validated.issues });

  let plan;
  try {
    plan = await planRevision(provider, { document: validated.value, request: instruction });
  } catch (error) {
    return pipelineFailure(error);
  }

  const result = applyOperations(validated.value, plan.operations);

  if (result.applied.length === 0) {
    // No new version for a no-op: version history should record real changes.
    return ok({
      applied: [],
      rejected: result.rejected,
      version: base.version,
      created: false,
      summary: "Nothing changed. The request did not map onto any editable element.",
      model: plan.model,
      provider: plan.provider,
    });
  }

  // Re-validate after editing: an operation must not be able to produce a
  // document the renderer would choke on.
  const revalidated = parseDesignDocument(result.document);
  if (!revalidated.ok) return fail(500, "revision_invalid", { issues: revalidated.issues });

  try {
    const version = await createVersion(project.id, {
      document: revalidated.value,
      summary: plan.summary || result.summary,
      changes: result.applied,
      parentVersion: base.version,
    });

    return ok({
      version,
      created: true,
      parentVersion: base.version,
      applied: result.applied,
      rejected: result.rejected,
      summary: plan.summary || result.summary,
      document: revalidated.value,
      model: plan.model,
      provider: plan.provider,
    });
  } catch {
    logDatabaseFailure("save revision");
    return fail(503, "database_unavailable");
  }
}

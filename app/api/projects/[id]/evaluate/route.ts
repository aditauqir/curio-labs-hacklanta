import { logDatabaseFailure } from "@/lib/db";
import { rateLimited } from "@/lib/rate-limit";
import { getTextProvider } from "@/lib/ai/provider";
import { evaluateCreative } from "@/lib/pipeline/critique";
import { parseDesignDocument } from "@/lib/pipeline/document";
import { blocksExport, runDeterministicChecks } from "@/lib/pipeline/validator";
import {
  getBrief,
  getEvaluation,
  getLatestVersion,
  getVersion,
  listConcepts,
  saveEvaluation,
} from "@/lib/pipeline/store";
import { fail, ok, requireProject } from "@/lib/pipeline/http";

type RouteProps = { params: Promise<{ id: string }> };

async function loadTarget(projectId: string, requested: number) {
  return Number.isInteger(requested) && requested > 0
    ? getVersion(projectId, requested)
    : getLatestVersion(projectId);
}

export async function GET(request: Request, { params }: RouteProps) {
  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;

  const requested = Number(new URL(request.url).searchParams.get("version"));
  try {
    const row = await loadTarget(resolved.context.project.id, requested);
    if (!row) return fail(404, "no_design");
    const evaluation = await getEvaluation(resolved.context.project.id, row.version);
    if (!evaluation) return fail(404, "no_evaluation");
    return ok({ version: row.version, ...evaluation });
  } catch {
    logDatabaseFailure("load evaluation");
    return fail(503, "database_unavailable");
  }
}

/**
 * Runs both halves of Stage G. Deterministic checks always run. Creative
 * evaluation runs only if a model is configured and is reported as
 * unavailable otherwise, never silently skipped.
 *
 * The two results stay separate in the response: `blocking` is derived only
 * from critical deterministic failures, so a generous creative score cannot
 * mask a missing headline or a broken asset.
 */
export async function POST(request: Request, { params }: RouteProps) {
  const limited = rateLimited(request, "pipeline-evaluate", { perClientPerMinute: 12, globalPerHour: 400 });
  if (limited) return limited;

  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;
  const { project } = resolved.context;

  const requested = Number(new URL(request.url).searchParams.get("version"));

  let row;
  let brief;
  let concepts;
  try {
    row = await loadTarget(project.id, requested);
    if (!row) return fail(404, "no_design");
    [brief, concepts] = await Promise.all([getBrief(project.id), listConcepts(project.id)]);
  } catch {
    logDatabaseFailure("load design for evaluation");
    return fail(503, "database_unavailable");
  }

  const validated = parseDesignDocument(row.document);
  if (!validated.ok) return fail(500, "stored_document_invalid", { issues: validated.issues });

  const deterministic = runDeterministicChecks(validated.value, { brief });
  const concept = concepts.find((entry) => entry.id === validated.value.meta.conceptId) ?? null;

  const provider = await getTextProvider();
  const creative = await evaluateCreative(provider, { document: validated.value, concept });

  const blocking = blocksExport(deterministic);

  try {
    await saveEvaluation(project.id, {
      version: row.version,
      status: deterministic.status,
      deterministic,
      creative,
    });
  } catch {
    logDatabaseFailure("save evaluation");
    // The evaluation is still valid and useful; only the record failed.
  }

  return ok({
    version: row.version,
    status: deterministic.status,
    deterministic,
    creative,
    blocking: blocking.map((check) => ({ id: check.id, detail: check.detail })),
    exportable: blocking.length === 0,
  });
}

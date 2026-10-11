import { logDatabaseFailure } from "@/lib/db";
import { rateLimited } from "@/lib/rate-limit";
import { getTextProvider } from "@/lib/ai/provider";
import { generateConcepts } from "@/lib/pipeline/concepts";
import {
  claimJob,
  failJob,
  finishJob,
  getBrief,
  hashRequest,
  listConcepts,
  saveConcepts,
  updateProject,
} from "@/lib/pipeline/store";
import { fail, ok, pipelineFailure, requireProject } from "@/lib/pipeline/http";

type RouteProps = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteProps) {
  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;

  try {
    const concepts = await listConcepts(resolved.context.project.id);
    return ok({ concepts, selectedConceptId: resolved.context.project.selectedConceptId });
  } catch {
    logDatabaseFailure("list concepts");
    return fail(503, "database_unavailable");
  }
}

/**
 * Generates three concepts. Recorded as a job so an identical repeat request
 * returns the first result rather than paying for a second model call.
 */
export async function POST(request: Request, { params }: RouteProps) {
  const limited = rateLimited(request, "pipeline-concepts", { perClientPerMinute: 6, globalPerHour: 200 });
  if (limited) return limited;

  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;
  const { project } = resolved.context;

  const provider = await getTextProvider();
  if (!provider) return fail(503, "ai_not_configured");

  let brief;
  try {
    brief = await getBrief(project.id);
  } catch {
    logDatabaseFailure("load brief");
    return fail(503, "database_unavailable");
  }
  if (!brief) return fail(409, "brief_required");

  const requestHash = hashRequest({ kind: "concepts", brief });
  let job;
  try {
    job = await claimJob(project.id, { kind: "concepts", requestHash });
  } catch {
    logDatabaseFailure("claim concepts job");
    return fail(503, "database_unavailable");
  }

  if (job.job.state === "succeeded") {
    const concepts = await listConcepts(project.id);
    return ok({ concepts, jobId: job.job.id, reused: true });
  }

  try {
    const result = await generateConcepts(provider, brief);
    await saveConcepts(project.id, {
      concepts: result.concepts,
      model: result.model,
      provider: result.provider,
    });
    await updateProject(project.id, { status: "concepts" });
    await finishJob(job.job.id, { conceptIds: result.concepts.map((concept) => concept.id) });

    return ok({
      concepts: result.concepts,
      // Surfaced because a reassigned strategy is our correction, not the
      // model's choice, and the caller should be able to tell the difference.
      adjustments: result.adjustments,
      model: result.model,
      provider: result.provider,
      jobId: job.job.id,
      reused: false,
    });
  } catch (error) {
    await failJob(job.job.id, error instanceof Error ? error.message : "unknown error").catch(() => undefined);
    return pipelineFailure(error);
  }
}

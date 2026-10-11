import { logDatabaseFailure } from "@/lib/db";
import { getJob } from "@/lib/pipeline/store";
import { fail, isUuid, ok, requireProject } from "@/lib/pipeline/http";

type RouteProps = { params: Promise<{ id: string; jobId: string }> };

/**
 * Job state for a pipeline run.
 *
 * Stages currently execute inline within their own request, so a job is
 * already terminal by the time it can be read. The record exists for
 * provenance and for deduplicating repeat requests, and it is the seam where
 * a background worker would attach without changing this contract.
 */
export async function GET(_request: Request, { params }: RouteProps) {
  const { id, jobId } = await params;
  if (!isUuid(jobId)) return fail(404, "not_found");

  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;

  try {
    const job = await getJob(resolved.context.project.id, jobId);
    if (!job) return fail(404, "not_found");
    return ok({ job });
  } catch {
    logDatabaseFailure("load job");
    return fail(503, "database_unavailable");
  }
}

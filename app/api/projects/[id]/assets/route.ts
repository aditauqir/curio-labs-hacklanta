import { logDatabaseFailure } from "@/lib/db";
import { aiCapabilities } from "@/lib/ai/provider";
import { listAssets } from "@/lib/pipeline/store";
import { fail, ok, requireProject } from "@/lib/pipeline/http";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * The asset plan for the selected concept.
 *
 * `status: "unavailable"` means the asset cannot be produced in this
 * deployment and says why. It is reported rather than hidden, so the caller
 * knows a hero image is a placeholder and not a finished asset.
 */
export async function GET(_request: Request, { params }: RouteProps) {
  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;

  try {
    const assets = await listAssets(resolved.context.project.id);
    return ok({
      assets,
      blocked: assets.filter((asset) => asset.status === "unavailable"),
      capabilities: aiCapabilities(),
    });
  } catch {
    logDatabaseFailure("list assets");
    return fail(503, "database_unavailable");
  }
}

import { logDatabaseFailure } from "@/lib/db";
import { rateLimited } from "@/lib/rate-limit";
import { getTextProvider } from "@/lib/ai/provider";
import { interpretBrief } from "@/lib/pipeline/brief";
import {
  getBrief,
  getLatestVersion,
  listAssets,
  listConcepts,
  listVersions,
  saveBrief,
} from "@/lib/pipeline/store";
import { fail, ok, pipelineFailure, readJson, requireProject } from "@/lib/pipeline/http";
import { text } from "@/lib/pipeline/validate";

type RouteProps = { params: Promise<{ id: string }> };

const MAX_BODY_BYTES = 32 * 1024;

export async function GET(_request: Request, { params }: RouteProps) {
  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;
  const { project } = resolved.context;

  try {
    const [brief, concepts, assets, latest, versions] = await Promise.all([
      getBrief(project.id),
      listConcepts(project.id),
      listAssets(project.id),
      getLatestVersion(project.id),
      listVersions(project.id),
    ]);

    return ok({
      project,
      brief,
      concepts,
      assets,
      currentVersion: latest ? { version: latest.version, summary: latest.summary, createdAt: latest.createdAt } : null,
      versions,
    });
  } catch {
    logDatabaseFailure("load project detail");
    return fail(503, "database_unavailable");
  }
}

type PatchBody = { brief?: unknown };

/** Replaces the brief. Concepts and versions are left alone on purpose. */
export async function PATCH(request: Request, { params }: RouteProps) {
  const limited = rateLimited(request, "pipeline-brief", { perClientPerMinute: 10, globalPerHour: 300 });
  if (limited) return limited;

  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;
  const { project } = resolved.context;

  const parsed = await readJson<PatchBody>(request, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const briefText = text(parsed.value.brief, 4000, { newlines: true });
  if (!briefText) return fail(400, "invalid_brief");

  const provider = await getTextProvider();
  if (!provider) return fail(503, "ai_not_configured");

  try {
    const { brief, model, provider: providerId } = await interpretBrief(provider, {
      briefText,
      formatHint: project.format as never,
    });
    await saveBrief(project.id, { rawText: briefText, brief, model, provider: providerId });
    return ok({ brief, model, provider: providerId });
  } catch (error) {
    return pipelineFailure(error);
  }
}

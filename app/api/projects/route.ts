import { getAccountContext } from "@/lib/instance";
import { logDatabaseFailure } from "@/lib/db";
import { rateLimited } from "@/lib/rate-limit";
import { getTextProvider } from "@/lib/ai/provider";
import { FORMAT_IDS, interpretBrief, type FormatId } from "@/lib/pipeline/brief";
import { createProject, listProjects, saveBrief, updateProject } from "@/lib/pipeline/store";
import { fail, ok, pipelineFailure, readJson, withCookie } from "@/lib/pipeline/http";
import { text } from "@/lib/pipeline/validate";

const MAX_BODY_BYTES = 32 * 1024;

export async function GET(request: Request) {
  const account = await getAccountContext();
  try {
    const projects = await listProjects(account.id);
    return withCookie(ok({ projects }), request, account);
  } catch {
    logDatabaseFailure("list projects");
    return fail(503, "database_unavailable");
  }
}

type CreateBody = { name?: unknown; brief?: unknown; format?: unknown };

/**
 * Creates a project. When a brief is supplied it is interpreted in the same
 * request, because a project without a brief cannot do anything useful and a
 * second round trip would only add a failure mode.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "pipeline-project", { perClientPerMinute: 10, globalPerHour: 300 });
  if (limited) return limited;

  const account = await getAccountContext();
  const parsed = await readJson<CreateBody>(request, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const briefText = text(parsed.value.brief, 4000, { newlines: true });
  const format = typeof parsed.value.format === "string" && (FORMAT_IDS as string[]).includes(parsed.value.format)
    ? (parsed.value.format as FormatId)
    : "print-poster";
  const name = text(parsed.value.name, 120) ?? text(briefText, 60) ?? "Untitled project";

  let project;
  try {
    project = await createProject(account.id, { name, format });
  } catch {
    logDatabaseFailure("create project");
    return fail(503, "database_unavailable");
  }

  if (!briefText) {
    return withCookie(ok({ project, brief: null }, 201), request, account);
  }

  const provider = await getTextProvider();
  if (!provider) {
    // The project exists; the brief simply could not be interpreted. Say so
    // rather than deleting the project or pretending a brief was produced.
    return withCookie(
      ok({ project, brief: null, warning: "ai_not_configured" }, 201),
      request,
      account,
    );
  }

  try {
    const { brief, model, provider: providerId } = await interpretBrief(provider, {
      briefText,
      formatHint: format,
    });
    await saveBrief(project.id, { rawText: briefText, brief, model, provider: providerId });
    await updateProject(project.id, { status: "draft" });
    return withCookie(ok({ project, brief, model, provider: providerId }, 201), request, account);
  } catch (error) {
    return pipelineFailure(error);
  }
}

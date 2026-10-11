// Shared plumbing for the pipeline API routes.
//
// Keeps the existing conventions from app/api/*: { error: "snake_case" } error
// bodies with no upstream detail, Cache-Control: no-store everywhere, a
// content-length pre-check before parsing, and the instance cookie attached on
// any response that minted one.
import { NextResponse } from "next/server";
import { logDatabaseFailure } from "@/lib/db";
import { attachInstanceCookie, getAccountContext } from "@/lib/instance";
import { getProject, type ProjectRow } from "@/lib/pipeline/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID.test(value);
}

export function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return noStore(NextResponse.json({ error, ...extra }, { status }));
}

export function ok(body: unknown, status = 200) {
  return noStore(NextResponse.json(body, { status }));
}

export type Account = Awaited<ReturnType<typeof getAccountContext>>;

/** Adds the instance cookie when the request minted a new instance id. */
export function withCookie(response: NextResponse, request: Request, account: Account) {
  if (account.isNew) attachInstanceCookie(response, request, account.id);
  return response;
}

export async function readJson<T>(request: Request, maxBytes: number): Promise<
  { ok: true; value: T } | { ok: false; response: NextResponse }
> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return { ok: false, response: fail(413, "too_large") };

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return { ok: false, response: fail(400, "invalid_json") };
  }

  // A bare JSON string or array parses fine but is not a request body. Without
  // this, every field reads as undefined and the route proceeds on defaults.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, response: fail(400, "invalid_body") };
  }

  return { ok: true, value: parsed as T };
}

export type ProjectContext = { account: Account; project: ProjectRow };

/**
 * Resolves and authorises a project in one step. A project belonging to another
 * instance is reported as 404, not 403, so the API does not confirm that an id
 * exists for someone else.
 */
export async function requireProject(
  projectId: string,
): Promise<{ ok: true; context: ProjectContext } | { ok: false; response: NextResponse }> {
  if (!isUuid(projectId)) return { ok: false, response: fail(404, "not_found") };

  const account = await getAccountContext();
  try {
    const project = await getProject(account.id, projectId);
    if (!project) return { ok: false, response: fail(404, "not_found") };
    return { ok: true, context: { account, project } };
  } catch {
    logDatabaseFailure("load project");
    return { ok: false, response: fail(503, "database_unavailable") };
  }
}

/** Maps a thrown pipeline error onto the project's error vocabulary. */
export function pipelineFailure(error: unknown) {
  const kind = (error as { kind?: string } | null)?.kind;
  switch (kind) {
    case "not_configured":
      return fail(503, "ai_not_configured");
    case "timeout":
      return fail(504, "ai_timeout");
    case "bad_output":
      return fail(502, "ai_bad_output");
    case "upstream":
      return fail(502, "ai_upstream");
    case "grounding_unavailable":
      return fail(502, "ai_grounding_unavailable");
    default:
      return fail(500, "internal");
  }
}

export { logDatabaseFailure };

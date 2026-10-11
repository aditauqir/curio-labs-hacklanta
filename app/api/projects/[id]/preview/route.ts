import { logDatabaseFailure } from "@/lib/db";
import { parseDesignDocument } from "@/lib/pipeline/document";
import { renderDocumentToSvg } from "@/lib/pipeline/render";
import { getLatestVersion, getVersion } from "@/lib/pipeline/store";
import { fail, requireProject } from "@/lib/pipeline/http";
import { num } from "@/lib/pipeline/validate";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * Renders a version to SVG.
 *
 * ?width=  output width in pixels (height follows the canvas aspect ratio)
 * ?version= a specific version, default latest
 * ?transparent=1 omits the background, for compositing
 *
 * Served as image/svg+xml with a restrictive CSP. The document contains
 * user- and model-authored text, so even though the renderer escapes
 * everything, the response is also told not to execute anything.
 */
export async function GET(request: Request, { params }: RouteProps) {
  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;
  const { project } = resolved.context;

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("version"));
  const width = num(Number(url.searchParams.get("width")), 64, 4096);
  const transparent = url.searchParams.get("transparent") === "1";

  let row;
  try {
    row = Number.isInteger(requested) && requested > 0
      ? await getVersion(project.id, requested)
      : await getLatestVersion(project.id);
  } catch {
    logDatabaseFailure("load version for preview");
    return fail(503, "database_unavailable");
  }

  if (!row) return fail(404, "no_design");

  const validated = parseDesignDocument(row.document);
  if (!validated.ok) return fail(500, "stored_document_invalid", { issues: validated.issues });

  const render = renderDocumentToSvg(validated.value, {
    width: width ?? undefined,
    transparent,
  });

  return new Response(render.svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "X-Curio-Version": String(row.version),
      "X-Curio-Render-Warnings": String(render.warnings.length + render.unsupported.length),
    },
  });
}

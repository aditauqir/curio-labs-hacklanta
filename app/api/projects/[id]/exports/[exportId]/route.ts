import { logDatabaseFailure } from "@/lib/db";
import { getExport } from "@/lib/pipeline/store";
import { fail, isUuid, requireProject } from "@/lib/pipeline/http";

type RouteProps = { params: Promise<{ id: string; exportId: string }> };

/** Downloads a stored export. Access is scoped to the owning project. */
export async function GET(_request: Request, { params }: RouteProps) {
  const { id, exportId } = await params;
  if (!isUuid(exportId)) return fail(404, "not_found");

  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;

  try {
    const record = await getExport(resolved.context.project.id, exportId);
    if (!record) return fail(404, "not_found");

    // Copy into a fresh view: a pooled Node Buffer cannot be handed to the
    // web Response directly. Same idiom as app/api/files/[id]/route.ts.
    const body = new Uint8Array(record.data.byteLength);
    body.set(record.data);

    return new Response(body.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": record.contentType,
        "Content-Length": String(record.sizeBytes),
        "Cache-Control": "private, no-store",
        // SVG is served as an attachment and sandboxed: it is a document
        // format that can carry script, and it contains untrusted text.
        "Content-Disposition": `attachment; filename="curio-${record.id}.${record.format}"`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    logDatabaseFailure("download export");
    return fail(503, "database_unavailable");
  }
}

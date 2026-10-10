import { NextResponse } from "next/server";
import { logDatabaseFailure } from "@/lib/db";
import { getAccountContext, isInstanceId } from "@/lib/instance";
import { deleteFile, getFile } from "@/lib/instance-store";

type RouteProps = { params: Promise<{ id: string }> };

function validFileId(value: string) {
  return isInstanceId(value);
}

export async function GET(request: Request, { params }: RouteProps) {
  const { id } = await params;
  if (!validFileId(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const instance = await getAccountContext();

  try {
    const file = await getFile(instance.id, id);
    if (!file?.data) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const body = new Uint8Array(file.data.byteLength);
    body.set(file.data);
    return new Response(body.buffer, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": file.contentType,
        "Content-Length": String(file.sizeBytes),
        "Content-Disposition": `attachment; filename="${file.filename.replaceAll('"', "_")}"`,
      },
    });
  } catch {
    logDatabaseFailure("read file");
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}

export async function DELETE(request: Request, { params }: RouteProps) {
  const { id } = await params;
  if (!validFileId(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const instance = await getAccountContext();
  try {
    await deleteFile(instance.id, id);
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    if (instance.isNew) response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    logDatabaseFailure("delete file");
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}

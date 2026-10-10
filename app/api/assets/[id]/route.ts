import { NextResponse } from "next/server";
import { logDatabaseFailure } from "@/lib/db";
import { getAccountContext } from "@/lib/instance";
import { getLibraryAsset } from "@/lib/library";

type RouteProps = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteProps) {
  const { id } = await params;
  if (!/^[-a-zA-Z0-9:_]+$/.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const instance = await getAccountContext();
    const asset = await getLibraryAsset(id, instance.id);
    if (!asset) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!asset.data) return NextResponse.json({ asset }, { headers: { "Cache-Control": "no-store" } });

    const body = new Uint8Array(asset.data.byteLength);
    body.set(asset.data);
    return new Response(body.buffer, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": asset.contentType ?? "application/octet-stream",
        "Content-Length": String(asset.sizeBytes ?? body.byteLength),
        "Content-Disposition": `inline; filename="${asset.name.replaceAll('"', "_")}"`,
      },
    });
  } catch {
    logDatabaseFailure("read library asset");
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}

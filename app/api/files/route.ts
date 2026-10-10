import { NextResponse } from "next/server";
import { logDatabaseFailure } from "@/lib/db";
import { attachInstanceCookie, getAccountContext } from "@/lib/instance";
import { createFile, listFiles } from "@/lib/instance-store";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function safeFilename(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._ -]/g, "_").trim().slice(0, 160);
  return cleaned || "untitled-file";
}

export async function GET(request: Request) {
  const instance = await getAccountContext();
  try {
    const response = NextResponse.json(
      { files: await listFiles(instance.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
    if (instance.isNew) attachInstanceCookie(response, request, instance.id);
    return response;
  } catch {
    logDatabaseFailure("list files");
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const instance = await getAccountContext();
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_FILE_BYTES + 8 * 1024) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "missing_file" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "empty_file" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  try {
    const stored = await createFile(instance.id, {
      filename: safeFilename(file.name),
      contentType: file.type || "application/octet-stream",
      data: Buffer.from(await file.arrayBuffer()),
    });
    const response = NextResponse.json({ file: stored }, { status: 201, headers: { "Cache-Control": "no-store" } });
    if (instance.isNew) attachInstanceCookie(response, request, instance.id);
    return response;
  } catch {
    logDatabaseFailure("save file");
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}

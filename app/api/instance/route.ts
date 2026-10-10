import { NextResponse } from "next/server";
import { logDatabaseFailure } from "@/lib/db";
import { attachInstanceCookie, getInstanceContext } from "@/lib/instance";
import { getProfile, makePasswordHash, updateProfile } from "@/lib/instance-store";

const MAX_BODY_BYTES = 8 * 1024;

function responseWithProfile(request: Request, instanceId: string, isNew: boolean, profile: unknown) {
  const response = NextResponse.json({ instanceId, profile }, { headers: { "Cache-Control": "no-store" } });
  if (isNew) attachInstanceCookie(response, request, instanceId);
  return response;
}

export async function GET(request: Request) {
  const instance = await getInstanceContext();
  try {
    return responseWithProfile(request, instance.id, instance.isNew, await getProfile(instance.id));
  } catch {
    logDatabaseFailure("load profile");
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const instance = await getInstanceContext();
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  let payload: { username?: unknown; password?: unknown };
  try {
    payload = (await request.json()) as { username?: unknown; password?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!("username" in payload) && !("password" in payload)) {
    return NextResponse.json({ error: "no_changes" }, { status: 400 });
  }

  const values: { username?: string | null; passwordHash?: string | null } = {};
  if ("username" in payload) {
    if (payload.username !== null && typeof payload.username !== "string") {
      return NextResponse.json({ error: "invalid_username" }, { status: 400 });
    }
    const username = typeof payload.username === "string" ? payload.username.trim() : null;
    if (username && (username.length < 2 || username.length > 80)) {
      return NextResponse.json({ error: "invalid_username" }, { status: 400 });
    }
    values.username = username || null;
  }

  if ("password" in payload) {
    if (payload.password === null) {
      values.passwordHash = null;
    } else if (typeof payload.password !== "string" || payload.password.length < 8 || payload.password.length > 200) {
      return NextResponse.json({ error: "invalid_password" }, { status: 400 });
    } else {
      values.passwordHash = await makePasswordHash(payload.password);
    }
  }

  try {
    return responseWithProfile(request, instance.id, instance.isNew, await updateProfile(instance.id, values));
  } catch {
    logDatabaseFailure("save profile");
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}

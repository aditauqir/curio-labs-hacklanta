import { NextResponse } from "next/server";
import { attachAuthCookie, clearAuthCookie, createAuthSession, getAuthSession, revokeAuthSession } from "@/lib/auth";
import { logDatabaseFailure } from "@/lib/db";
import { attachInstanceCookie, ensureInstance, getInstanceContext } from "@/lib/instance";
import { getDatabase } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

const MAX_BODY_BYTES = 8 * 1024;

function profile(instanceId: string, username: string) {
  return { instanceId, profile: { username, hasPassword: true }, authenticated: true };
}

function validCredentials(username: unknown, password: unknown) {
  return (
    typeof username === "string" && username.trim().length >= 2 && username.trim().length <= 80 &&
    typeof password === "string" && password.length >= 8 && password.length <= 200
  );
}

export async function GET() {
  try {
    const session = await getAuthSession();
    if (!session) return NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(profile(session.instanceId, session.username), { headers: { "Cache-Control": "no-store" } });
  } catch {
    logDatabaseFailure("load auth session");
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  let payload: { mode?: unknown; username?: unknown; password?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const mode = payload.mode === "register" || payload.mode === "login" ? payload.mode : null;
  const username = typeof payload.username === "string" ? payload.username.trim() : "";
  if (!mode || !validCredentials(username, payload.password)) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 400 });
  }

  try {
    const sql = await getDatabase();
    const anonymous = await getInstanceContext();
    let instanceId = anonymous.id;

    if (mode === "register") {
      const passwordHash = await hashPassword(payload.password as string);
      await ensureInstance(sql, anonymous.id);
      const existing = await sql<{ id: string }[]>`
        SELECT id FROM curio_instances WHERE LOWER(username) = LOWER(${username})
      `;
      if (existing.length > 0) return NextResponse.json({ error: "username_taken" }, { status: 409 });
      await sql`
        UPDATE curio_instances
        SET username = ${username}, password_hash = ${passwordHash}, updated_at = NOW()
        WHERE id = ${anonymous.id}::uuid
      `;
    } else {
      const rows = await sql<{ id: string; username: string; password_hash: string | null }[]>`
        SELECT id, username, password_hash
        FROM curio_instances
        WHERE LOWER(username) = LOWER(${username})
      `;
      const account = rows[0];
      if (!account?.password_hash || !(await verifyPassword(payload.password as string, account.password_hash))) {
        return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
      }
      instanceId = account.id;
    }

    const token = await createAuthSession(instanceId);
    const response = NextResponse.json(profile(instanceId, username), { headers: { "Cache-Control": "no-store" } });
    attachAuthCookie(response, request, token);
    attachInstanceCookie(response, request, instanceId);
    return response;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "username_taken" }, { status: 409 });
    }
    logDatabaseFailure("save auth session");
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    await revokeAuthSession();
    const response = NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
    clearAuthCookie(response, request);
    return response;
  } catch {
    logDatabaseFailure("revoke auth session");
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}

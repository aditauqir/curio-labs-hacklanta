// Server-only account sessions. Passwords remain in curio_instances as hashes;
// the browser receives only a random, expiring session token.
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getDatabase } from "./db";

export const SESSION_COOKIE = "curio_session";
const SESSION_DAYS = 30;

export type AuthSession = {
  instanceId: string;
  username: string;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const secure = forwardedProto === "https" || new URL(request.url).protocol === "https:";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

export async function getAuthSession(): Promise<AuthSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const sql = await getDatabase();
  const rows = await sql<{ instanceId: string; username: string }[]>`
    SELECT s.instance_id AS "instanceId", i.username
    FROM curio_sessions s
    JOIN curio_instances i ON i.id = s.instance_id
    WHERE s.token_hash = ${hashToken(token)}
      AND s.expires_at > NOW()
      AND i.username IS NOT NULL
  `;
  return rows[0] ?? null;
}

export async function createAuthSession(instanceId: string) {
  const token = randomBytes(32).toString("base64url");
  const sql = await getDatabase();
  await sql`DELETE FROM curio_sessions WHERE expires_at <= NOW()`;
  await sql`
    INSERT INTO curio_sessions (token_hash, instance_id, expires_at)
    VALUES (${hashToken(token)}, ${instanceId}::uuid, NOW() + ${SESSION_DAYS} * INTERVAL '1 day')
  `;
  return token;
}

export async function revokeAuthSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return;
  const sql = await getDatabase();
  await sql`DELETE FROM curio_sessions WHERE token_hash = ${hashToken(token)}`;
}

export function attachAuthCookie(response: NextResponse, request: Request, token: string) {
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(request));
}

export function clearAuthCookie(response: NextResponse, request: Request) {
  response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(request), maxAge: 0 });
}

// Server-only persistence operations for an anonymous Curio instance.
import { randomUUID } from "node:crypto";
import { getDatabase } from "./db";
import { ensureInstance } from "./instance";
import { hashPassword } from "./password";
import { sanitizeState, type StudioState } from "./design-state";

type WorkspaceRow = {
  design: unknown;
  selected_palette_id: string | null;
  poster_edits: unknown;
  updated_at: Date | string;
};

type MessageRow = {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  source: "example" | "demo" | "gemini" | null;
  suggestions: unknown;
  changes: unknown;
  skipped: unknown;
  notice: string | null;
  asset_suggestions: unknown;
};

export type InstanceProfile = {
  username: string | null;
  hasPassword: boolean;
};

export type StoredFile = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  data?: Buffer;
};

function toMessage(row: MessageRow) {
  return {
    id: row.message_id,
    role: row.role,
    content: row.content,
    source: row.source ?? undefined,
    suggestions: Array.isArray(row.suggestions) ? row.suggestions : undefined,
    changes: Array.isArray(row.changes) ? row.changes : undefined,
    skipped: Array.isArray(row.skipped) ? row.skipped : undefined,
    notice: row.notice ?? undefined,
    assetSuggestions: Array.isArray(row.asset_suggestions) ? row.asset_suggestions : undefined,
  };
}

export async function loadWorkspace(instanceId: string): Promise<{ state: StudioState | null; updatedAt: string | null }> {
  const sql = await getDatabase();
  await ensureInstance(sql, instanceId);

  const workspace = await sql<WorkspaceRow[]>`
    SELECT design, selected_palette_id, poster_edits
           , updated_at
    FROM curio_workspaces
    WHERE instance_id = ${instanceId}::uuid
  `;
  if (workspace.length === 0) return { state: null, updatedAt: null };

  const messages = await sql<MessageRow[]>`
    SELECT message_id, role, content, source, suggestions, changes, skipped, notice, asset_suggestions
    FROM curio_chat_messages
    WHERE instance_id = ${instanceId}::uuid
    ORDER BY created_at ASC
    LIMIT 60
  `;

  const state = sanitizeState({
      design: workspace[0].design,
      messages: messages.map(toMessage),
      selectedPaletteId: workspace[0].selected_palette_id,
      posterEdits: workspace[0].poster_edits,
    });
  return {
    state,
    updatedAt: new Date(workspace[0].updated_at).toISOString(),
  };
}

export async function saveWorkspace(instanceId: string, state: StudioState) {
  const sql = await getDatabase();
  const updatedAt = await sql.begin(async (tx) => {
    await ensureInstance(tx, instanceId);
    const rows = await tx<{ updated_at: Date | string }[]>`
      INSERT INTO curio_workspaces (instance_id, design, selected_palette_id, poster_edits, updated_at)
      VALUES (${instanceId}::uuid, ${tx.json(state.design)}, ${state.selectedPaletteId}, ${tx.json(state.posterEdits)}, NOW())
      ON CONFLICT (instance_id) DO UPDATE SET
        design = EXCLUDED.design,
        selected_palette_id = EXCLUDED.selected_palette_id,
        poster_edits = EXCLUDED.poster_edits,
        updated_at = NOW()
      RETURNING updated_at
    `;

    await tx`DELETE FROM curio_chat_messages WHERE instance_id = ${instanceId}::uuid`;
    for (const message of state.messages) {
      await tx`
        INSERT INTO curio_chat_messages
          (instance_id, message_id, role, content, source, suggestions, changes, skipped, notice, asset_suggestions)
        VALUES (
          ${instanceId}::uuid,
          ${message.id},
          ${message.role},
          ${message.content},
          ${message.source ?? null},
          ${message.suggestions ? tx.json(message.suggestions) : null},
          ${message.changes ? tx.json(message.changes) : null},
          ${message.skipped ? tx.json(message.skipped) : null},
          ${message.notice ?? null},
          ${message.assetSuggestions ? tx.json(message.assetSuggestions) : null}
        )
      `;
    }
    return rows[0]?.updated_at ?? new Date();
  });
  return new Date(updatedAt).toISOString();
}

export async function getProfile(instanceId: string): Promise<InstanceProfile> {
  const sql = await getDatabase();
  await ensureInstance(sql, instanceId);
  const rows = await sql<{ username: string | null; has_password: boolean }[]>`
    SELECT username, password_hash IS NOT NULL AS has_password
    FROM curio_instances
    WHERE id = ${instanceId}::uuid
  `;
  return {
    username: rows[0]?.username ?? null,
    hasPassword: rows[0]?.has_password === true,
  };
}

export async function updateProfile(
  instanceId: string,
  values: { username?: string | null; passwordHash?: string | null },
) {
  const sql = await getDatabase();
  await ensureInstance(sql, instanceId);
  if (values.username !== undefined) {
    await sql`
      UPDATE curio_instances
      SET username = ${values.username}, updated_at = NOW()
      WHERE id = ${instanceId}::uuid
    `;
  }
  if (values.passwordHash !== undefined) {
    await sql`
      UPDATE curio_instances
      SET password_hash = ${values.passwordHash}, updated_at = NOW()
      WHERE id = ${instanceId}::uuid
    `;
  }
  return getProfile(instanceId);
}

export async function createFile(
  instanceId: string,
  file: { filename: string; contentType: string; data: Buffer },
): Promise<StoredFile> {
  const sql = await getDatabase();
  await ensureInstance(sql, instanceId);
  const id = randomUUID();
  const rows = await sql<StoredFile[]>`
    INSERT INTO curio_files (id, instance_id, filename, content_type, size_bytes, data)
    VALUES (${id}::uuid, ${instanceId}::uuid, ${file.filename}, ${file.contentType}, ${file.data.length}, ${file.data})
    RETURNING id, filename, content_type AS "contentType", size_bytes AS "sizeBytes", created_at AS "createdAt"
  `;
  return rows[0];
}

export async function listFiles(instanceId: string): Promise<StoredFile[]> {
  const sql = await getDatabase();
  await ensureInstance(sql, instanceId);
  return sql<StoredFile[]>`
    SELECT id, filename, content_type AS "contentType", size_bytes AS "sizeBytes", created_at AS "createdAt"
    FROM curio_files
    WHERE instance_id = ${instanceId}::uuid
    ORDER BY created_at DESC
  `;
}

export async function getFile(instanceId: string, fileId: string): Promise<StoredFile | null> {
  const sql = await getDatabase();
  await ensureInstance(sql, instanceId);
  const rows = await sql<StoredFile[]>`
    SELECT id, filename, content_type AS "contentType", size_bytes AS "sizeBytes", created_at AS "createdAt", data
    FROM curio_files
    WHERE id = ${fileId}::uuid AND instance_id = ${instanceId}::uuid
  `;
  return rows[0] ?? null;
}

export async function deleteFile(instanceId: string, fileId: string) {
  const sql = await getDatabase();
  await ensureInstance(sql, instanceId);
  await sql`
    DELETE FROM curio_files
    WHERE id = ${fileId}::uuid AND instance_id = ${instanceId}::uuid
  `;
}

export async function makePasswordHash(password: string) {
  return hashPassword(password);
}

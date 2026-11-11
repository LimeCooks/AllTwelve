import { getDatabase } from '@/db/client';
import { requestIdentity } from '@/lib/request-identity';
import { WorkspaceAccessError } from '@/lib/workspace-identity';
import {
  parseConversations,
  parseLegacyConversations,
  type Conversations,
} from '@/lib/conversations';

const KEY = 'private-conversations-v3';
type Row = { value_json: string };
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof WorkspaceAccessError
          ? error.message
          : 'Unable to access saved conversations. Your draft has not been changed. Please retry.',
    },
    { status: error instanceof WorkspaceAccessError ? error.status : 500 },
  );
}
export async function GET() {
  try {
    const db = await getDatabase();
    const [current, older] = await Promise.all(
      [KEY, 'message-centre-v2'].map((key) =>
        db
          .prepare(
            'SELECT value_json FROM workspace_state WHERE team_id = ? AND state_key = ?',
          )
          .bind(db.teamId, key)
          .first<Row>(),
      ),
    );
    const state = current
      ? parseConversations(JSON.parse(current.value_json))
      : { threads: [] };
    let legacy: ReturnType<typeof parseLegacyConversations> = [],
      legacyError = '';
    if (older)
      try {
        legacy = parseLegacyConversations(JSON.parse(older.value_json));
      } catch {
        legacyError =
          'Earlier conversations could not be read. Their saved data is unchanged.';
      }
    return Response.json(
      { ...state, legacy, legacyError },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const db = await getDatabase(),
      identity = await requestIdentity();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: 'Enter valid conversation details.' },
        { status: 400 },
      );
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return Response.json(
        { error: 'Enter valid conversation details.' },
        { status: 400 },
      );
    const id = typeof body.id === 'string' ? body.id.trim() : '',
      threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '',
      text = typeof body.text === 'string' ? body.text.trim() : '',
      name = typeof body.name === 'string' ? body.name.trim() : '';
    if (
      !id ||
      id.length > 100 ||
      !['create', 'message'].includes(String(body.action)) ||
      (body.action === 'create' && (!name || name.length > 100)) ||
      (body.action === 'message' &&
        (!threadId || threadId.length > 100 || !text || text.length > 4000))
    )
      return Response.json(
        {
          error:
            'Choose a conversation name up to 100 characters or a message up to 4,000 characters.',
        },
        { status: 400 },
      );
    const at = new Date().toISOString();
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await db
        .prepare(
          'SELECT value_json FROM workspace_state WHERE team_id = ? AND state_key = ?',
        )
        .bind(db.teamId, KEY)
        .first<Row>();
      const state: Conversations = row
        ? parseConversations(JSON.parse(row.value_json))
        : { threads: [] };
      if (body.action === 'create') {
        const existing = state.threads.find((thread) => thread.id === id);
        if (existing) {
          if (existing.name !== name)
            return Response.json(
              {
                error:
                  'That conversation request already has different details.',
              },
              { status: 409 },
            );
          return Response.json(state);
        }
        if (
          state.threads.some(
            (thread) => thread.name.toLowerCase() === name.toLowerCase(),
          )
        )
          return Response.json(
            { error: 'A conversation with that name already exists.' },
            { status: 409 },
          );
        if (state.threads.length >= 100)
          return Response.json(
            { error: 'The workspace has reached its 100-conversation limit.' },
            { status: 413 },
          );
        state.threads.push({ id, name, createdAt: at, messages: [] });
      } else {
        const thread = state.threads.find((thread) => thread.id === threadId);
        if (!thread)
          return Response.json(
            {
              error:
                'Conversation not found. Reload to choose an existing conversation.',
            },
            { status: 404 },
          );
        const existing = state.threads
          .flatMap((thread) => thread.messages)
          .find((message) => message.id === id);
        if (existing) {
          if (
            !thread.messages.includes(existing) ||
            existing.text !== text ||
            existing.authorId !== identity.id
          )
            return Response.json(
              { error: 'That message request already has different details.' },
              { status: 409 },
            );
          return Response.json(state);
        }
        if (thread.messages.length >= 2000)
          return Response.json(
            {
              error:
                'This conversation has reached its message limit. Create another conversation.',
            },
            { status: 413 },
          );
        thread.messages.push({
          id,
          authorId: identity.id,
          authorName: identity.name.slice(0, 500),
          text,
          createdAt: at,
        });
      }
      const serialized = JSON.stringify(state);
      if (new TextEncoder().encode(serialized).length > 750000)
        return Response.json(
          { error: 'Conversations have reached the workspace storage limit.' },
          { status: 413 },
        );
      const saved = await db
        .prepare(`INSERT INTO workspace_state (id, team_id, state_key, value_json, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(team_id, state_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at WHERE workspace_state.value_json = ? RETURNING value_json`)
        .bind(
          `state-${db.teamId}-${KEY}`,
          db.teamId,
          KEY,
          serialized,
          at,
          row?.value_json ?? null,
        )
        .first<Row>();
      if (saved)
        return Response.json(parseConversations(JSON.parse(saved.value_json)));
    }
    return Response.json(
      {
        error:
          'Conversations changed on another device. Your draft is preserved; retry saving.',
      },
      { status: 409 },
    );
  } catch (error) {
    return failure(error);
  }
}

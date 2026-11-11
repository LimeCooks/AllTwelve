import {
  WorkspaceAccessError,
  type TeamDatabase,
  type WorkspaceIdentity,
} from '@/lib/workspace-identity';
import type { WorkspaceGrant } from '@/lib/team-permissions';
const THREAD = 'team-conversation-v1:';
const MESSAGE = 'team-message-v1:';
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const iso = (value: unknown): value is string =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
type StoredRow = { state_key: string; value_json: string; updated_at: string };
export type TeamConversation = {
  id: string;
  kind: 'channel' | 'direct';
  name: string;
  participants: string[];
  createdBy: string;
  createdAt: string;
  directKey: string | null;
};
export type TeamMessage = {
  id: string;
  conversationId: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
};
export type TeamPerson = {
  id: string;
  name: string;
  role: 'owner' | 'staff' | 'player';
};
export type TeamMessagePayload = {
  sentId?: string;
  conversations: TeamConversation[];
  people: TeamPerson[];
  selected: TeamConversation | null;
  messages: TeamMessage[];
  before: string | null;
};
function actor(
  database: TeamDatabase,
  identity: WorkspaceIdentity,
  grant: WorkspaceGrant,
) {
  if (grant.userId !== identity.id || grant.teamId !== database.teamId)
    throw new WorkspaceAccessError('Team access could not be verified.', 403);
  return identity.id;
}
function active(database: TeamDatabase, userId: string, coaching = false) {
  return {
    sql: `(EXISTS(SELECT 1 FROM workspace_owners WHERE user_id=? AND team_id=?) OR EXISTS(SELECT 1 FROM team_memberships m WHERE m.user_id=? AND m.team_id=? AND m.status='active' AND ${coaching ? "m.role='staff'" : "(m.role='staff' OR (m.role='player' AND EXISTS(SELECT 1 FROM athletes a WHERE a.id=m.athlete_id AND a.team_id=m.team_id)))"}))`,
    args: [userId, database.teamId, userId, database.teamId],
  };
}
function parseThread(row: StoredRow): TeamConversation {
  try {
    const value = JSON.parse(row.value_json) as TeamConversation;
    if (
      !uuid(value.id) ||
      row.state_key !== THREAD + value.id ||
      !['channel', 'direct'].includes(value.kind) ||
      typeof value.name !== 'string' ||
      !value.name.trim() ||
      value.name.length > 80 ||
      !iso(value.createdAt) ||
      typeof value.createdBy !== 'string' ||
      !Array.isArray(value.participants) ||
      value.participants.some((id) => typeof id !== 'string' || !id) ||
      (value.kind === 'channel' &&
        (value.participants.length !== 0 || value.directKey !== null)) ||
      (value.kind === 'direct' &&
        (new Set(value.participants).size !== 2 ||
          value.participants.length !== 2 ||
          value.directKey !== JSON.stringify([...value.participants].sort())))
    )
      throw new Error();
    return value;
  } catch {
    throw new WorkspaceAccessError(
      'A saved conversation could not be read. Your messages have not been replaced.',
      500,
    );
  }
}
function parseMessage(row: StoredRow, conversationId: string): TeamMessage {
  try {
    const value = JSON.parse(row.value_json) as TeamMessage;
    if (
      !uuid(value.id) ||
      row.state_key !== MESSAGE + conversationId + ':' + value.id ||
      value.conversationId !== conversationId ||
      typeof value.authorId !== 'string' ||
      !value.authorId ||
      typeof value.authorName !== 'string' ||
      !value.authorName ||
      typeof value.text !== 'string' ||
      !value.text.trim() ||
      value.text.length > 4000 ||
      !iso(value.createdAt) ||
      value.createdAt !== row.updated_at
    )
      throw new Error();
    return value;
  } catch {
    throw new WorkspaceAccessError(
      'A saved message could not be read. Refresh before continuing.',
      500,
    );
  }
}
async function threadRows(database: TeamDatabase) {
  return (
    await database
      .prepare(
        'SELECT state_key,value_json,updated_at FROM workspace_state WHERE team_id=? AND state_key>=? AND state_key<? ORDER BY updated_at DESC,state_key DESC',
      )
      .bind(database.teamId, THREAD, THREAD + '\uffff')
      .all<StoredRow>()
  ).results;
}
export async function teamPeople(
  database: TeamDatabase,
  identity: WorkspaceIdentity,
): Promise<TeamPerson[]> {
  const [owners, members] = await Promise.all([
    database
      .prepare('SELECT user_id FROM workspace_owners WHERE team_id=?')
      .bind(database.teamId)
      .all<{ user_id: string }>(),
    database
      .prepare(
        "SELECT m.user_id,m.name,m.role FROM team_memberships m WHERE m.team_id=? AND m.status='active' AND (m.role='staff' OR (m.role='player' AND EXISTS(SELECT 1 FROM athletes a WHERE a.id=m.athlete_id AND a.team_id=m.team_id)))",
      )
      .bind(database.teamId)
      .all<{ user_id: string; name: string; role: 'staff' | 'player' }>(),
  ]);
  const people = new Map<string, TeamPerson>();
  for (const row of owners.results)
    people.set(row.user_id, {
      id: row.user_id,
      name: row.user_id === identity.id ? identity.name : 'Team owner',
      role: 'owner',
    });
  for (const row of members.results)
    if (!people.has(row.user_id))
      people.set(row.user_id, {
        id: row.user_id,
        name: row.name || 'Team member',
        role: row.role,
      });
  return [...people.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}
export async function teamMessages(
  database: TeamDatabase,
  identity: WorkspaceIdentity,
  grant: WorkspaceGrant,
  conversationId = '',
  before = '',
): Promise<TeamMessagePayload> {
  const userId = actor(database, identity, grant);
  const conversations = (await threadRows(database))
    .map(parseThread)
    .filter(
      (row) => row.kind === 'channel' || row.participants.includes(userId),
    );
  const selected = conversationId
    ? conversations.find((row) => row.id === conversationId)
    : null;
  if (conversationId && !selected)
    throw new WorkspaceAccessError(
      'Conversation not found for your account.',
      404,
    );
  const people = await teamPeople(database, identity);
  if (!selected)
    return {
      conversations,
      people,
      selected: null,
      messages: [],
      before: null,
    };
  const prefix = MESSAGE + selected.id + ':';
  let cursor: { at: string; key: string } | null = null;
  if (before)
    try {
      cursor = JSON.parse(atob(before));
      if (
        !cursor ||
        !iso(cursor.at) ||
        !cursor.key.startsWith(prefix) ||
        !uuid(cursor.key.slice(prefix.length))
      )
        throw new Error();
    } catch {
      throw new WorkspaceAccessError(
        'Refresh this conversation before loading earlier messages.',
        400,
      );
    }
  const rows = (
    await database
      .prepare(
        `SELECT state_key,value_json,updated_at FROM workspace_state WHERE team_id=? AND state_key>=? AND state_key<? ${cursor ? 'AND (updated_at<? OR (updated_at=? AND state_key<?))' : ''} ORDER BY updated_at DESC,state_key DESC LIMIT 51`,
      )
      .bind(
        database.teamId,
        prefix,
        prefix + '\uffff',
        ...(cursor ? [cursor.at, cursor.at, cursor.key] : []),
      )
      .all<StoredRow>()
  ).results;
  const page = rows.slice(0, 50),
    oldest = page.at(-1);
  return {
    conversations,
    people,
    selected,
    messages: page.map((row) => parseMessage(row, selected.id)).reverse(),
    before:
      rows.length > 50 && oldest
        ? btoa(JSON.stringify({ at: oldest.updated_at, key: oldest.state_key }))
        : null,
  };
}
export async function writeTeamMessage(
  database: TeamDatabase,
  identity: WorkspaceIdentity,
  grant: WorkspaceGrant,
  raw: unknown,
) {
  const userId = actor(database, identity, grant),
    body = raw as Record<string, unknown> | null;
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    !uuid(body.id) ||
    'authorId' in body ||
    'authorName' in body
  )
    throw new WorkspaceAccessError(
      'Use a valid new conversation or message request.',
      400,
    );
  const now = new Date().toISOString();
  if (body.action === 'create') {
    const kind = body.kind;
    if (kind !== 'channel' && kind !== 'direct')
      throw new WorkspaceAccessError(
        'Choose a channel or direct conversation.',
        400,
      );
    if (kind === 'channel' && grant.role === 'player')
      throw new WorkspaceAccessError('A coach must create team channels.', 403);
    const people = await teamPeople(database, identity);
    const peer =
      kind === 'direct'
        ? people.find(
            (person) => person.id === body.recipientId && person.id !== userId,
          )
        : null;
    if (kind === 'direct' && !peer)
      throw new WorkspaceAccessError(
        'Choose another active member of this team.',
        400,
      );
    const name =
      kind === 'channel' && typeof body.name === 'string'
        ? body.name.trim()
        : 'Direct conversation';
    if (!name || name.length > 80)
      throw new WorkspaceAccessError(
        'Enter a conversation name of 1–80 characters.',
        400,
      );
    const participants = kind === 'direct' ? [userId, peer!.id].sort() : [];
    const directKey = kind === 'direct' ? JSON.stringify(participants) : null;
    const existingRows = await threadRows(database);
    const existing = existingRows
      .map(parseThread)
      .find(
        (row) =>
          row.id === body.id || (directKey && row.directKey === directKey),
      );
    if (existing) {
      if (
        existing.kind !== kind ||
        (kind === 'channel' &&
          (existing.createdBy !== userId || existing.name !== name)) ||
        (kind === 'direct' && existing.directKey !== directKey)
      )
        throw new WorkspaceAccessError(
          'That request ID already belongs to another conversation.',
          409,
        );
      return teamMessages(database, identity, grant, existing.id);
    }
    const value: TeamConversation = {
      id: body.id,
      kind,
      name,
      participants,
      directKey,
      createdBy: userId,
      createdAt: now,
    };
    const access = active(database, userId, kind === 'channel'),
      other = peer ? active(database, peer.id) : null;
    await database
      .prepare(
        `INSERT INTO workspace_state(id,team_id,state_key,value_json,updated_at) SELECT lower(hex(randomblob(16))),?,?,?,? WHERE ${access.sql} ${other ? 'AND ' + other.sql : ''} ${directKey ? "AND NOT EXISTS(SELECT 1 FROM workspace_state WHERE team_id=? AND state_key>=? AND state_key<? AND json_valid(value_json) AND json_extract(value_json,'$.directKey')=?)" : ''} ON CONFLICT(team_id,state_key) DO NOTHING`,
      )
      .bind(
        database.teamId,
        THREAD + body.id,
        JSON.stringify(value),
        now,
        ...access.args,
        ...(other ? other.args : []),
        ...(directKey
          ? [database.teamId, THREAD, THREAD + '\uffff', directKey]
          : []),
      )
      .run();
    const saved = (await threadRows(database))
      .map(parseThread)
      .find(
        (row) =>
          row.id === body.id || (directKey && row.directKey === directKey),
      );
    if (!saved)
      throw new WorkspaceAccessError(
        'Team membership changed before the conversation was created. Refresh access.',
        409,
      );
    if (
      saved.kind !== kind ||
      (kind === 'channel' &&
        (saved.createdBy !== userId || saved.name !== name)) ||
      (kind === 'direct' && saved.directKey !== directKey)
    )
      throw new WorkspaceAccessError(
        'That request ID already belongs to another conversation.',
        409,
      );
    return teamMessages(database, identity, grant, saved.id);
  }
  if (
    body.action !== 'send' ||
    !uuid(body.conversationId) ||
    typeof body.text !== 'string' ||
    !body.text.trim() ||
    body.text.trim().length > 4000
  )
    throw new WorkspaceAccessError(
      'Choose a conversation and enter a message of 1–4,000 characters.',
      400,
    );
  const threadRow = await database
    .prepare(
      'SELECT state_key,value_json,updated_at FROM workspace_state WHERE team_id=? AND state_key=?',
    )
    .bind(database.teamId, THREAD + body.conversationId)
    .first<StoredRow>();
  const thread = threadRow ? parseThread(threadRow) : null;
  if (
    !thread ||
    (thread.kind === 'direct' && !thread.participants.includes(userId))
  )
    throw new WorkspaceAccessError(
      'Conversation not found for your account.',
      404,
    );
  const text = body.text.trim(),
    messageKey = MESSAGE + thread.id + ':' + body.id;
  const prior = await database
    .prepare(
      'SELECT state_key,value_json,updated_at FROM workspace_state WHERE team_id=? AND state_key=?',
    )
    .bind(database.teamId, messageKey)
    .first<StoredRow>();
  if (prior) {
    const saved = parseMessage(prior, thread.id);
    if (saved.authorId !== userId || saved.text !== text)
      throw new WorkspaceAccessError(
        'That message request was already used. Refresh before retrying.',
        409,
      );
    return {
      ...(await teamMessages(database, identity, grant, thread.id)),
      sentId: body.id,
    };
  }
  const value: TeamMessage = {
    id: body.id,
    conversationId: thread.id,
    authorId: userId,
    authorName: identity.name || 'Team member',
    text,
    createdAt: now,
  };
  const access = active(database, userId),
    peerId =
      thread.kind === 'direct'
        ? thread.participants.find((id) => id !== userId)
        : null,
    other = peerId ? active(database, peerId) : null;
  await database
    .prepare(
      `INSERT INTO workspace_state(id,team_id,state_key,value_json,updated_at) SELECT lower(hex(randomblob(16))),?,?,?,? WHERE ${access.sql} ${other ? 'AND ' + other.sql : ''} AND EXISTS(SELECT 1 FROM workspace_state WHERE team_id=? AND state_key=? AND value_json=?) ON CONFLICT(team_id,state_key) DO NOTHING`,
    )
    .bind(
      database.teamId,
      messageKey,
      JSON.stringify(value),
      now,
      ...access.args,
      ...(other ? other.args : []),
      database.teamId,
      threadRow!.state_key,
      threadRow!.value_json,
    )
    .run();
  const savedRow = await database
    .prepare(
      'SELECT state_key,value_json,updated_at FROM workspace_state WHERE team_id=? AND state_key=?',
    )
    .bind(database.teamId, messageKey)
    .first<StoredRow>();
  if (!savedRow)
    throw new WorkspaceAccessError(
      'The conversation or a member’s access changed before sending. Your draft has not been discarded.',
      409,
    );
  const saved = parseMessage(savedRow, thread.id);
  if (saved.authorId !== userId || saved.text !== text)
    throw new WorkspaceAccessError(
      'That message request was already used. Refresh before retrying.',
      409,
    );
  return {
    ...(await teamMessages(database, identity, grant, thread.id)),
    sentId: body.id,
  };
}

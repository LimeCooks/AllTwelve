'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceFetch as fetch } from '@/lib/workspace-fetch';
import { useWorkspaceSession } from '@/components/workspace-gate';
import { MessagesWorkspace } from '@/components/messages-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { TeamConversation, TeamMessagePayload } from '@/lib/team-messages';

function payload(raw: unknown, userId: string): TeamMessagePayload {
  const value = raw as TeamMessagePayload | null;
  if (
    !value ||
    !Array.isArray(value.conversations) ||
    !Array.isArray(value.people) ||
    !Array.isArray(value.messages) ||
    value.conversations.some(
      (row) =>
        !row ||
        typeof row.id !== 'string' ||
        !['channel', 'direct'].includes(row.kind) ||
        !Array.isArray(row.participants) ||
        (row.kind === 'direct' && !row.participants.includes(userId)),
    ) ||
    value.messages.some(
      (row) =>
        !row ||
        typeof row.id !== 'string' ||
        typeof row.text !== 'string' ||
        typeof row.authorName !== 'string' ||
        row.conversationId !== value.selected?.id,
    ) ||
    (value.selected &&
      !value.conversations.some((row) => row.id === value.selected?.id)) ||
    (value.before !== null && typeof value.before !== 'string')
  )
    throw new Error(
      'The conversation response was incomplete. Refresh before continuing.',
    );
  return value;
}
export function TeamMessagesWorkspace({
  onEditingChange,
}: {
  onEditingChange: (editing: boolean) => void;
}) {
  const session = useWorkspaceSession();
  const [tab, setTab] = useState<'team' | 'private'>('team'),
    [editing, setEditing] = useState(false);
  const changed = useCallback(
    (dirty: boolean) => {
      setEditing(dirty);
      onEditingChange(dirty);
    },
    [onEditingChange],
  );
  if (session.mode === 'prototype')
    return <MessagesWorkspace onEditingChange={onEditingChange} />;
  return (
    <section className="module-surface team-messages-workspace">
      <header className="module-header">
        <div>
          <span className="eyebrow">Team communication</span>
          <h1>Messages</h1>
          <p>
            Team channels and private conversations between connected members.
          </p>
        </div>
      </header>
      {session.team?.role === 'owner' ? (
        <div className="team-message-tabs">
          <Button
            variant={tab === 'team' ? 'default' : 'outline'}
            disabled={editing && tab !== 'team'}
            onClick={() => setTab('team')}
          >
            Team conversations
          </Button>
          <Button
            variant={tab === 'private' ? 'default' : 'outline'}
            disabled={editing && tab !== 'private'}
            onClick={() => setTab('private')}
          >
            Personal saved notes
          </Button>
        </div>
      ) : null}
      {tab === 'private' ? (
        <MessagesWorkspace onEditingChange={changed} />
      ) : (
        <ConnectedMessages onEditingChange={changed} />
      )}
    </section>
  );
}
function ConnectedMessages({
  onEditingChange,
}: {
  onEditingChange: (editing: boolean) => void;
}) {
  const session = useWorkspaceSession(),
    userId = session.user.id;
  const [data, setData] = useState<TeamMessagePayload | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({}),
    [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<'channel' | 'direct'>(
      session.team?.role === 'player' ? 'direct' : 'channel',
    ),
    [name, setName] = useState(''),
    [recipient, setRecipient] = useState('');
  const requestIds = useRef(new Map<string, string>()),
    createId = useRef(''),
    lock = useRef(false),
    serial = useRef(0);
  const selected = data?.selected ?? null,
    draft = selected ? (drafts[selected.id] ?? '') : '';
  const dirty =
    Object.values(drafts).some((value) => Boolean(value.trim())) ||
    Boolean(name.trim()) ||
    Boolean(recipient);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    onEditingChange(dirty || busy);
    return () => onEditingChange(false);
  }, [dirty, busy, onEditingChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || busy) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  async function load(id = '', earlier = false) {
    if (lock.current) return;
    const sequence = ++serial.current;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const params = new URLSearchParams();
      if (id) params.set('conversationId', id);
      if (earlier && data?.before) params.set('before', data.before);
      const response = await fetch('/api/team-messages?' + params, {
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
      });
      const raw = (await response.json()) as { error?: string };
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setData(null);
        throw new Error(raw.error || 'Conversations could not be loaded.');
      }
      const next = payload(raw, userId);
      if (sequence !== serial.current) return;
      if (id && next.selected?.id !== id)
        throw new Error('The selected conversation could not be verified.');
      setData((previous) =>
        earlier && previous?.selected?.id === id
          ? {
              ...next,
              messages: [
                ...new Map(
                  [...next.messages, ...previous.messages].map((message) => [
                    message.id,
                    message,
                  ]),
                ).values(),
              ],
            }
          : next,
      );
      setFailed(false);
    } catch (cause) {
      if (sequence === serial.current) {
        setFailed(true);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Conversations could not be loaded.',
        );
      }
    } finally {
      if (sequence === serial.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      serial.current++;
    };
  }, []);
  function title(thread: TeamConversation) {
    return thread.kind === 'channel'
      ? thread.name
      : (data?.people.find(
          (person) =>
            person.id === thread.participants.find((id) => id !== userId),
        )?.name ?? 'Former team member');
  }
  async function send(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || lock.current || !draft.trim() || failed) return;
    const target = selected.id,
      text = draft.trim();
    let id = requestIds.current.get(target);
    if (!id) {
      id = crypto.randomUUID();
      requestIds.current.set(target, id);
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    ++serial.current;
    try {
      const response = await fetch('/api/team-messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          id,
          conversationId: target,
          text,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const raw = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(
          raw.error ||
            'Sending could not be confirmed. Refresh and retry this draft.',
        );
      const next = payload(raw, userId);
      if (next.sentId !== id || next.selected?.id !== target)
        throw new Error(
          'The saved message could not be confirmed. Refresh before retrying.',
        );
      setData(next);
      setDrafts((current) => ({ ...current, [target]: '' }));
      requestIds.current.delete(target);
      setNotice('Message saved in this conversation.');
      setFailed(false);
    } catch (cause) {
      setFailed(true);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Sending could not be confirmed. Your draft is retained.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
      setLoading(false);
    }
  }
  async function create(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    createId.current ||= crypto.randomUUID();
    ++serial.current;
    try {
      const response = await fetch('/api/team-messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          id: createId.current,
          kind,
          name,
          recipientId: recipient,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const raw = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(raw.error || 'Conversation could not be created.');
      const next = payload(raw, userId);
      if (!next.selected || next.selected.kind !== kind)
        throw new Error(
          'The new conversation could not be confirmed. Refresh before retrying.',
        );
      setData(next);
      setCreating(false);
      setName('');
      setRecipient('');
      createId.current = '';
      setFailed(false);
      setNotice('Conversation ready.');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Conversation could not be created.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
      setLoading(false);
    }
  }
  const peerActive =
    selected?.kind !== 'direct' ||
    data?.people.some(
      (person) =>
        person.id === selected.participants.find((id) => id !== userId),
    );
  return (
    <>
      <div className="team-message-actions">
        <Button
          disabled={busy || loading || !data}
          onClick={() => setCreating(true)}
        >
          New conversation
        </Button>
        <Button
          variant="outline"
          disabled={busy || loading}
          onClick={() => void load(selected?.id ?? '')}
        >
          {loading ? 'Loading…' : 'Refresh messages'}
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {data ? (
        <div className="team-message-layout">
          <details
            key={selected?.id ?? 'none'}
            open={!selected}
            className="team-message-list"
          >
            <summary>Conversations ({data.conversations.length})</summary>
            <aside aria-label="Your team conversations">
              {!data.conversations.length ? (
                <p>
                  No conversations yet. A coach can create a team channel, or
                  start a direct conversation with a connected member.
                </p>
              ) : (
                data.conversations.map((thread) => (
                  <button
                    type="button"
                    disabled={busy || loading}
                    aria-current={
                      selected?.id === thread.id ? 'page' : undefined
                    }
                    key={thread.id}
                    onClick={() => void load(thread.id)}
                  >
                    <strong>
                      {thread.kind === 'channel' ? '# ' : ''}
                      {title(thread)}
                    </strong>
                    <small>
                      {thread.kind === 'channel'
                        ? 'Visible to active team members'
                        : 'Direct conversation'}
                      {drafts[thread.id]?.trim() ? ' · draft' : ''}
                    </small>
                  </button>
                ))
              )}
            </aside>
          </details>
          <div className="team-message-thread">
            {selected ? (
              <>
                <header>
                  <h2>
                    {selected.kind === 'channel' ? '# ' : ''}
                    {title(selected)}
                  </h2>
                  <p>
                    {selected.kind === 'channel'
                      ? 'All currently connected members of this team can read and reply.'
                      : 'Only the participants can open this conversation in Messages.'}
                  </p>
                </header>
                {data.before ? (
                  <Button
                    variant="outline"
                    disabled={busy || loading}
                    onClick={() => void load(selected.id, true)}
                  >
                    Load earlier messages
                  </Button>
                ) : null}
                <div
                  role="log"
                  aria-label="Conversation messages"
                  aria-live="polite"
                >
                  {data.messages.map((message) => (
                    <article key={message.id}>
                      <header>
                        <strong>{message.authorName}</strong>
                        <time dateTime={message.createdAt}>
                          {new Date(message.createdAt).toLocaleString(
                            undefined,
                            { dateStyle: 'medium', timeStyle: 'short' },
                          )}
                        </time>
                      </header>
                      <p>{message.text}</p>
                    </article>
                  ))}
                  {!data.messages.length ? (
                    <p>No messages in this conversation yet.</p>
                  ) : null}
                </div>
                {!peerActive ? (
                  <p>
                    This member no longer has active team access. Earlier
                    messages remain available; new messages cannot be sent.
                  </p>
                ) : null}
                <form onSubmit={send}>
                  <label htmlFor="team-message-draft">Message</label>
                  <Textarea
                    id="team-message-draft"
                    maxLength={4000}
                    disabled={busy || !peerActive}
                    value={draft}
                    onChange={(event) => {
                      setDrafts((current) => ({
                        ...current,
                        [selected.id]: event.target.value,
                      }));
                      requestIds.current.delete(selected.id);
                    }}
                  />
                  <footer>
                    <small>
                      {draft.length}/4,000 · Refresh to check for new replies.
                      No email or push notifications.
                    </small>
                    <Button
                      type="submit"
                      disabled={
                        busy ||
                        loading ||
                        failed ||
                        !peerActive ||
                        !draft.trim()
                      }
                    >
                      {busy ? 'Saving…' : 'Send message'}
                    </Button>
                  </footer>
                </form>
              </>
            ) : (
              <p>Choose a conversation to open its messages.</p>
            )}
          </div>
        </div>
      ) : loading ? (
        <p>Loading conversations…</p>
      ) : null}
      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!busy) {
            setCreating(open);
            if (!open) {
              setName('');
              setRecipient('');
              createId.current = '';
            }
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New conversation</DialogTitle>
            <DialogDescription>
              Direct conversations need another connected team account. Only
              coaches can create team-wide channels.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="team-message-create">
            {error ? <p role="alert">{error}</p> : null}
            <label htmlFor="team-conversation-kind">
              Conversation type
              <NativeSelect
                id="team-conversation-kind"
                disabled={busy}
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as 'channel' | 'direct');
                  createId.current = '';
                }}
              >
                {session.team?.role !== 'player' ? (
                  <NativeSelectOption value="channel">
                    Team channel
                  </NativeSelectOption>
                ) : null}
                <NativeSelectOption value="direct">
                  Direct conversation
                </NativeSelectOption>
              </NativeSelect>
            </label>
            {kind === 'channel' ? (
              <label htmlFor="team-conversation-name">
                Name
                <Input
                  id="team-conversation-name"
                  required
                  maxLength={80}
                  disabled={busy}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    createId.current = '';
                  }}
                />
              </label>
            ) : (
              <label htmlFor="team-conversation-recipient">
                Team member
                <NativeSelect
                  id="team-conversation-recipient"
                  required
                  disabled={busy}
                  value={recipient}
                  onChange={(event) => {
                    setRecipient(event.target.value);
                    createId.current = '';
                  }}
                >
                  <NativeSelectOption value="">
                    Choose a connected member
                  </NativeSelectOption>
                  {data?.people
                    .filter((person) => person.id !== userId)
                    .map((person) => (
                      <NativeSelectOption key={person.id} value={person.id}>
                        {person.name} · {person.role}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </label>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setCreating(false);
                  setName('');
                  setRecipient('');
                  createId.current = '';
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  busy || (kind === 'channel' ? !name.trim() : !recipient)
                }
              >
                Create conversation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

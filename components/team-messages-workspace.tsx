'use client';
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeft,
  Hash,
  Lock,
  MessageSquare,
  Plus,
  Search,
  Send,
} from 'lucide-react';
import { workspaceFetch as fetch } from '@/lib/workspace-fetch';
import { useWorkspaceSession } from '@/components/workspace-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  if (session.mode === 'prototype') {
    return (
      <section className="module-surface team-messages-workspace">
        <h1>Messages</h1>
        <p>
          Open a connected team workspace to use channels and direct messages.
        </p>
      </section>
    );
  }
  return (
    <section className="module-surface team-messages-workspace">
      <ConnectedMessages onEditingChange={onEditingChange} />
    </section>
  );
}
function mergeHistory(
  previous: TeamMessagePayload | null,
  next: TeamMessagePayload,
  earlier = false,
): TeamMessagePayload {
  if (!next.selected || previous?.selected?.id !== next.selected.id)
    return next;
  const earlierPage = earlier ? next : previous;
  const laterPage = earlier ? previous : next;
  if (
    !earlier &&
    !previous.messages.some((message) =>
      next.messages.some((latest) => latest.id === message.id),
    )
  )
    return next;
  return {
    ...next,
    before: earlierPage.before,
    messages: [
      ...new Map(
        [...earlierPage.messages, ...laterPage.messages].map((message) => [
          message.id,
          message,
        ]),
      ).values(),
    ],
  };
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
  const [query, setQuery] = useState('');
  const [showList, setShowList] = useState(true);
  const [kind, setKind] = useState<'channel' | 'direct'>(
      session.team?.role === 'player' ? 'direct' : 'channel',
    ),
    [name, setName] = useState(''),
    [recipient, setRecipient] = useState('');
  const requestIds = useRef(new Map<string, string>()),
    createId = useRef(''),
    lock = useRef(false),
    serial = useRef(0),
    reading = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
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
  async function load(id = '', earlier = false, background = false) {
    if (lock.current || (background && reading.current)) return;
    const sequence = ++serial.current;
    reading.current = true;
    if (!background) {
      setLoading(true);
      setError('');
    }
    try {
      const params = new URLSearchParams();
      if (id) params.set('conversationId', id);
      if (earlier && data?.before) params.set('before', data.before);
      const response = await fetch('/api/team-messages?' + params, {
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
      });
      const raw = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (sequence !== serial.current) return;
      if (!response.ok) {
        if (
          response.status === 401 ||
          response.status === 403 ||
          response.status === 404
        )
          setData(null);
        throw new Error(raw?.error || 'Conversations could not be loaded.');
      }
      const next = payload(raw, userId);
      if (sequence !== serial.current) return;
      if (id && next.selected?.id !== id)
        throw new Error('The selected conversation could not be verified.');
      setData((previous) => mergeHistory(previous, next, earlier));
      if (!background) setShowList(!next.selected);
      setError('');
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
      if (sequence === serial.current) {
        reading.current = false;
        setLoading(false);
      }
    }
  }
  const sync = useEffectEvent(() => {
    if (!creating && document.visibilityState === 'visible')
      void load(selected?.id ?? '', false, true);
  });
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => sync(), 3000);
    const refresh = () => sync();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      serial.current++;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const lastMessageId = data?.messages.at(-1)?.id;
  useLayoutEffect(() => {
    if (log.current && followLatest.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [selected?.id, lastMessageId, showList]);
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
      followLatest.current = true;
      setData((previous) => mergeHistory(previous, next));
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
      reading.current = false;
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
      followLatest.current = true;
      setData(next);
      setShowList(false);
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
      reading.current = false;
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
  const filtered =
    data?.conversations.filter((thread) =>
      title(thread).toLowerCase().includes(query.trim().toLowerCase()),
    ) ?? [];
  function openConversation(id: string) {
    followLatest.current = true;
    if (selected?.id === id) setShowList(false);
    else void load(id);
  }
  function newConversation(type: 'channel' | 'direct') {
    setKind(type);
    setCreating(true);
  }
  return (
    <>
      {error && (
        <div className="team-message-error">
          <p role="alert">{error}</p>
          <Button
            variant="outline"
            disabled={busy || loading}
            onClick={() => void load(selected?.id ?? '')}
          >
            Retry connection
          </Button>
        </div>
      )}
      <div className={`team-message-layout${showList ? ' showing-list' : ''}`}>
        <nav className="team-message-list" aria-label="Conversations">
          <header>
            <h1>Messages</h1>
            <Button
              size="icon"
              variant="ghost"
              aria-label="New conversation"
              disabled={busy || !data}
              onClick={() =>
                newConversation(
                  session.team?.role === 'player' ? 'direct' : 'channel',
                )
              }
            >
              <Plus />
            </Button>
          </header>
          <label className="team-message-search">
            <Search size={16} aria-hidden="true" />
            <Input
              aria-label="Find a conversation"
              placeholder="Find a conversation"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {(['channel', 'direct'] as const).map((category) => {
            const threads = filtered.filter(
              (thread) => thread.kind === category,
            );
            return (
              <section className="team-message-group" key={category}>
                <header>
                  <h2>
                    {category === 'channel' ? 'Channels' : 'Direct messages'}
                  </h2>
                  {(category === 'direct' ||
                    session.team?.role !== 'player') && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={
                        category === 'channel'
                          ? 'New channel'
                          : 'New direct message'
                      }
                      disabled={busy || !data}
                      onClick={() => newConversation(category)}
                    >
                      <Plus />
                    </Button>
                  )}
                </header>
                {threads.map((thread) => (
                  <button
                    type="button"
                    key={thread.id}
                    disabled={busy || loading}
                    aria-current={
                      selected?.id === thread.id ? 'page' : undefined
                    }
                    onClick={() => openConversation(thread.id)}
                  >
                    {category === 'channel' ? (
                      <Hash size={16} aria-hidden="true" />
                    ) : (
                      <span className="team-message-avatar" aria-hidden="true">
                        {title(thread).slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span>{title(thread)}</span>
                    {drafts[thread.id]?.trim() && <small>Draft</small>}
                  </button>
                ))}
                {!threads.length && data && (
                  <p>
                    {query.trim()
                      ? 'No matches'
                      : category === 'channel'
                        ? 'No channels yet'
                        : 'No direct messages yet'}
                  </p>
                )}
              </section>
            );
          })}
          {loading && !data && <p role="status">Loading conversations…</p>}
        </nav>
        <div className="team-message-thread">
          {selected ? (
            <header className="team-message-thread-header">
              <Button
                className="team-message-back"
                variant="ghost"
                size="icon"
                aria-label="Back to conversations"
                onClick={() => setShowList(true)}
              >
                <ArrowLeft />
              </Button>
              {selected.kind === 'channel' ? (
                <Hash aria-hidden="true" />
              ) : (
                <Lock aria-hidden="true" />
              )}
              <h2>{title(selected)}</h2>
            </header>
          ) : null}
          {selected && data ? (
            <>
              {data.before && (
                <Button
                  className="team-message-earlier"
                  variant="ghost"
                  disabled={busy || loading}
                  onClick={() => void load(selected.id, true)}
                >
                  Load earlier messages
                </Button>
              )}
              <div
                ref={log}
                role="log"
                aria-label="Conversation messages"
                aria-live="polite"
                onScroll={(event) => {
                  const area = event.currentTarget;
                  followLatest.current =
                    area.scrollHeight - area.scrollTop - area.clientHeight < 48;
                }}
              >
                {data.messages.map((message) => (
                  <article key={message.id}>
                    <span className="team-message-avatar" aria-hidden="true">
                      {message.authorName.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
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
                    </div>
                  </article>
                ))}
                {!data.messages.length && (
                  <p className="team-message-empty-thread">
                    Start the conversation with a message.
                  </p>
                )}
              </div>
              {!peerActive && (
                <p className="team-message-empty-thread">
                  This member no longer has team access. Earlier messages are
                  available.
                </p>
              )}
              <form className="team-message-composer" onSubmit={send}>
                <Textarea
                  aria-label="Message"
                  placeholder={`Message ${selected.kind === 'channel' ? '#' : ''}${title(selected)}`}
                  maxLength={4000}
                  disabled={busy || !peerActive}
                  value={draft}
                  onKeyDown={(event) => {
                    if (
                      event.key !== 'Enter' ||
                      event.shiftKey ||
                      event.nativeEvent.isComposing
                    )
                      return;
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }}
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
                    {draft.length
                      ? `${draft.length}/4,000`
                      : 'Shift + Enter for a new line'}
                  </small>
                  <Button
                    type="submit"
                    disabled={
                      busy || loading || failed || !peerActive || !draft.trim()
                    }
                  >
                    <Send /> {busy ? 'Sending…' : 'Send'}
                  </Button>
                </footer>
              </form>
            </>
          ) : (
            <div className="team-message-welcome">
              <MessageSquare size={32} aria-hidden="true" />
              <h2>
                {data?.conversations.length
                  ? 'Open a conversation'
                  : 'Start a conversation'}
              </h2>
              <p>
                {data?.conversations.length
                  ? 'Choose a channel or direct message.'
                  : 'Create a channel for your team or message a team member directly.'}
              </p>
              {!data?.conversations.length && data && (
                <Button
                  onClick={() =>
                    newConversation(
                      session.team?.role === 'player' ? 'direct' : 'channel',
                    )
                  }
                >
                  <Plus /> New conversation
                </Button>
              )}
            </div>
          )}
          {notice && (
            <p className="sr-only" role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
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
              <Select
                disabled={busy}
                value={kind}
                onValueChange={(value) => {
                  if (value !== 'channel' && value !== 'direct') return;
                  setKind(value);
                  createId.current = '';
                }}
              >
                <SelectTrigger id="team-conversation-kind">
                  <SelectValue>
                    {kind === 'channel'
                      ? 'Team channel'
                      : 'Direct conversation'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
                  {session.team?.role !== 'player' && (
                    <SelectItem value="channel">Team channel</SelectItem>
                  )}
                  <SelectItem value="direct">Direct conversation</SelectItem>
                </SelectContent>
              </Select>
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
                <Select
                  required
                  disabled={busy}
                  value={recipient || null}
                  onValueChange={(value) => {
                    setRecipient(value ?? '');
                    createId.current = '';
                  }}
                >
                  <SelectTrigger id="team-conversation-recipient">
                    <SelectValue placeholder="Choose a connected member">
                      {
                        data?.people.find((person) => person.id === recipient)
                          ?.name
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start" alignItemWithTrigger={false}>
                    {data?.people
                      .filter((person) => person.id !== userId)
                      .map((person) => (
                        <SelectItem key={person.id} value={person.id}>
                          {person.name} · {person.role}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
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

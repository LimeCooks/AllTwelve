'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import { MessageSquare, Plus, RefreshCw } from 'lucide-react';
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
import {
  parseConversations,
  type ConversationPayload,
} from '@/lib/conversations';

const empty: ConversationPayload = { threads: [], legacy: [], legacyError: '' };
export function MessagesWorkspace({
  onEditingChange,
}: {
  onEditingChange: (editing: boolean) => void;
}) {
  const [data, setData] = useState(empty),
    [selectedId, setSelectedId] = useState('');
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({}),
    [nameDraft, setNameDraft] = useState('');
  const [createOpen, setCreateOpen] = useState(false),
    [discardOpen, setDiscardOpen] = useState(false),
    [query, setQuery] = useState('');
  const lock = useRef(false),
    controller = useRef<AbortController | null>(null),
    requestIds = useRef(new Map<string, string>());
  const selected = data.threads.find((thread) => thread.id === selectedId),
    draft = drafts[selectedId] ?? '';
  const dirty =
    Object.values(drafts).some((text) => Boolean(text.trim())) ||
    Boolean(nameDraft.trim());
  const load = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoadState('loading');
    setError('');
    try {
      const response = await fetch('/api/messages', {
        cache: 'no-store',
        signal: current.signal,
      });
      const result = (await response.json()) as ConversationPayload & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || 'Unable to load conversations.');
      const checked = parseConversations(result);
      if (
        !Array.isArray(result.legacy) ||
        typeof result.legacyError !== 'string' ||
        !result.legacy.every(
          (thread) =>
            thread &&
            typeof thread.name === 'string' &&
            Array.isArray(thread.messages) &&
            thread.messages.every(
              (message) =>
                message &&
                typeof message.text === 'string' &&
                typeof message.author === 'string' &&
                typeof message.time === 'string',
            ),
        )
      )
        throw new Error(
          'The conversation response was incomplete. Please retry.',
        );
      if (current.signal.aborted) return;
      setData({
        ...checked,
        legacy: result.legacy,
        legacyError: result.legacyError,
      });
      setSelectedId((id) =>
        checked.threads.some((thread) => thread.id === id)
          ? id
          : (checked.threads[0]?.id ?? ''),
      );
      setLoadState('ready');
    } catch (failure) {
      if (!current.signal.aborted) {
        setError(
          failure instanceof Error
            ? failure.message
            : 'Unable to load conversations.',
        );
        setLoadState('error');
      }
    }
  }, []);
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);
  useEffect(() => {
    onEditingChange(dirty || busy);
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => {
      onEditingChange(false);
      window.removeEventListener('beforeunload', guard);
    };
  }, [dirty, busy, onEditingChange]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const save = async (action: 'create' | 'message') => {
    if (lock.current || loadState !== 'ready') return;
    const text = draft.trim(),
      name = nameDraft.trim(),
      threadId = selectedId;
    if (action === 'message' && (!text || !selected)) return;
    if (action === 'create' && !name) return;
    const fingerprint = JSON.stringify(
      action === 'create' ? [action, name] : [action, threadId, text],
    );
    const id = requestIds.current.get(fingerprint) ?? crypto.randomUUID();
    requestIds.current.set(fingerprint, id);
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, id, threadId, text, name }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(
          result.error || 'Unable to save. Your draft is preserved.',
        );
      const checked = parseConversations(result);
      if (
        action === 'create'
          ? !checked.threads.some(
              (thread) => thread.id === id && thread.name === name,
            )
          : !checked.threads
              .find((thread) => thread.id === threadId)
              ?.messages.some(
                (message) => message.id === id && message.text === text,
              )
      )
        throw new Error(
          'The saved record could not be confirmed. Your draft is preserved; retry with the same details.',
        );
      setData((current) => ({ ...current, ...checked }));
      requestIds.current.delete(fingerprint);
      if (action === 'create') {
        setNameDraft('');
        setCreateOpen(false);
        setSelectedId(id);
        setNotice('Private conversation created.');
      } else {
        setDrafts((current) => ({ ...current, [threadId]: '' }));
        setNotice('Message saved in this workspace.');
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to save. Your draft is preserved.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save('message');
  };
  const closeCreate = () => {
    if (busy) return;
    if (nameDraft.trim()) setDiscardOpen(true);
    else setCreateOpen(false);
  };
  const downloadDrafts = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { conversationDraft: nameDraft, messages: drafts },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'message-drafts.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="module-surface private-messages">
      <header className="private-messages-header">
        <div>
          <p className="eyebrow">Private workspace</p>
          <h1>Messages</h1>
          <p>
            Saved conversations for your account. Team delivery is not connected
            yet.
          </p>
        </div>
        <Button
          className="module-primary"
          disabled={busy || loadState !== 'ready'}
          onClick={() => {
            setError('');
            setCreateOpen(true);
          }}
        >
          <Plus /> New conversation
        </Button>
      </header>
      {error ? (
        <div role="alert" className="private-message-error">
          <p>{error}</p>
          {loadState === 'error' ? (
            <>
              <Button onClick={() => void load()} variant="outline">
                Retry conversations
              </Button>
              {dirty ? (
                <Button onClick={downloadDrafts} variant="outline">
                  Download drafts
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <output className="private-message-notice">{notice}</output>
      ) : null}
      {loadState === 'loading' ? (
        <output>Loading saved conversations…</output>
      ) : loadState === 'ready' ? (
        <>
          <div className="private-message-toolbar">
            <label htmlFor="private-conversation">
              Conversation
              <NativeSelect
                id="private-conversation"
                disabled={busy || !data.threads.length}
                value={selectedId}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  setQuery('');
                  setError('');
                }}
              >
                {!data.threads.length ? (
                  <NativeSelectOption value="">
                    No saved conversations
                  </NativeSelectOption>
                ) : null}
                {data.threads.map((thread) => (
                  <NativeSelectOption key={thread.id} value={thread.id}>
                    {thread.name}
                    {drafts[thread.id]?.trim() ? ' · draft' : ''}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <Button
              aria-label="Refresh conversations"
              disabled={busy}
              variant="outline"
              onClick={() => void load()}
            >
              <RefreshCw /> Refresh
            </Button>
          </div>
          {selected ? (
            <div className="private-conversation">
              <header>
                <h2>{selected.name}</h2>
                <Input
                  aria-label="Search this conversation"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search saved messages…"
                />
              </header>
              <div
                className="private-message-list"
                role="log"
                aria-label="Saved messages"
                aria-live="polite"
              >
                {selected.messages
                  .filter((message) =>
                    message.text.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((message) => (
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
                {!selected.messages.length ? (
                  <p>No saved messages in this conversation.</p>
                ) : query &&
                  !selected.messages.some((message) =>
                    message.text.toLowerCase().includes(query.toLowerCase()),
                  ) ? (
                  <p>No saved messages match this search.</p>
                ) : null}
              </div>
              <form onSubmit={submit}>
                <label htmlFor="private-message-draft">Message draft</label>
                <Textarea
                  id="private-message-draft"
                  value={draft}
                  maxLength={4000}
                  disabled={busy}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [selectedId]: event.target.value,
                    }))
                  }
                  placeholder="Write a message to keep in this workspace…"
                />
                <footer>
                  <small>
                    {draft.length}/4,000 · Saved privately; no delivery
                    notification
                  </small>
                  <Button
                    className="module-primary"
                    type="submit"
                    disabled={busy || !draft.trim()}
                  >
                    {busy ? 'Saving…' : 'Save message'}
                  </Button>
                </footer>
              </form>
            </div>
          ) : (
            <div className="viewer-empty-state compact">
              <MessageSquare />
              <strong>No saved conversations yet</strong>
              <span>
                Create your first private conversation to start recording
                messages.
              </span>
            </div>
          )}
          {data.legacy.length || data.legacyError ? (
            <details className="private-message-archive">
              <summary>Earlier prototype conversations · read only</summary>
              {data.legacyError ? <p role="alert">{data.legacyError}</p> : null}
              {data.legacy.map((thread) => (
                <details key={thread.name}>
                  <summary>
                    {thread.name} · {thread.messages.length} messages
                  </summary>
                  {thread.messages.map((message, index) => (
                    <article key={index}>
                      <strong>{message.author}</strong>
                      <small>{message.time}</small>
                      <p>{message.text}</p>
                    </article>
                  ))}
                </details>
              ))}
              <p>
                These earlier records are preserved separately. Their old member
                labels do not grant access or prove delivery.
              </p>
            </details>
          ) : null}
        </>
      ) : null}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) closeCreate();
        }}
      >
        <DialogContent className="athlete-dialog">
          <form
            inert={busy}
            onSubmit={(event) => {
              event.preventDefault();
              void save('create');
            }}
          >
            <DialogHeader>
              <DialogTitle>New private conversation</DialogTitle>
              <DialogDescription>
                This saves a conversation in your workspace. It does not invite
                or message another person.
              </DialogDescription>
            </DialogHeader>
            {error ? (
              <p role="alert" className="private-message-error">
                {error}
              </p>
            ) : null}
            <label htmlFor="private-conversation-name">
              Conversation name
              <Input
                id="private-conversation-name"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                maxLength={100}
                required
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeCreate}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !nameDraft.trim()}>
                {busy ? 'Saving…' : 'Create conversation'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard the conversation draft?</DialogTitle>
            <DialogDescription>
              Your saved messages and other drafts stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>
              Keep editing
            </Button>
            <Button
              onClick={() => {
                setNameDraft('');
                setDiscardOpen(false);
                setCreateOpen(false);
              }}
            >
              Discard draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

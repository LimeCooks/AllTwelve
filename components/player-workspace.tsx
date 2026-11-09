'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PlayField } from '@/components/play-field';
import { TeamMessagesWorkspace } from '@/components/team-messages-workspace';
import { workspaceFetch as fetch } from '@/lib/workspace-fetch';
import type { PlayerLearning, PlayerLearningItem } from '@/lib/player-learning';
import type { WorkspaceSession } from '@/components/workspace-gate';

function readPayload(raw: unknown, athleteId: string): PlayerLearning {
  const value = raw as PlayerLearning | null;
  if (
    !value ||
    value.athlete?.id !== athleteId ||
    typeof value.athlete.name !== 'string' ||
    !Array.isArray(value.items) ||
    value.items.some(
      (item) =>
        !item ||
        typeof item.id !== 'string' ||
        !item.id ||
        !/^[a-f0-9]{64}$/.test(item.version) ||
        !item.package ||
        !item.package.publishedAt ||
        typeof item.title !== 'string' ||
        ['reviewed', 'assignment', 'note'].some(
          (key) => typeof item[key as 'reviewed'] !== 'boolean',
        ),
    ) ||
    new Set(value.items.map((item) => item.id)).size !== value.items.length
  )
    throw new Error(
      'Your assigned material could not be verified. Refresh before continuing.',
    );
  return value;
}

export function PlayerWorkspace({ session }: { session: WorkspaceSession }) {
  const [screen, setScreen] = useState<'learning' | 'messages'>('learning');
  const [messageEditing, setMessageEditing] = useState(false);
  const [data, setData] = useState<PlayerLearning | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  const athleteId = session.team?.athleteId ?? '';
  const item = data?.items.find((row) => row.id === selectedId) ?? null;
  async function load() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/player-learning', {
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      const raw = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(raw.error || 'Your assignments could not be loaded.');
      const next = readPayload(raw, athleteId);
      if (mounted.current) setData(next);
    } catch (cause) {
      if (mounted.current) {
        setData(null);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Your assignments could not be loaded.',
        );
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (lock.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);
  async function acknowledge(
    kind: 'reviewed' | 'assignment' | 'note',
    selected: PlayerLearningItem,
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/player-learning', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: selected.id,
          version: selected.version,
          kind,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const raw = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(
          raw.error || 'Your acknowledgement could not be saved.',
        );
      const next = readPayload(raw, athleteId);
      if (mounted.current) {
        setData(next);
        setNotice('Acknowledgement saved. Your coach can see your progress.');
      }
    } catch (cause) {
      if (mounted.current) {
        setData(null);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Saving could not be confirmed. Refresh to check your progress.',
        );
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const complete =
    data?.items.filter((row) => row.reviewed && row.assignment && row.note)
      .length ?? 0;
  if (screen === 'messages')
    return (
      <main className="player-learning-workspace">
        <header className="player-learning-header">
          <div>
            <span className="eyebrow">{session.team?.name}</span>
            <p>{session.user.name} · Player account</p>
          </div>
          <Button
            variant="outline"
            disabled={messageEditing}
            onClick={() => setScreen('learning')}
          >
            Your installs
          </Button>
        </header>
        <TeamMessagesWorkspace onEditingChange={setMessageEditing} />
      </main>
    );
  return (
    <main className="player-learning-workspace">
      <header className="player-learning-header">
        <div>
          <span className="eyebrow">{session.team?.name}</span>
          <h1>Your installs</h1>
          <p>{session.user.name} · Player account</p>
        </div>
        <a href="/signout-with-chatgpt?return_to=%2F" target="_top">
          Sign out
        </a>
      </header>
      <div className="player-learning-toolbar">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setScreen('messages')}
        >
          Messages
        </Button>
        <span>
          {data
            ? `${complete} of ${data.items.length} assignments complete`
            : 'Assigned learning'}
        </span>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          {busy ? 'Checking…' : 'Refresh'}
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {data ? (
        <>
          <p>
            {data.athlete.name} · {data.athlete.position} · {data.athlete.unit}
          </p>
          {!data.items.length ? (
            <section className="player-learning-empty">
              <h2>No published assignments yet</h2>
              <p>
                Your coach’s published installs will appear here when assigned
                to your roster profile.
              </p>
            </section>
          ) : null}
          <details className="player-learning-list" open={!item}>
            <summary>Choose an assignment ({data.items.length})</summary>
            {data.items.map((row) => (
              <button
                type="button"
                key={row.id}
                disabled={busy}
                aria-pressed={selectedId === row.id}
                onClick={() => {
                  setSelectedId(row.id);
                  setNotice('');
                }}
              >
                <strong>{row.title}</strong>
                <span>
                  {row.package.name}
                  {row.package.dueAt
                    ? ` · Due ${row.package.dueAt}`
                    : ' · No due date'}
                </span>
                <small>
                  {row.reviewed && row.assignment && row.note
                    ? 'Complete'
                    : 'To review'}
                </small>
              </button>
            ))}
          </details>
          {item ? (
            <section className="player-learning-material">
              <header>
                <h2>{item.title}</h2>
                <p>{item.package.name}</p>
              </header>
              {item.play ? (
                <>
                  <PlayField drawing={item.play} name={item.play.name} />
                  {item.reviewed ? (
                    <p className="player-learning-done">✓ Play reviewed</p>
                  ) : (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void acknowledge('reviewed', item)}
                    >
                      Mark play reviewed
                    </Button>
                  )}
                  <details>
                    <summary>Position assignments</summary>
                    {item.play.assignments.length ? (
                      item.play.assignments.map((assignment) => (
                        <article key={assignment.id}>
                          <h3>
                            {assignment.position} · {assignment.title}
                          </h3>
                          <p>{assignment.detail}</p>
                        </article>
                      ))
                    ) : (
                      <p>No additional position instructions.</p>
                    )}
                    {item.assignment ? (
                      <p className="player-learning-done">
                        ✓ Assignments reviewed
                      </p>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void acknowledge('assignment', item)}
                      >
                        Mark assignments reviewed
                      </Button>
                    )}
                  </details>
                  <details>
                    <summary>Coaching notes</summary>
                    <p>{item.play.notes || 'No additional coaching notes.'}</p>
                    {item.note ? (
                      <p className="player-learning-done">✓ Notes reviewed</p>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void acknowledge('note', item)}
                      >
                        Mark notes reviewed
                      </Button>
                    )}
                  </details>
                </>
              ) : (
                <p role="alert">
                  This play’s material is unavailable. Ask your coach to check
                  it.
                </p>
              )}
            </section>
          ) : null}
        </>
      ) : busy ? (
        <p>Loading your published assignments…</p>
      ) : null}
    </main>
  );
}

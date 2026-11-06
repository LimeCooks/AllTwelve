'use client';
import {
  useEffect,
  useState,
  createContext,
  useContext,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type WorkspaceSession = {
  mode: 'prototype' | 'pilot';
  user: { id: string; email: string; name: string };
  team: { id: string; name?: string; season?: string } | null;
};

const WorkspaceContext = createContext<WorkspaceSession | null>(null);
export function useWorkspaceSession() {
  const session = useContext(WorkspaceContext);
  if (!session) throw new Error('Workspace identity is unavailable.');
  return session;
}

export function WorkspaceGate({
  children,
}: {
  children: (session: WorkspaceSession) => ReactNode;
}) {
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [error, setError] = useState('');
  const [signIn, setSignIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const response = await fetch('/api/session', { cache: 'no-store' });
      if (response.status === 401) {
        setSignIn(true);
        return;
      }
      const data = (await response.json()) as WorkspaceSession & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || 'Unable to open your workspace.');
      setSignIn(false);
      setError('');
      setSession(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to open your workspace.',
      );
    }
  };
  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);
  const create = async (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) => {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: fields.get('name'),
          season: fields.get('season'),
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(data.error || 'Unable to create your team.');
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to create your team.',
      );
    } finally {
      setBusy(false);
    }
  };
  if (session?.team)
    return (
      <WorkspaceContext.Provider value={session}>
        {children(session)}
      </WorkspaceContext.Provider>
    );
  return (
    <main className="workspace-welcome">
      <section>
        <span className="eyebrow">ChalkTalk · Private workspace</span>
        <h1>
          {signIn
            ? 'Your team starts here.'
            : session
              ? 'Create your team.'
              : 'Opening your workspace…'}
        </h1>
        {error ? <p role="alert">{error}</p> : null}
        {signIn ? (
          <>
            <p>Sign in to open your own team’s workspace.</p>
            {/* Sites sign-in requires a normal top-level anchor, not client routing. */}
            {/* eslint-disable-next-line next/no-html-link-for-pages */}
            <a href="/signin-with-chatgpt?return_to=%2F" target="_top">
              Sign in with ChatGPT
            </a>
          </>
        ) : session ? (
          <>
            <p>
              Start with an empty workspace. Add your own roster, formations,
              plays, and schedule as you go.
            </p>
            <form onSubmit={create}>
              <label htmlFor="new-team-name">Team name</label>
              <Input
                id="new-team-name"
                name="name"
                maxLength={100}
                required
                autoComplete="organization"
                placeholder="Your team’s name"
              />
              <label htmlFor="new-team-season">Season</label>
              <Input
                id="new-team-season"
                name="season"
                defaultValue={new Date().getFullYear()}
                pattern="[0-9]{4}"
                inputMode="numeric"
                required
                maxLength={4}
              />
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating your team…' : 'Create team'}
              </Button>
            </form>
          </>
        ) : error ? (
          <Button onClick={() => void load()}>Try again</Button>
        ) : (
          <p>Please wait.</p>
        )}
      </section>
    </main>
  );
}

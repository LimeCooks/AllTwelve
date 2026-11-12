'use client';
import { Brand } from '@/components/brand';
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
import { bindWorkspaceScope } from '@/lib/workspace-fetch';
import {
  WorkspaceEntry,
  type PendingTeamInvitation,
} from '@/components/workspace-entry';

export type WorkspaceSession = {
  mode: 'prototype' | 'pilot';
  user: { id: string; email: string; name: string };
  team: {
    id: string;
    name?: string;
    season?: string;
    role?: 'owner' | 'staff' | 'player';
    athleteId?: string | null;
  } | null;
  workspaces?: {
    id: string;
    name: string;
    season: string;
    role: 'owner' | 'staff' | 'player';
  }[];
  invitations?: PendingTeamInvitation[];
  canCreateTeam?: boolean;
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
  const [query] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.search,
  );
  const requestedTeam = new URLSearchParams(query).get('team') ?? '';
  const showInvitations = new URLSearchParams(query).has('invitations');
  const load = async () => {
    try {
      const response = await fetch(
        '/api/session' +
          (requestedTeam ? '?team=' + encodeURIComponent(requestedTeam) : ''),
        { cache: 'no-store' },
      );
      if (response.status === 401) {
        setSignIn(true);
        return false;
      }
      const data = (await response.json()) as WorkspaceSession & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || 'Unable to open your workspace.');
      if (
        !data.user ||
        typeof data.user.id !== 'string' ||
        !data.user.id ||
        !['prototype', 'pilot'].includes(data.mode) ||
        (data.mode === 'pilot' &&
          data.team &&
          !['owner', 'staff', 'player'].includes(data.team.role ?? '')) ||
        (data.mode === 'pilot' &&
          (!Array.isArray(data.workspaces) || !Array.isArray(data.invitations)))
      )
        throw new Error(
          'Your workspace identity could not be verified. Reload before continuing.',
        );
      if (data.team?.id) bindWorkspaceScope(data.team.id);
      setSignIn(false);
      setError('');
      setSession(data);
      return true;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to open your workspace.',
      );
      return false;
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
  if (
    session &&
    (showInvitations ||
      (!session.team &&
        (Boolean(session.invitations?.length) ||
          Boolean(session.workspaces?.length))))
  )
    return (
      <WorkspaceEntry
        session={session}
        refreshError={error}
        showInvitations={
          showInvitations || Boolean(session.invitations?.length)
        }
        onRefresh={load}
      />
    );
  if (session?.team)
    return (
      <WorkspaceContext.Provider value={session}>
        {children(session)}
      </WorkspaceContext.Provider>
    );
  if (session?.mode === 'pilot' && session.canCreateTeam === false)
    return (
      <main className="workspace-welcome">
        <section>
          <Brand />
          <h1>Team access is unavailable.</h1>
          <p>
            Ask your team owner for a current invitation. Your account will open
            that team's saved workspace after access is restored.
          </p>
          {error ? <p role="alert">{error}</p> : null}
          <Button disabled={busy} onClick={() => void load()}>
            Check team access
          </Button>
          <a href="/signout-with-chatgpt?return_to=%2F" target="_top">
            Sign out
          </a>
        </section>
      </main>
    );
  return (
    <main className="workspace-welcome">
      <section>
        <Brand />
        <h1>
          {signIn
            ? 'Your team starts here.'
            : session
              ? 'Create your team.'
              : 'Opening your workspace…'}
        </h1>
        {error ? <p role="alert">{error}</p> : null}
        {error && requestedTeam ? (
          <a href="/" target="_top">
            Choose another workspace
          </a>
        ) : null}
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

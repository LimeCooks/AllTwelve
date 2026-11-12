'use client';
import { Brand } from '@/components/brand';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { WorkspaceSession } from '@/components/workspace-gate';
export type PendingTeamInvitation = {
  id: string;
  teamId: string;
  teamName: string;
  role: 'staff' | 'player';
  athleteId: string | null;
  expiresAt: string;
  version: string;
};

export function WorkspaceEntry({
  session,
  showInvitations,
  onRefresh,
  refreshError = '',
}: {
  session: WorkspaceSession;
  showInvitations: boolean;
  onRefresh: () => Promise<boolean>;
  refreshError?: string;
}) {
  const [review, setReview] = useState<PendingTeamInvitation | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (lock.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  const accept = async () => {
    if (!review || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/team-invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: review.id, version: review.version }),
      });
      const data = (await response.json()) as {
        membership?: { team_id?: string; user_id?: string };
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          data.error ||
            'Your team access could not be confirmed. Reload before retrying.',
        );
      if (
        data.membership?.team_id !== review.teamId ||
        data.membership.user_id !== session.user.id
      )
        throw new Error(
          'The joined workspace did not match this invitation. Reload before continuing.',
        );
      // The confirmed join deliberately leaves this document. Do not block our
      // own navigation with the in-flight-request unload guard.
      lock.current = false;
      window.location.assign('/?team=' + encodeURIComponent(review.teamId));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Team access could not be confirmed.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <main className="workspace-welcome">
      <section>
        <Brand />
        <h1>
          {showInvitations ? 'Team invitations' : 'Choose your workspace'}
        </h1>
        <p>
          Signed in as {session.user.name}
          {session.user.email ? ` · ${session.user.email}` : ''}.
        </p>
        {error || refreshError ? (
          <p role="alert">{error || refreshError}</p>
        ) : null}
        {showInvitations ? (
          <>
            <p>
              Review the team and role before joining. Your signed-in account
              must match the recipient approved by its owner.
            </p>
            {(session.invitations ?? []).map((invitation) => (
              <article className="workspace-invitation" key={invitation.id}>
                <h2>{invitation.teamName}</h2>
                <p>
                  {invitation.role === 'staff'
                    ? 'Staff coaching access'
                    : 'Player access to assigned material'}
                </p>
                <p>
                  Expires {new Date(invitation.expiresAt).toLocaleDateString()}
                </p>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setError('');
                    setReview(invitation);
                  }}
                >
                  Review invitation
                </Button>
              </article>
            ))}
            {!session.invitations?.length ? (
              <p>No pending invitations for this account.</p>
            ) : null}
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                if (await onRefresh()) {
                  setReview(null);
                  setError('');
                }
              }}
            >
              Refresh invitations
            </Button>
          </>
        ) : null}
        {(session.workspaces ?? []).length ? (
          <div className="workspace-choices">
            <h2>Your workspaces</h2>
            {session.workspaces!.map((team) => (
              <a
                key={team.id}
                href={'/?team=' + encodeURIComponent(team.id)}
                target="_top"
              >
                {team.name} · {team.season} ·{' '}
                {team.role === 'owner'
                  ? 'Owner'
                  : team.role === 'staff'
                    ? 'Staff'
                    : 'Player'}
              </a>
            ))}
          </div>
        ) : null}
        <Dialog
          open={Boolean(review)}
          onOpenChange={(open) => {
            if (!busy && !open) setReview(null);
          }}
        >
          <DialogContent className="athlete-dialog">
            <DialogHeader>
              <DialogTitle>Join {review?.teamName}?</DialogTitle>
              <DialogDescription>
                {review?.role === 'staff'
                  ? 'This gives your signed-in account access to team coaching tools. The owner keeps access management and full team backup controls.'
                  : 'This connects your signed-in account to the selected player profile and its assigned, published material.'}
              </DialogDescription>
            </DialogHeader>
            <p>{session.user.email}</p>
            {error ? <p role="alert">{error}</p> : null}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void accept()}>
                {busy ? 'Joining…' : 'Join team'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </main>
  );
}

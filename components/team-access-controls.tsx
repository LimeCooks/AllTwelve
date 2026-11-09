'use client';
import { useEffect, useRef, useState } from 'react';
import { workspaceFetch as fetch } from '@/lib/workspace-fetch';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type AccessRecord = {
  id: string;
  email: string;
  name?: string;
  role: string;
  status: string;
  version: string;
  expires_at?: string;
};
type AccessList = { invitations: AccessRecord[]; memberships: AccessRecord[] };

export function TeamAccessControls({
  onEditingChange,
}: {
  onEditingChange: (editing: boolean) => void;
}) {
  const [data, setData] = useState<AccessList | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'staff' | 'player'>('staff');
  const [athleteId, setAthleteId] = useState('');
  const [roster, setRoster] = useState<
    { id: string; name: string; unit: string }[] | null
  >(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{
    kind: 'invitation' | 'membership';
    record: AccessRecord;
  } | null>(null);
  const requestId = useRef('');
  const lock = useRef(false);
  async function load() {
    const response = await fetch('/api/team-access', { cache: 'no-store' });
    const payload = (await response.json()) as AccessList & { error?: string };
    if (!response.ok)
      throw new Error(payload.error || 'Access could not be loaded.');
    if (
      !Array.isArray(payload.invitations) ||
      !Array.isArray(payload.memberships)
    )
      throw new Error('Access response is incomplete.');
    setData(payload);
  }
  useEffect(() => {
    void load().catch((cause) => setError(cause.message));
  }, []);
  useEffect(() => {
    if (role !== 'player') return;
    const controller = new AbortController();
    setRoster(null);
    void fetch('/api/athletes', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          athletes?: { id: string; name: string; unit: string }[];
          error?: string;
        };
        if (!response.ok || !Array.isArray(body.athletes))
          throw new Error(body.error || 'Roster could not be loaded.');
        setRoster(body.athletes);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [role]);
  useEffect(() => {
    onEditingChange(busy || Boolean(email.trim()));
    return () => onEditingChange(false);
  }, [busy, email, onEditingChange]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (busy || email.trim()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [busy, email]);
  async function mutate(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Access could not be updated. Reload before retrying.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="settings-form team-access-controls">
      <p>
        Staff can work with plays, film, athletes, installs, schedules, and
        practices. Team settings, backups, and your private conversations remain
        owner-only.
      </p>
      <p>
        Players can open only the published install material assigned to their
        linked roster profile and acknowledge their own reviews.
      </p>
      <p>
        Invitations are tied to the recipient’s sign-in email and expire after
        seven days. This does not send an email. The private site also needs to
        allow the recipient before they can sign in.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void mutate(async () => {
            requestId.current ||= crypto.randomUUID();
            const response = await fetch('/api/team-access', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                id: requestId.current,
                email,
                role,
                athleteId: role === 'player' ? athleteId : undefined,
              }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok)
              throw new Error(
                payload.error || 'Invitation could not be created.',
              );
            setEmail('');
            setAthleteId('');
            requestId.current = '';
            setNotice(
              `${role === 'staff' ? 'Staff' : 'Player'} invitation created. No email has been sent.`,
            );
          });
        }}
      >
        <label>
          Access role
          <NativeSelect
            disabled={busy}
            value={role}
            onChange={(event) => {
              setRole(event.target.value as 'staff' | 'player');
              setAthleteId('');
              requestId.current = '';
            }}
          >
            <NativeSelectOption value="staff">Staff</NativeSelectOption>
            <NativeSelectOption value="player">Player</NativeSelectOption>
          </NativeSelect>
        </label>
        <label>
          Sign-in email
          <input
            type="email"
            required
            maxLength={254}
            value={email}
            disabled={busy}
            onChange={(event) => {
              setEmail(event.target.value);
              requestId.current = '';
            }}
          />
        </label>
        {role === 'player' ? (
          <label>
            Roster profile
            <NativeSelect
              required
              disabled={busy || !roster}
              value={athleteId}
              onChange={(event) => {
                setAthleteId(event.target.value);
                requestId.current = '';
              }}
            >
              <NativeSelectOption value="">
                {roster
                  ? 'Choose the player’s saved profile'
                  : 'Loading roster…'}
              </NativeSelectOption>
              {roster?.map((athlete) => (
                <NativeSelectOption key={athlete.id} value={athlete.id}>
                  {athlete.name} · {athlete.unit}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {roster?.length === 0 ? (
              <span>Add the athlete to your roster first.</span>
            ) : null}
          </label>
        ) : null}
        <Button
          type="submit"
          disabled={busy || !email.trim() || (role === 'player' && !athleteId)}
        >
          Create {role} invitation
        </Button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => void mutate(async () => {})}
      >
        Refresh access
      </Button>
      {data ? (
        <>
          <h3>Team members</h3>
          {data.memberships.length ? (
            data.memberships.map((record) => (
              <div key={record.id}>
                <strong>{record.name || record.email}</strong>
                <p>
                  {record.email} · {record.role} · {record.status}
                </p>
                {record.status === 'active' ? (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setReview({ kind: 'membership', record })}
                  >
                    Revoke access
                  </Button>
                ) : null}
              </div>
            ))
          ) : (
            <p>No additional team members yet.</p>
          )}
          <details>
            <summary>Invitations ({data.invitations.length})</summary>
            {data.invitations.map((record) => (
              <div key={record.id}>
                <strong>{record.email}</strong>
                <p>
                  {record.role} · {record.status}
                  {record.expires_at
                    ? ` · Expires ${new Date(record.expires_at).toLocaleDateString()}`
                    : ''}
                </p>
                {record.status === 'pending' ? (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setReview({ kind: 'invitation', record })}
                  >
                    Revoke invitation
                  </Button>
                ) : null}
              </div>
            ))}
          </details>
        </>
      ) : (
        <p>Access list is unavailable until loading succeeds.</p>
      )}
      <Dialog
        open={Boolean(review)}
        onOpenChange={(open) => {
          if (!open && !busy) setReview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Revoke{' '}
              {review?.kind === 'membership' ? 'team access' : 'invitation'}?
            </DialogTitle>
            <DialogDescription>
              {review?.record.email}
              {review?.kind === 'membership'
                ? ' will lose access to this team. Their saved coaching work stays with the team.'
                : ' will no longer be able to accept this invitation.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy || !review}
              onClick={() => {
                const selected = review;
                if (!selected) return;
                void mutate(async () => {
                  const response = await fetch('/api/team-access', {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      kind: selected.kind,
                      id: selected.record.id,
                      version: selected.record.version,
                    }),
                  });
                  const payload = (await response.json()) as { error?: string };
                  if (!response.ok)
                    throw new Error(
                      payload.error || 'Access could not be revoked.',
                    );
                  setReview(null);
                  setNotice('Access revoked.');
                });
              }}
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

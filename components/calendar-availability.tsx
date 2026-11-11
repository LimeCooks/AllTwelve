'use client';
import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { readRosterAvailability } from '@/lib/roster-availability';
import type { AthleteMetrics } from '@/types/domain';

export function CalendarAvailability({
  onOpenRoster,
}: {
  onOpenRoster: () => void;
}) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; error: string }
    | { status: 'ready'; metrics: AthleteMetrics }
  >({ status: 'loading' });
  useEffect(() => {
    const request = new AbortController();
    setState({ status: 'loading' });
    readRosterAvailability(request.signal).then(
      (metrics) => {
        if (!request.signal.aborted) setState({ status: 'ready', metrics });
      },
      (failure: unknown) => {
        if (!request.signal.aborted)
          setState({
            status: 'error',
            error:
              failure instanceof Error
                ? failure.message
                : 'Roster availability is unavailable. Retry to check team status.',
          });
      },
    );
    return () => request.abort();
  }, [retry]);
  return (
    <section className="analytics-card" aria-label="Team availability">
      <div className="analytics-head">
        <div>
          <p className="eyebrow">Availability</p>
          <h3>Team status</h3>
        </div>
        <Users />
      </div>
      {state.status === 'loading' ? (
        <p role="status">Loading roster availability…</p>
      ) : state.status === 'error' ? (
        <div role="alert">
          <p>Availability unavailable</p>
          <p>{state.error}</p>
          <Button
            variant="outline"
            onClick={() => {
              setState({ status: 'loading' });
              setRetry((value) => value + 1);
            }}
          >
            Retry availability
          </Button>
        </div>
      ) : state.metrics.total === 0 ? (
        <p>No athletes on the saved roster yet.</p>
      ) : (
        <div className="availability-metrics">
          <span>
            <strong>{state.metrics.active}</strong>Available
          </span>
          <span>
            <strong>{state.metrics.limited}</strong>Limited
          </span>
          <span>
            <strong>{state.metrics.out}</strong>Out
          </span>
        </div>
      )}
      <Button className="w-full" onClick={onOpenRoster} variant="outline">
        View roster availability
      </Button>
    </section>
  );
}

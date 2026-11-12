'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { WorkspaceSelect } from '@/components/ui/select';
import { PracticePrintout } from '@/components/practice-printout';
import {
  readPracticePrintPlans,
  type PracticePlanRecord,
} from '@/lib/practice-print';

export function PracticePrintLibrary({
  teamName,
  onNavigate,
  onBusyChange,
}: {
  teamName: string;
  onNavigate: (view: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [plans, setPlans] = useState<PracticePlanRecord[]>([]),
    [selected, setSelected] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading'),
    [retry, setRetry] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    setError('');
    readPracticePrintPlans(controller.signal).then(
      (rows) => {
        if (controller.signal.aborted) return;
        setPlans(rows);
        setSelected((id) => (rows.some((plan) => plan.id === id) ? id : ''));
        setState('ready');
      },
      (failure) => {
        if (!controller.signal.aborted) {
          setState('error');
          setError(
            failure instanceof Error
              ? failure.message
              : 'Saved practices are unavailable.',
          );
        }
      },
    );
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  const plan = plans.find((plan) => plan.id === selected) ?? null;
  return (
    <section className="module-surface practice-print-library">
      <header className="teaching-printout-header">
        <div>
          <p className="eyebrow">Saved practice material</p>
          <h1>Practice scripts</h1>
          <p>
            Choose a saved practice to prepare its field-side PDF. Times,
            segment order and coaching notes come from that record.
          </p>
        </div>
      </header>
      {state === 'loading' ? (
        <p role="status">Loading saved practices…</p>
      ) : state === 'error' ? (
        <div role="alert">
          <p>{error}</p>
          <Button onClick={() => setRetry((value) => value + 1)}>
            Retry saved practices
          </Button>
        </div>
      ) : plans.length ? (
        <>
          <div className="practice-print-library-controls">
            <label htmlFor="practice-print-selection">
              Practice
              <WorkspaceSelect
                id="practice-print-selection"
                label="Choose practice to print"
                disabled={busy}
                value={selected}
                onChange={setSelected}
                options={[
                  { value: '', label: 'Choose a saved practice…' },
                  ...plans.map((record) => ({
                    value: record.id,
                    label: `${record.practiceDate} · ${record.title}`,
                  })),
                ]}
              />
            </label>
            <PracticePrintout
              plan={plan}
              teamName={teamName}
              disabled={busy}
              onBusyChange={setBusy}
              onReload={() => setRetry((value) => value + 1)}
            />
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRetry((value) => value + 1)}
            >
              Refresh saved practices
            </Button>
          </div>
          {plan ? (
            <p>
              {plan.blocks.length} saved segments · {plan.durationMinutes}{' '}
              segment minutes
              {plan.gameplanSource
                ? ` · Originally generated from ${plan.gameplanSource.title}`
                : ''}
            </p>
          ) : (
            <p>Choose the practice you want to print.</p>
          )}
          {plan && !plan.blocks.length ? (
            <p>
              Add and save a segment in Practice Plans before preparing its PDF.
            </p>
          ) : null}
        </>
      ) : (
        <div className="viewer-empty-state compact">
          <strong>No saved practices yet</strong>
          <span>
            Build a practice from a gameplan or create one in Practice Plans.
          </span>
          <Button
            variant="outline"
            onClick={() => onNavigate('Practice Plans')}
          >
            Open Practice Plans
          </Button>
        </div>
      )}
    </section>
  );
}

'use client';
import { workspaceFetch as fetch } from '@/lib/workspace-fetch';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  practiceGroupLabel,
  practicePrintRecord,
  practicePrintDate,
  practiceTimesOutOfOrder,
  readPracticePrintSnapshot,
  type PracticePlanRecord,
  type PracticePrintOptions,
} from '@/lib/practice-print';

export function PracticePrintout({
  plan: suppliedPlan,
  teamName,
  disabled,
  onBusyChange,
  onReload,
}: {
  plan: PracticePlanRecord | null;
  teamName: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onReload: () => void;
}) {
  const { plan, invalid } = useMemo(() => {
    try {
      return {
        plan: suppliedPlan ? practicePrintRecord(suppliedPlan) : null,
        invalid: '',
      };
    } catch (failure) {
      return {
        plan: null,
        invalid:
          failure instanceof Error
            ? failure.message
            : 'The saved practice could not be prepared.',
      };
    }
  }, [suppliedPlan]);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [url, setUrl] = useState('');
  const [options, setOptions] = useState<PracticePrintOptions>({
    paper: 'letter',
    landscape: false,
    notes: true,
  });
  const lock = useRef(false),
    mounted = useRef(true),
    request = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      onBusyChange(false);
    };
  }, [onBusyChange]);
  useEffect(() => {
    setUrl('');
    setError('');
  }, [plan?.id, plan?.version, options]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  const filename = `alltwelve-practice-${plan?.practiceDate ?? 'script'}.pdf`;
  const prepare = async () => {
    if (!plan || disabled || lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setUrl('');
    request.current = new AbortController();
    const controller = request.current;
    const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      const snapshot = await readPracticePrintSnapshot(plan, (input, init) =>
        fetch(input, { ...init, signal: controller.signal }),
      );
      window.clearTimeout(timer);
      const { createPracticePdf } = await import('@/lib/practice-pdf');
      const bytes = await createPracticePdf(snapshot, teamName, options);
      if (!mounted.current) return;
      setUrl(
        URL.createObjectURL(
          new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' }),
        ),
      );
    } catch (failure) {
      if (mounted.current)
        setError(
          controller.signal.aborted
            ? 'The saved practice check was interrupted or took too long. Retry to prepare the PDF.'
            : failure instanceof Error
              ? failure.message
              : 'The PDF could not be prepared. Your saved practice is unchanged.',
        );
    } finally {
      window.clearTimeout(timer);
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  };
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled || !suppliedPlan?.blocks.length}
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        <Printer /> Practice printout
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="practice-print-dialog">
          <DialogHeader>
            <DialogTitle>Practice printout</DialogTitle>
            <DialogDescription>
              Prepare the saved script as a PDF, then open it to print, save or
              share on your device. Your practice stays unchanged.
            </DialogDescription>
          </DialogHeader>
          <details className="practice-print-options">
            <summary>Print options</summary>
            <div>
              <label>
                Paper
                <NativeSelect
                  aria-label="Practice print paper"
                  disabled={busy}
                  value={options.paper}
                  onChange={(event) =>
                    setOptions((current) => ({
                      ...current,
                      paper: event.target.value as 'letter' | 'a4',
                    }))
                  }
                >
                  <NativeSelectOption value="letter">Letter</NativeSelectOption>
                  <NativeSelectOption value="a4">A4</NativeSelectOption>
                </NativeSelect>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.landscape}
                  disabled={busy}
                  onChange={(event) =>
                    setOptions((current) => ({
                      ...current,
                      landscape: event.target.checked,
                    }))
                  }
                />{' '}
                Landscape pages
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.notes}
                  disabled={busy}
                  onChange={(event) =>
                    setOptions((current) => ({
                      ...current,
                      notes: event.target.checked,
                    }))
                  }
                />{' '}
                Include coaching notes
              </label>
            </div>
          </details>
          {error || invalid ? (
            <div role="alert" className="practice-print-error">
              <p>{error || invalid}</p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  onReload();
                }}
              >
                Reload saved practice
              </Button>
            </div>
          ) : null}
          {busy ? (
            <p role="status">
              Checking the saved practice and preparing its PDF…
            </p>
          ) : null}
          {url ? (
            <p role="status" className="practice-pdf-ready">
              PDF ready.{' '}
              <a href={url} target="_blank" rel="noopener">
                Open PDF to print or share
              </a>
              <a href={url} download={filename}>
                Save PDF
              </a>
            </p>
          ) : null}
          {plan ? (
            <article
              className="practice-paper-preview"
              aria-label="Practice print preview"
            >
              <small>{teamName}</small>
              <h2>{plan.title}</h2>
              <p>
                {practicePrintDate(plan.practiceDate)} · {plan.durationMinutes}{' '}
                segment minutes · {plan.blocks.length} segments
              </p>
              {plan.gameplanSource ? (
                <p>
                  Source gameplan: {plan.gameplanSource.title} (recorded at
                  generation)
                </p>
              ) : null}
              <p>Times stay as entered. Total minutes exclude gaps.</p>
              {practiceTimesOutOfOrder(plan.blocks) ? (
                <p className="practice-print-warning">
                  Review timing: segment order differs from entered start times.
                </p>
              ) : null}
              {plan.blocks.map((block, index) => (
                <section key={index}>
                  <h3>
                    {index + 1}. {block[2]}
                  </h3>
                  <p>
                    Start: {block[0] === 'TBD' ? 'Not scheduled' : block[0]} ·{' '}
                    {block[1]} · {practiceGroupLabel(block[4]) || 'Team'}
                  </p>
                  {options.notes && block[3] ? (
                    <p className="practice-print-focus">{block[3]}</p>
                  ) : null}
                </section>
              ))}
            </article>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
            <Button
              disabled={busy || disabled || !plan?.blocks.length}
              onClick={() => void prepare()}
            >
              <Download /> {busy ? 'Preparing…' : 'Prepare PDF'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

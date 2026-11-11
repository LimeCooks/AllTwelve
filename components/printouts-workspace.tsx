'use client';
import { workspaceFetch as fetch } from '@/lib/workspace-fetch';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { PracticePrintLibrary } from '@/components/practice-print-library';
import { Download, Plus, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { PlayField } from '@/components/play-field';
import { printViewBox } from '@/lib/print-layout';
import { validatePlayDiagram } from '@/lib/validate-play';
import type { Library } from '@/lib/play-designer';
import type { TeachingPdfOptions } from '@/lib/teaching-pdf';

export function PrintoutsWorkspace({
  teamName,
  onNavigate,
  onEditingChange,
}: {
  teamName: string;
  onNavigate: (view: string) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [material, setMaterial] = useState('plays'),
    [busy, setBusy] = useState(false);
  const changing = useCallback(
    (value: boolean) => {
      setBusy(value);
      onEditingChange(value);
    },
    [onEditingChange],
  );
  return (
    <div>
      <label className="printouts-material">
        Print material
        <NativeSelect
          aria-label="Print material"
          value={material}
          disabled={busy}
          onChange={(event) => setMaterial(event.target.value)}
        >
          <NativeSelectOption value="plays">Saved plays</NativeSelectOption>
          <NativeSelectOption value="practice">
            Practice scripts
          </NativeSelectOption>
        </NativeSelect>
      </label>
      {material === 'practice' ? (
        <PracticePrintLibrary
          teamName={teamName}
          onNavigate={onNavigate}
          onBusyChange={changing}
        />
      ) : (
        <SavedPlayPrintouts
          onNavigate={onNavigate}
          onEditingChange={changing}
        />
      )}
    </div>
  );
}

function SavedPlayPrintouts({
  onNavigate,
  onEditingChange,
}: {
  onNavigate: (view: string) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [library, setLibrary] = useState<Library>({
    books: [],
    plays: [],
    formations: [],
  });
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
      'loading',
    ),
    [retry, setRetry] = useState(0),
    [error, setError] = useState('');
  const [ids, setIds] = useState<string[]>([]),
    [picker, setPicker] = useState(false),
    [query, setQuery] = useState(''),
    [unit, setUnit] = useState('All');
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [downloadUrl, setDownloadUrl] = useState('');
  const [options, setOptions] = useState<TeachingPdfOptions>({
    paper: 'letter',
    landscape: false,
    notes: true,
    assignments: true,
  });
  const articles = useRef(new Map<string, HTMLElement>()),
    lock = useRef(false),
    prefix = useId();
  const selected = ids
    .map((id) => library.plays.find((play) => play.id === id))
    .filter((play): play is Library['plays'][number] => Boolean(play));
  const visible = library.plays.filter(
    (play) =>
      (unit === 'All' || play.unit === unit) &&
      [
        play.name,
        play.unit,
        play.formation,
        library.books.find((book) => book.id === play.playbookId)?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/playbooks', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as Library & { error?: string };
        if (!response.ok)
          throw new Error(data.error || 'Unable to load saved plays.');
        if (
          !Array.isArray(data.plays) ||
          !Array.isArray(data.books) ||
          !data.books.every(
            (book) =>
              book &&
              typeof book.id === 'string' &&
              typeof book.name === 'string',
          ) ||
          !data.plays.every(
            (play) =>
              play &&
              typeof play.id === 'string' &&
              typeof play.name === 'string' &&
              typeof play.formation === 'string' &&
              typeof play.family === 'string' &&
              typeof play.concept === 'string' &&
              (play.notes === undefined || typeof play.notes === 'string'),
          ) ||
          new Set(data.plays.map((play) => play.id)).size !== data.plays.length
        )
          throw new Error(
            'The saved play library was incomplete. Please retry.',
          );
        for (const play of data.plays)
          validatePlayDiagram(play as unknown as Record<string, unknown>);
        if (controller.signal.aborted) return;
        setLibrary(data);
        setLoadState('ready');
        setError('');
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setLoadState('error');
          setError(
            failure instanceof Error
              ? failure.message
              : 'Unable to load saved plays.',
          );
        }
      });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    onEditingChange(busy);
    return () => onEditingChange(false);
  }, [busy, onEditingChange]);
  useEffect(() => {
    setDownloadUrl('');
  }, [ids, options]);
  useEffect(
    () => () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    },
    [downloadUrl],
  );
  const prepare = async () => {
    if (lock.current || !selected.length || loadState !== 'ready') return;
    lock.current = true;
    setBusy(true);
    setError('');
    setProgress(0);
    setDownloadUrl('');
    try {
      const sheets = selected.map((play) => ({
        play,
        svg:
          articles.current
            .get(play.id)
            ?.querySelector<SVGSVGElement>('.teaching-diagram .pd-field') ??
          null,
      }));
      if (
        sheets.some(
          (sheet) =>
            (sheet.play.players?.length ||
              sheet.play.routes?.length ||
              sheet.play.zones?.length ||
              sheet.play.labels?.length) &&
            !sheet.svg,
        )
      )
        throw new Error('A selected diagram is not ready. Please retry.');
      const { createTeachingPdf } = await import('@/lib/teaching-pdf');
      const bytes = await createTeachingPdf(sheets, options, setProgress);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' }),
      );
      setDownloadUrl(url);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'chalktalk-teaching-sheet.pdf';
      anchor.click();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to prepare this PDF. Your saved plays are unchanged.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const move = (index: number, direction: number) =>
    setIds((current) => {
      const next = [...current];
      [next[index], next[index + direction]] = [
        next[index + direction],
        next[index],
      ];
      return next;
    });
  return (
    <section className="module-surface teaching-printout">
      <style media="print">{`@page { size: ${options.paper === 'a4' ? 'A4' : 'Letter'} ${options.landscape ? 'landscape' : 'portrait'}; margin: 12mm; }`}</style>
      <header className="teaching-printout-header">
        <div>
          <p className="eyebrow">Saved teaching material</p>
          <h1>Printouts</h1>
          <p>
            Choose saved plays, arrange their order, and download a teaching
            PDF.
          </p>
        </div>
        <div>
          <Button
            variant="outline"
            disabled={busy || loadState !== 'ready'}
            onClick={() => setPicker(true)}
          >
            <Plus /> Choose plays
          </Button>
          <Button
            className="module-primary"
            disabled={busy || !selected.length || loadState !== 'ready'}
            onClick={() => void prepare()}
          >
            <Download />
            {busy
              ? `Preparing ${progress}/${selected.length}…`
              : 'Download PDF'}
          </Button>
        </div>
      </header>
      {error ? (
        <p className="pd-error" role="alert">
          {error}
          {loadState === 'error' ? (
            <Button
              variant="outline"
              onClick={() => {
                setLoadState('loading');
                setRetry((value) => value + 1);
              }}
            >
              Retry saved plays
            </Button>
          ) : null}
        </p>
      ) : null}
      {downloadUrl ? (
        <p className="teaching-download" role="status">
          PDF prepared.{' '}
          <a
            href={downloadUrl}
            download="chalktalk-teaching-sheet.pdf"
            target="_blank"
            rel="noopener"
          >
            Open or download the PDF
          </a>{' '}
          if your browser did not open it.
        </p>
      ) : null}
      {loadState === 'loading' ? (
        <output>Loading saved plays…</output>
      ) : loadState === 'ready' ? (
        <>
          <details className="teaching-options">
            <summary>PDF and print options</summary>
            <div>
              <label htmlFor="teaching-paper">
                Paper
                <NativeSelect
                  id="teaching-paper"
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
              {(['landscape', 'notes', 'assignments'] as const).map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={options[key]}
                    disabled={busy}
                    onChange={(event) =>
                      setOptions((current) => ({
                        ...current,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                  {key === 'landscape'
                    ? 'Landscape pages'
                    : key === 'notes'
                      ? 'Include coaching notes'
                      : 'Include assignments'}
                </label>
              ))}
              <Button
                variant="outline"
                disabled={busy || !selected.length}
                onClick={() => {
                  try {
                    window.print();
                  } catch {
                    setError(
                      'Browser printing is unavailable here. Use Download PDF instead.',
                    );
                  }
                }}
              >
                <Printer /> Browser print
              </Button>
              <Button
                variant="ghost"
                disabled={busy || !selected.length}
                onClick={() => setIds([])}
              >
                Clear selection
              </Button>
            </div>
            <p>
              Up to 25 plays per PDF. Selection is temporary; your saved plays
              stay unchanged.
            </p>
          </details>
          {selected.length ? (
            <p className="teaching-selection-count">
              {selected.length} saved {selected.length === 1 ? 'play' : 'plays'}{' '}
              selected
            </p>
          ) : (
            <div className="viewer-empty-state compact">
              <Printer />
              <strong>
                {library.plays.length
                  ? 'Choose plays for your teaching sheet'
                  : 'No saved plays yet'}
              </strong>
              <span>
                {library.plays.length
                  ? 'Select the saved plays you want to print.'
                  : 'Create and save a play in Playbook before exporting.'}
              </span>
              {!library.plays.length ? (
                <Button
                  variant="outline"
                  onClick={() => onNavigate('Playbook')}
                >
                  Open Playbook
                </Button>
              ) : null}
            </div>
          )}
          <div className="teaching-sheets">
            {selected.map((play, index) => {
              const hasDiagram = Boolean(
                play.players?.length ||
                play.routes?.length ||
                play.zones?.length ||
                play.labels?.length ||
                (play.showOpponent && play.opponentPlayers?.length),
              );
              return (
                <article
                  key={play.id}
                  ref={(node) => {
                    if (node) articles.current.set(play.id, node);
                    else articles.current.delete(play.id);
                  }}
                >
                  <header>
                    <div>
                      <small>
                        Play {index + 1} of {selected.length}
                      </small>
                      <h2>{play.name}</h2>
                      <p>
                        {[
                          play.unit,
                          play.formation,
                          play.family === 'Unassigned' ? '' : play.family,
                        ]
                          .filter(Boolean)
                          .join(' / ')}
                      </p>
                    </div>
                    <details className="teaching-order">
                      <summary>Selection options</summary>
                      <Button
                        disabled={busy || index === 0}
                        variant="ghost"
                        onClick={() => move(index, -1)}
                      >
                        Move earlier
                      </Button>
                      <Button
                        disabled={busy || index === selected.length - 1}
                        variant="ghost"
                        onClick={() => move(index, 1)}
                      >
                        Move later
                      </Button>
                      <Button
                        disabled={busy}
                        variant="ghost"
                        onClick={() =>
                          setIds((current) =>
                            current.filter((id) => id !== play.id),
                          )
                        }
                      >
                        Remove from sheet
                      </Button>
                    </details>
                  </header>
                  {hasDiagram ? (
                    <div className="teaching-diagram">
                      <PlayField
                        drawing={play}
                        name={play.name}
                        printMode
                        viewportOverride={printViewBox(play)}
                      />
                    </div>
                  ) : (
                    <p className="teaching-no-diagram">
                      No diagram saved for this play.
                    </p>
                  )}
                  {options.notes && play.notes ? (
                    <section>
                      <h3>Coaching notes</h3>
                      <p>{play.notes}</p>
                    </section>
                  ) : null}
                  {options.assignments && play.assignments?.length ? (
                    <section>
                      <h3>Position assignments</h3>
                      {play.assignments.map((assignment) => (
                        <p key={assignment.id}>
                          <strong>
                            {assignment.position}: {assignment.title}
                          </strong>
                          <br />
                          {assignment.detail}
                        </p>
                      ))}
                    </section>
                  ) : null}
                </article>
              );
            })}
          </div>
        </>
      ) : null}
      <Dialog
        open={picker}
        onOpenChange={(open) => {
          if (!busy) setPicker(open);
        }}
      >
        <DialogContent className="athlete-dialog teaching-picker">
          <DialogHeader>
            <DialogTitle>Choose saved plays</DialogTitle>
            <DialogDescription>
              Selected plays appear in the order you choose them. Add up to 25.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Search plays to print"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search plays, formations, or playbooks…"
          />
          <NativeSelect
            aria-label="Filter printouts by unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          >
            {['All', 'Offence', 'Defence', 'Special teams'].map((value) => (
              <NativeSelectOption key={value} value={value}>
                {value}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <div>
            {visible.map((play) => (
              <label key={play.id} htmlFor={`${prefix}-${play.id}`}>
                <input
                  id={`${prefix}-${play.id}`}
                  type="checkbox"
                  checked={ids.includes(play.id)}
                  disabled={
                    busy || (!ids.includes(play.id) && ids.length >= 25)
                  }
                  onChange={(event) =>
                    setIds((current) =>
                      event.target.checked
                        ? [...current, play.id]
                        : current.filter((id) => id !== play.id),
                    )
                  }
                />
                <span>
                  <strong>{play.name}</strong>
                  <small>
                    {[
                      play.unit,
                      library.books.find((book) => book.id === play.playbookId)
                        ?.name,
                      play.formation,
                    ]
                      .filter(Boolean)
                      .join(' / ')}
                  </small>
                </span>
              </label>
            ))}
            {!visible.length ? (
              <p>No saved plays match these filters.</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button onClick={() => setPicker(false)}>
              Done · {ids.length} selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

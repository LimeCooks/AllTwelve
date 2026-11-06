'use client';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Copy,
  Pencil,
  Plus,
  Printer,
  Settings,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { PlayDesigner } from '@/components/play-designer';
import { PlayField } from '@/components/play-field';
import { type Library, type Side } from '@/lib/play-designer';

type Review = { athleteId: string; name: string; acknowledged: boolean };
type Pack = { id: string; name: string; publishedAt: string | null };
export function PlaybookWorkspace({
  view = 'Playbook',
  onNavigate,
  onEditingChange,
}: {
  view?: string;
  onNavigate: (view: string) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [data, setData] = useState<Library>({
    books: [],
    formations: [],
    plays: [],
  });
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [bookId, setBookId] = useState(''),
    [query, setQuery] = useState(''),
    [side, setSide] = useState<Side>('Offence'),
    [scope, setScope] = useState('team');
  const [opponentFilter, setOpponentFilter] = useState(''),
    [packageFilter, setPackageFilter] = useState('');
  const [editor, setEditor] = useState<{
    kind: 'play' | 'formation';
    id: string;
  } | null>(null);
  const [viewerId, setViewerId] = useState('');
  const [dialog, setDialog] = useState<
    | 'book'
    | 'play'
    | 'formation'
    | 'book-settings'
    | 'delete-play'
    | 'delete-formation'
    | 'delete-book'
    | null
  >(null);
  const [deletingId, setDeletingId] = useState('');
  const [printIds, setPrintIds] = useState<string[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]),
    [reviews, setReviews] = useState<Review[]>([]);
  const [draftInstalls, setDraftInstalls] = useState<Pack[]>([]),
    [destination, setDestination] = useState('');
  const book = data.books.find((item) => item.id === bookId);
  const editedPlay =
    editor?.kind === 'play'
      ? data.plays.find((item) => item.id === editor.id)
      : undefined;
  const editedFormation =
    editor?.kind === 'formation'
      ? data.formations.find((item) => item.id === editor.id)
      : undefined;
  const viewed = data.plays.find((item) => item.id === viewerId);
  const request = async (
    method: string,
    payload?: Record<string, unknown>,
  ): Promise<Library> => {
    const response = await fetch('/api/playbooks', {
      method,
      cache: 'no-store',
      ...(payload
        ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }
        : {}),
    });
    const result = (await response.json()) as Library & { error?: string };
    if (!response.ok)
      throw new Error(result.error || 'Unable to save the playbook.');
    return result;
  };
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/playbooks', { cache: 'no-store' });
      const next = (await response.json()) as Library & { error?: string };
      if (!response.ok)
        throw new Error(next.error || 'Unable to load playbooks.');
      setData(next);
      setError('');
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to load playbooks.',
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);
  useEffect(() => {
    if (!viewerId) return;
    let active = true;
    fetch('/api/install')
      .then(async (response) => {
        const result = (await response.json()) as {
          packages: Pack[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error || 'Unable to load installs.');
        return result;
      })
      .then((result) => {
        if (active)
          setDraftInstalls(result.packages.filter((pack) => !pack.publishedAt));
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Unable to load installs.',
          );
      });
    return () => {
      active = false;
    };
  }, [viewerId]);
  const addToInstall = async () => {
    if (!destination || !viewerId || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packageId: destination, playId: viewerId }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error || 'Unable to add play to install.');
      setNotice('Saved play added to the selected draft install.');
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to add play to install.',
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!['Learn', 'Leaderboard'].includes(view)) return;
    fetch('/api/install')
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load learning records.');
        return (await response.json()) as { packages: Pack[] };
      })
      .then(async (result) => {
        const published = result.packages.filter((pack) => pack.publishedAt);
        setPacks(published);
        const records = await Promise.all(
          published.map(async (pack) => {
            const response = await fetch(
              `/api/install?packageId=${encodeURIComponent(pack.id)}`,
            );
            const result = (await response.json()) as { reviews: Review[] };
            if (!response.ok) throw new Error('Unable to load review results.');
            return result.reviews;
          }),
        );
        setReviews(records.flat());
      })
      .catch((failure: unknown) =>
        setError(
          failure instanceof Error
            ? failure.message
            : 'Unable to load learning records.',
        ),
      );
  }, [view]);
  const mutate = async (
    method: string,
    payload: Record<string, unknown>,
    done?: (next: Library) => void,
  ) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await request(method, payload);
      setData(next);
      setDialog(null);
      done?.(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save.');
    } finally {
      setBusy(false);
    }
  };
  const create = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget),
      values = Object.fromEntries(fields.entries());
    if (dialog === 'book')
      void mutate(
        'POST',
        { kind: 'book', name: values.name, side: values.side },
        (next) => {
          const created = next.books.find(
            (item) => !data.books.some((old) => old.id === item.id),
          );
          if (created) setBookId(created.id);
        },
      );
    if (dialog === 'book-settings')
      void mutate('PUT', {
        kind: 'book',
        id: bookId,
        name: values.name,
        side: book?.side,
        archived: values.archived === 'on',
      });
    if (dialog === 'play')
      void mutate(
        'POST',
        {
          kind: 'play',
          playbookId: bookId,
          name: values.name,
          concept: values.concept || values.name,
          formationId: values.formationId || null,
          family: values.family || 'Unassigned',
        },
        (next) => {
          if (next.createdId) setEditor({ kind: 'play', id: next.createdId });
        },
      );
    if (dialog === 'formation')
      void mutate(
        'POST',
        {
          kind: 'formation',
          name: values.name,
          unit: side,
          scope,
          opponent: values.opponent || '',
          packageName: values.packageName || '',
          personnel: values.packageName || 'Custom personnel',
        },
        (next) => {
          if (next.createdId)
            setEditor({ kind: 'formation', id: next.createdId });
        },
      );
  };
  const visibleFormations = data.formations.filter(
    (f) =>
      f.unit === side &&
      (f.scope ?? 'team') === scope &&
      (!opponentFilter || f.opponent === opponentFilter) &&
      (!packageFilter || f.packageName === packageFilter) &&
      `${f.name} ${f.opponent} ${f.packageName}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const visiblePlays = data.plays.filter(
    (p) =>
      p.playbookId === bookId &&
      `${p.name} ${p.formation} ${p.concept}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const ownFormations = data.formations.filter(
    (f) => f.scope !== 'scout' && f.unit === book?.side,
  );
  if (editor && (editedPlay || editedFormation))
    return (
      <PlayDesigner
        key={`${editor.kind}:${editor.id}`}
        play={editedPlay}
        formation={editedFormation}
        formations={data.formations}
        onEditingChange={onEditingChange}
        onBack={() => {
          setEditor(null);
          onEditingChange(false);
        }}
        onSave={async (payload) => {
          const next = await request('PUT', { ...payload, kind: editor.kind });
          setData(next);
          setNotice(`${String(payload.name)} saved.`);
        }}
      />
    );

  return (
    <section className="module-surface pd-workspace">
      {error ? (
        <div className="pd-error" role="alert">
          {error}
          <Button onClick={() => void refresh()} size="sm" variant="outline">
            Retry
          </Button>
        </div>
      ) : null}
      {notice ? <output className="pd-notice">{notice}</output> : null}
      {loading ? (
        <p className="pd-empty">Loading saved work…</p>
      ) : view === 'Formations' ? (
        <>
          <header className="pd-library-header">
            <div>
              <h1>Formations</h1>
              <p>Saved alignments, your terminology, your packages.</p>
            </div>
            <Button
              onClick={() => {
                setError('');
                setDialog('formation');
              }}
            >
              <Plus /> New formation
            </Button>
          </header>
          <div className="pd-library-filters">
            <div className="segmented-control">
              {(['Offence', 'Defence', 'Special teams'] as Side[]).map(
                (value) => (
                  <button
                    className={side === value ? 'active' : ''}
                    key={value}
                    onClick={() => {
                      setSide(value);
                      setOpponentFilter('');
                      setPackageFilter('');
                    }}
                    type="button"
                  >
                    {value}
                  </button>
                ),
              )}
            </div>
            <NativeSelect
              aria-label="Formation owner"
              value={scope}
              onChange={(event) => {
                setScope(event.target.value);
                setOpponentFilter('');
                setPackageFilter('');
              }}
            >
              <NativeSelectOption value="team">Our team</NativeSelectOption>
              <NativeSelectOption value="scout">
                Opponent / scout
              </NativeSelectOption>
            </NativeSelect>
            <Input
              aria-label="Search formations"
              placeholder="Search formations…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <details className="pd-filter-menu">
              <summary>Filters</summary>
              <NativeSelect
                aria-label="Filter opponent"
                value={opponentFilter}
                onChange={(event) => setOpponentFilter(event.target.value)}
              >
                <NativeSelectOption value="">All opponents</NativeSelectOption>
                {Array.from(
                  new Set(
                    data.formations
                      .filter((f) => f.unit === side && f.scope === scope)
                      .map((f) => f.opponent)
                      .filter(Boolean),
                  ),
                ).map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {value}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Filter package"
                value={packageFilter}
                onChange={(event) => setPackageFilter(event.target.value)}
              >
                <NativeSelectOption value="">All packages</NativeSelectOption>
                {Array.from(
                  new Set(
                    data.formations
                      .filter((f) => f.unit === side && f.scope === scope)
                      .map((f) => f.packageName)
                      .filter(Boolean),
                  ),
                ).map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {value}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </details>
          </div>
          <div className="pd-card-grid">
            {visibleFormations.map((f) => (
              <article className="pd-library-card" key={f.id}>
                <button
                  className="pd-card-open"
                  onClick={() => setEditor({ kind: 'formation', id: f.id })}
                  type="button"
                >
                  <PlayField drawing={f} name={f.name} heightYards={60} />
                  <strong>{f.name}</strong>
                  <span>
                    {f.scope === 'scout' ? f.opponent : 'Our team'}
                    {f.packageName ? ` · ${f.packageName}` : ''}
                  </span>
                </button>
                <details>
                  <summary>Actions</summary>
                  <Button
                    onClick={() =>
                      void mutate(
                        'POST',
                        {
                          kind: 'formation',
                          ...f,
                          id: undefined,
                          name: `${f.name} — copy`,
                        },
                        (next) => {
                          if (next.createdId)
                            setEditor({
                              kind: 'formation',
                              id: next.createdId,
                            });
                        },
                      )
                    }
                    size="sm"
                    variant="ghost"
                  >
                    <Copy /> Duplicate
                  </Button>
                  <Button
                    onClick={() => {
                      setDeletingId(f.id);
                      setDialog('delete-formation');
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    <Trash2 /> Delete
                  </Button>
                </details>
              </article>
            ))}
          </div>
          {!visibleFormations.length ? (
            <div className="pd-empty">
              <h2>No saved {side.toLowerCase()} formations</h2>
              <p>
                Create a team alignment or a named opponent’s look. Package
                names are optional and entirely yours.
              </p>
            </div>
          ) : null}
        </>
      ) : view === 'Printouts' ? (
        <>
          <header className="pd-library-header">
            <div>
              <h1>Printouts</h1>
              <p>Select saved plays for a printable teaching sheet.</p>
            </div>
            <Button disabled={!printIds.length} onClick={() => window.print()}>
              <Printer /> Print {printIds.length || ''}
            </Button>
          </header>
          <div className="pd-print-picker">
            {data.plays.map((p) => (
              <label key={p.id} htmlFor="pw-control-1">
                <input
                  id="pw-control-1"
                  type="checkbox"
                  checked={printIds.includes(p.id)}
                  onChange={(event) =>
                    setPrintIds((ids) =>
                      event.target.checked
                        ? [...ids, p.id]
                        : ids.filter((id) => id !== p.id),
                    )
                  }
                />
                {p.name}
                <span>{p.unit}</span>
              </label>
            ))}
          </div>
          <div className="pd-print-sheets">
            {data.plays
              .filter((p) => printIds.includes(p.id))
              .map((p) => (
                <article key={p.id}>
                  <h2>{p.name}</h2>
                  <p>
                    {p.unit} · {p.formation}
                  </p>
                  <PlayField drawing={p} name={p.name} heightYards={60} />
                  <p>{p.notes}</p>
                  {p.assignments?.map((a) => (
                    <p key={a.id}>
                      <strong>
                        {a.position}: {a.title}
                      </strong>{' '}
                      {a.detail}
                    </p>
                  ))}
                </article>
              ))}
          </div>
          {!data.plays.length ? (
            <p className="pd-empty">
              Save plays in Playbook before creating printouts.
            </p>
          ) : null}
        </>
      ) : view === 'Learn' ? (
        <>
          <header className="pd-library-header">
            <div>
              <h1>Learn</h1>
              <p>Published teaching packages from your coaches.</p>
            </div>
          </header>
          {packs.map((p) => (
            <button
              className="pd-learning-pack"
              key={p.id}
              onClick={() => onNavigate('Install')}
              type="button"
            >
              <BookOpen />
              <span>{p.name}</span>
              <span>Open installs</span>
            </button>
          ))}
          <div className="pd-empty">
            <p>
              {packs.length
                ? 'Player review and completion require a linked player account.'
                : 'No published learning packages yet. Build one in Install.'}
            </p>
            <Button onClick={() => onNavigate('Install')} variant="outline">
              Open installs
            </Button>
          </div>
        </>
      ) : view === 'Leaderboard' ? (
        <>
          <header className="pd-library-header">
            <div>
              <h1>Leaderboard</h1>
              <p>Actual install review completion across published packages.</p>
            </div>
          </header>
          {reviews.length ? (
            <table className="pd-results">
              <thead>
                <tr>
                  <th>Athlete</th>
                  <th>Completed</th>
                  <th>Assigned</th>
                  <th>Completion</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(
                  reviews.reduce<
                    Record<
                      string,
                      {
                        id: string;
                        name: string;
                        complete: number;
                        total: number;
                      }
                    >
                  >((group, r) => {
                    const value = group[r.athleteId] ?? {
                      id: r.athleteId,
                      name: r.name,
                      complete: 0,
                      total: 0,
                    };
                    value.total++;
                    value.complete += Number(r.acknowledged);
                    group[r.athleteId] = value;
                    return group;
                  }, {}),
                )
                  .sort(
                    (a, b) =>
                      b.complete / b.total - a.complete / a.total ||
                      a.name.localeCompare(b.name),
                  )
                  .map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td>{r.complete}</td>
                      <td>{r.total}</td>
                      <td>{Math.round((r.complete / r.total) * 100)}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <p className="pd-empty">
              No review results yet. Scores appear only after real assignments
              and reviews exist.
            </p>
          )}
        </>
      ) : viewed ? (
        <>
          <header className="pd-library-header">
            <Button onClick={() => setViewerId('')} variant="ghost">
              <ArrowLeft /> Plays
            </Button>
            <div>
              <h1>{viewed.name}</h1>
              <p>
                {viewed.unit} · {viewed.formation}
              </p>
            </div>
            <Button
              disabled={busy}
              onClick={() =>
                void mutate(
                  'POST',
                  { kind: 'duplicate', id: viewed.id },
                  (next) => {
                    if (next.createdId)
                      setEditor({ kind: 'play', id: next.createdId });
                  },
                )
              }
              variant="outline"
            >
              <Copy /> Duplicate
            </Button>
            <Button
              disabled={viewed.locked}
              onClick={() => setEditor({ kind: 'play', id: viewed.id })}
            >
              <Pencil /> Edit
            </Button>
          </header>
          {viewed.locked ? (
            <p className="pd-notice">
              Published teaching content is locked. Duplicate the play to revise
              it.
            </p>
          ) : null}
          <div className="pd-saved-preview">
            <PlayField drawing={viewed} name={viewed.name} heightYards={60} />
          </div>
          <details className="pd-saved-details">
            <summary>Add to install</summary>
            <div className="pd-install-destination">
              <NativeSelect
                aria-label="Destination draft install"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              >
                <NativeSelectOption value="">
                  Choose a draft…
                </NativeSelectOption>
                {draftInstalls.map((pack) => (
                  <NativeSelectOption key={pack.id} value={pack.id}>
                    {pack.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                disabled={!destination || busy}
                onClick={() => void addToInstall()}
              >
                Add saved play
              </Button>
              <Button onClick={() => onNavigate('Install')} variant="outline">
                Manage installs
              </Button>
            </div>
          </details>
          <details className="pd-saved-details">
            <summary>Teaching details</summary>
            <p>{viewed.concept}</p>
            <p>{viewed.notes}</p>
            {viewed.assignments?.map((a) => (
              <p key={a.id}>
                {a.position} · {a.title}: {a.detail}
              </p>
            ))}
            <Button
              disabled={viewed.locked}
              onClick={() => {
                setDeletingId(viewed.id);
                setDialog('delete-play');
              }}
              variant="outline"
            >
              <Trash2 /> Delete play
            </Button>
          </details>
        </>
      ) : book ? (
        <>
          <header className="pd-library-header">
            <Button
              onClick={() => {
                setBookId('');
                setQuery('');
              }}
              variant="ghost"
            >
              <ArrowLeft /> Playbooks
            </Button>
            <div>
              <h1>{book.name}</h1>
              <p>
                {book.side} · {visiblePlays.length} plays
              </p>
            </div>
            <Button
              aria-label="Playbook settings"
              onClick={() => setDialog('book-settings')}
              size="icon"
              variant="outline"
            >
              <Settings />
            </Button>
            <Button onClick={() => setDialog('play')}>
              <Plus /> New play
            </Button>
          </header>
          <Input
            className="pd-search"
            aria-label="Search plays"
            placeholder="Search plays…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="pd-card-grid">
            {visiblePlays.map((p) => (
              <article className="pd-library-card" key={p.id}>
                <button
                  className="pd-card-open"
                  onClick={() => setViewerId(p.id)}
                  type="button"
                >
                  <PlayField drawing={p} name={p.name} heightYards={60} />
                  <strong>{p.name}</strong>
                  <span>
                    {p.formation}
                    {p.locked ? ' · Published' : ''}
                  </span>
                </button>
              </article>
            ))}
          </div>
          {!visiblePlays.length ? (
            <p className="pd-empty">
              Create a play using a saved team formation or the{' '}
              {book.side.toLowerCase()} starting alignment.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <header className="pd-library-header">
            <div>
              <h1>Playbook</h1>
              <p>Your team systems and saved plays.</p>
            </div>
            <Button onClick={() => setDialog('book')}>
              <Plus /> New playbook
            </Button>
          </header>
          <div className="pd-books">
            {data.books
              .filter((b) => !b.archived)
              .map((b) => (
                <button
                  key={b.id}
                  onClick={() => setBookId(b.id)}
                  type="button"
                >
                  <BookOpen />
                  <span>
                    <strong>{b.name}</strong>
                    <small>
                      {b.side} · {b.plays} plays
                    </small>
                  </span>
                  <span>Open</span>
                </button>
              ))}
          </div>
          <details className="pd-archive">
            <summary>
              Archived playbooks ({data.books.filter((b) => b.archived).length})
            </summary>
            {data.books
              .filter((b) => b.archived)
              .map((b) => (
                <Button
                  key={b.id}
                  onClick={() => setBookId(b.id)}
                  variant="outline"
                >
                  {b.name}
                </Button>
              ))}
          </details>
          {!data.books.length ? (
            <p className="pd-empty">
              Create your first playbook, then choose a formation to start
              drawing.
            </p>
          ) : null}
        </>
      )}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <DialogContent className="athlete-dialog pd-library-dialog">
          <DialogHeader>
            <DialogTitle>
              {dialog?.startsWith('delete')
                ? 'Delete this record?'
                : dialog === 'book-settings'
                  ? 'Playbook settings'
                  : dialog === 'book'
                    ? 'New playbook'
                    : dialog === 'formation'
                      ? `New ${side.toLowerCase()} formation`
                      : 'New play'}
            </DialogTitle>
            <DialogDescription>
              {dialog?.startsWith('delete')
                ? 'This cannot be undone. Plays used in installs and formations used by plays are protected.'
                : dialog === 'formation'
                  ? `${scope === 'scout' ? 'Opponent / scout' : 'Our team'} · Name the alignment and optional personnel package in your own terms.`
                  : 'Start from a saved alignment, then draw and save the teaching details.'}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="pd-error" role="alert">
              {error}
            </p>
          ) : null}
          {dialog?.startsWith('delete') ? (
            <DialogFooter>
              <Button onClick={() => setDialog(null)} variant="outline">
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void mutate(
                    'DELETE',
                    { kind: dialog.replace('delete-', ''), id: deletingId },
                    () => {
                      setViewerId('');
                      if (dialog === 'delete-book') setBookId('');
                    },
                  )
                }
                variant="destructive"
              >
                Delete
              </Button>
            </DialogFooter>
          ) : (
            <form onSubmit={create}>
              <div className="athlete-form-grid">
                <label className="full" htmlFor="pw-control-2">
                  Name
                  <Input
                    id="pw-control-2"
                    aria-label="New record name"
                    name="name"
                    defaultValue={dialog === 'book-settings' ? book?.name : ''}
                    required
                  />
                </label>
                {dialog === 'book' ? (
                  <label className="full" htmlFor="pw-control-3">
                    Side
                    <NativeSelect
                      id="pw-control-3"
                      aria-label="New playbook side"
                      name="side"
                      defaultValue="Offence"
                    >
                      {['Offence', 'Defence', 'Special teams'].map((s) => (
                        <NativeSelectOption key={s} value={s}>
                          {s}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                ) : null}
                {dialog === 'play' ? (
                  <>
                    <label className="full" htmlFor="pw-control-4">
                      Formation
                      <NativeSelect
                        id="pw-control-4"
                        aria-label="Starting formation"
                        name="formationId"
                      >
                        <NativeSelectOption value="">
                          {book?.side} starting alignment
                        </NativeSelectOption>
                        {ownFormations.map((f) => (
                          <NativeSelectOption key={f.id} value={f.id}>
                            {f.name}
                            {f.packageName ? ` · ${f.packageName}` : ''}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                    <label className="full" htmlFor="pw-control-5">
                      Concept (optional)
                      <Input
                        id="pw-control-5"
                        aria-label="New play concept"
                        name="concept"
                      />
                    </label>
                  </>
                ) : null}
                {dialog === 'formation' ? (
                  <>
                    {scope === 'scout' ? (
                      <label className="full" htmlFor="pw-control-6">
                        Opponent
                        <Input
                          id="pw-control-6"
                          aria-label="New scout opponent"
                          name="opponent"
                          placeholder="NKEC"
                          required
                        />
                      </label>
                    ) : null}
                    <label className="full" htmlFor="pw-control-7">
                      Package (optional)
                      <Input
                        id="pw-control-7"
                        aria-label="New formation package"
                        name="packageName"
                        placeholder="Your terminology: Jumbo, Nascar…"
                      />
                    </label>
                  </>
                ) : null}
                {dialog === 'book-settings' ? (
                  <label className="full form-checkbox" htmlFor="pw-control-8">
                    <input
                      id="pw-control-8"
                      name="archived"
                      type="checkbox"
                      defaultChecked={book?.archived}
                    />{' '}
                    Archived
                  </label>
                ) : null}
              </div>
              <DialogFooter>
                {dialog === 'book-settings' ? (
                  <Button
                    onClick={() => {
                      setDeletingId(bookId);
                      setDialog('delete-book');
                    }}
                    type="button"
                    variant="destructive"
                  >
                    <Trash2 /> Delete
                  </Button>
                ) : null}
                <Button disabled={busy} type="submit">
                  {busy
                    ? 'Saving…'
                    : dialog === 'book-settings'
                      ? 'Save'
                      : 'Create & open'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

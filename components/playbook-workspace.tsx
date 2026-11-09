'use client';
import { workspaceFetch as fetch } from '@/lib/workspace-fetch';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import { parsePlaybookLibrary } from '@/lib/playbook-library';
import {
  loadInstallDestinations,
  addSavedPlayToInstall,
} from '@/lib/playbook-install';
import type { InstallPackage } from '@/lib/install-data';
import {
  ArrowLeft,
  BookOpen,
  Copy,
  Pencil,
  Plus,
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
  initialPlayId = '',
  onNavigate,
  onOpenInstall,
  onEditingChange,
}: {
  view?: string;
  initialPlayId?: string;
  onNavigate: (view: string) => void;
  onOpenInstall: (id: string) => void;
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
  const [viewerId, setViewerId] = useState(initialPlayId);
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
  const deleteTarget = useRef<{ version?: string; name: string }>({ name: '' });
  const [editorEpoch, setEditorEpoch] = useState(0);
  const mutationLock = useRef(false);
  const settingsVersion = useRef<string | undefined>(undefined);
  const creationIds = useRef(new Map<string, string>());
  const [loadFailed, setLoadFailed] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [discardRequested, setDiscardRequested] = useState(false);
  useEffect(() => {
    if (editor) return;
    onEditingChange(formDirty || busy);
    const guard = (event: BeforeUnloadEvent) => {
      if (!formDirty && !busy) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => {
      window.removeEventListener('beforeunload', guard);
      onEditingChange(false);
    };
  }, [editor, formDirty, busy, onEditingChange]);
  const closeDialog = () => {
    if (mutationLock.current) return;
    if (formDirty) {
      setDiscardRequested(true);
      return;
    }
    setDialog(null);
  };
  const [packs, setPacks] = useState<Pack[]>([]),
    [reviews, setReviews] = useState<Review[]>([]);
  const [installChoices, setInstallChoices] = useState<{
    source: string;
    status: 'loading' | 'ready' | 'error';
    packages: InstallPackage[];
    error: string;
  }>({ source: '', status: 'loading', packages: [], error: '' });
  const [destination, setDestination] = useState('');
  const [installReload, setInstallReload] = useState(0);
  const [installFeedback, setInstallFeedback] = useState<{
    source: string;
    error: string;
    notice: string;
  }>({ source: '', error: '', notice: '' });
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
  const installSource = viewed ? `${viewed.id}:${viewed.unit}` : '';
  const installReady = Boolean(
    installSource &&
    installChoices.source === installSource &&
    installChoices.status === 'ready',
  );
  const request = async (
    method: string,
    payload?: Record<string, unknown>,
  ): Promise<Library> => {
    const fingerprint = method === 'POST' ? JSON.stringify(payload) : '';
    if (fingerprint) {
      let creationId = creationIds.current.get(fingerprint);
      if (!creationId) {
        creationId = crypto.randomUUID();
        creationIds.current.set(fingerprint, creationId);
      }
      payload = { ...payload, creationId };
    }
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
    const next = parsePlaybookLibrary(result);
    if (method === 'DELETE') {
      const records =
        payload?.kind === 'book'
          ? next.books
          : payload?.kind === 'formation'
            ? next.formations
            : next.plays;
      if (records.some((record) => record.id === payload?.id))
        throw new Error(
          'Deletion could not be confirmed. Close this dialog and reload before retrying.',
        );
    }
    if (method === 'POST') {
      const records =
        payload?.kind === 'book'
          ? next.books
          : payload?.kind === 'formation'
            ? next.formations
            : next.plays;
      if (
        !next.createdId ||
        !records.some((record) => record.id === next.createdId)
      )
        throw new Error(
          'The created record could not be confirmed. Retry with the same details.',
        );
      creationIds.current.delete(fingerprint);
    }
    return next;
  };
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/playbooks', { cache: 'no-store' });
      const result = (await response.json()) as Library & { error?: string };
      if (!response.ok)
        throw new Error(result.error || 'Unable to load playbooks.');
      const next = parsePlaybookLibrary(result);
      setData(next);
      setLoadFailed(false);
      setError(
        initialPlayId && !next.plays.some((play) => play.id === initialPlayId)
          ? 'That play is no longer available.'
          : '',
      );
    } catch (failure) {
      setLoadFailed(true);
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to load playbooks.',
      );
    } finally {
      setLoading(false);
    }
  }, [initialPlayId]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setDestination('');
    setInstallChoices({
      source: installSource,
      status: 'loading',
      packages: [],
      error: '',
    });
    if (!installSource || !viewed) return () => controller.abort();
    void loadInstallDestinations(viewed.unit ?? '', controller.signal)
      .then((packages) => {
        if (!controller.signal.aborted)
          setInstallChoices({
            source: installSource,
            status: 'ready',
            packages,
            error: '',
          });
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setInstallChoices({
            source: installSource,
            status: 'error',
            packages: [],
            error:
              failure instanceof Error
                ? failure.message
                : 'Unable to load installs.',
          });
      });
    return () => controller.abort();
  }, [installSource, viewed?.unit, installReload]);
  const addToInstall = async () => {
    if (
      !installReady ||
      !viewed ||
      !destination ||
      mutationLock.current ||
      !installChoices.packages.some((pack) => pack.id === destination)
    )
      return;
    mutationLock.current = true;
    setBusy(true);
    setInstallFeedback({ source: installSource, error: '', notice: '' });
    try {
      const saved = await addSavedPlayToInstall(
        destination,
        viewed.id,
        viewed.unit ?? '',
      );
      setInstallFeedback({
        source: installSource,
        error: '',
        notice: `“${viewed.name}” is in “${saved.name}”.`,
      });
    } catch (failure) {
      setInstallFeedback({
        source: installSource,
        error:
          failure instanceof Error
            ? failure.message
            : 'Unable to add the saved play.',
        notice: '',
      });
    } finally {
      mutationLock.current = false;
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
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await request(method, payload);
      setData(next);
      setDialog(null);
      setFormDirty(false);
      setDiscardRequested(false);
      done?.(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save.');
    } finally {
      mutationLock.current = false;
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
          if (next.createdId) setBookId(next.createdId);
        },
      );
    if (dialog === 'book-settings')
      void mutate('PUT', {
        kind: 'book',
        version: settingsVersion.current,
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
        key={`${editor.kind}:${editor.id}:${editorEpoch}`}
        play={editedPlay}
        formation={editedFormation}
        formations={data.formations}
        onEditingChange={onEditingChange}
        onBack={() => {
          setEditor(null);
          onEditingChange(false);
        }}
        onReload={async () => {
          const next = await request('GET');
          const record =
            editor.kind === 'play'
              ? next.plays.find((p) => p.id === editor.id)
              : next.formations.find((f) => f.id === editor.id);
          if (!record)
            throw new Error(
              'This record was removed. Your draft is still open; download it before leaving.',
            );
          setData(next);
          setEditorEpoch((value) => value + 1);
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
      ) : loadFailed ? (
        <p className="pd-empty">
          Your library could not be loaded. Retry above to continue.
        </p>
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
                      deleteTarget.current = {
                        version: f.version,
                        name: f.name,
                      };
                      setError('');
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
            <Button
              disabled={busy}
              onClick={() => onNavigate('Install')}
              variant="outline"
            >
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
                  { kind: 'duplicate', id: viewed.id, version: viewed.version },
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
            {!installSource ||
            installChoices.source !== installSource ||
            installChoices.status === 'loading' ? (
              <p role="status">Loading draft installs…</p>
            ) : null}
            {installChoices.source === installSource &&
            installChoices.status === 'error' ? (
              <p role="alert">{installChoices.error}</p>
            ) : null}
            {installReady && !installChoices.packages.length ? (
              <p>
                No matching draft installs. Create a {viewed.unit} or Team
                install in Manage installs; choose any name or schedule that
                suits your team.
              </p>
            ) : null}
            {installFeedback.source === installSource &&
            installFeedback.error ? (
              <p role="alert">{installFeedback.error}</p>
            ) : null}
            {installFeedback.source === installSource &&
            installFeedback.notice ? (
              <p role="status">{installFeedback.notice}</p>
            ) : null}
            <div className="pd-install-destination">
              <NativeSelect
                aria-label="Destination draft install"
                value={destination}
                disabled={
                  !installReady || busy || !installChoices.packages.length
                }
                onChange={(event) => setDestination(event.target.value)}
              >
                <NativeSelectOption value="">
                  Choose a draft…
                </NativeSelectOption>
                {(installReady ? installChoices.packages : []).map((pack) => (
                  <NativeSelectOption key={pack.id} value={pack.id}>
                    {pack.name} · {pack.unit}
                    {pack.dueAt ? ` · ${pack.dueAt}` : ''}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                disabled={!installReady || !destination || busy}
                onClick={() => void addToInstall()}
              >
                Add saved play
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setInstallFeedback({
                    source: installSource,
                    error: '',
                    notice: '',
                  });
                  setInstallReload((value) => value + 1);
                }}
                variant="outline"
              >
                Refresh drafts
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  installReady && destination
                    ? onOpenInstall(destination)
                    : onNavigate('Install')
                }
                variant="outline"
              >
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
                deleteTarget.current = {
                  version: viewed.version,
                  name: viewed.name,
                };
                setError('');
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
              onClick={() => (
                (settingsVersion.current = book?.version),
                setDialog('book-settings')
              )}
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
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="athlete-dialog pd-library-dialog">
          <DialogHeader>
            <DialogTitle>
              {dialog?.startsWith('delete')
                ? `Delete “${deleteTarget.current.name}”?`
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
            <p className="pd-error pd-recovery-error" role="alert">
              <span>{error}</span>
              {dialog?.startsWith('delete') ? (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => {
                    setDialog(null);
                    void refresh();
                  }}
                >
                  Reload saved records
                </Button>
              ) : null}
            </p>
          ) : null}
          {discardRequested ? (
            <div role="alert">
              <p>Discard the unsaved changes in this form?</p>
              <Button
                variant="outline"
                onClick={() => setDiscardRequested(false)}
              >
                Keep editing
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setFormDirty(false);
                  setDiscardRequested(false);
                  setDialog(null);
                }}
              >
                Discard changes
              </Button>
            </div>
          ) : null}
          {dialog?.startsWith('delete') ? (
            <DialogFooter>
              <Button
                disabled={busy}
                onClick={() => setDialog(null)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={busy || Boolean(error)}
                onClick={() =>
                  void mutate(
                    'DELETE',
                    {
                      kind: dialog.replace('delete-', ''),
                      id: deletingId,
                      version: deleteTarget.current.version,
                    },
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
            <form
              onSubmit={create}
              onChange={() => setFormDirty(true)}
              inert={busy || discardRequested}
            >
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
                    disabled={formDirty || busy}
                    title={
                      formDirty
                        ? 'Save or discard your changes before deleting this playbook.'
                        : undefined
                    }
                    onClick={() => {
                      deleteTarget.current = {
                        version: book?.version,
                        name: book?.name ?? 'Playbook',
                      };
                      setError('');
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

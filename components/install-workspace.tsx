'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { BookOpen, Check, ClipboardList, Plus, Trash2 } from 'lucide-react';
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

import { parseInstallPayload, type Payload } from '@/lib/install-data';
export type { InstallPackage } from '@/lib/install-data';
type InstallPlay = {
  id: string;
  name: string;
  unit?: string;
  notes?: string;
  players?: unknown[];
  routes?: unknown[];
  zones?: unknown[];
  labels?: unknown[];
  assignments?: {
    id: string;
    position: string;
    title: string;
    detail: string;
  }[];
};
const empty: Payload = { packages: [], package: null, items: [], reviews: [] };

export function InstallWorkspace<T extends InstallPlay>({
  onNavigate,
  renderDiagram,
  playerView,
  onEditingChange,
}: {
  onNavigate: (view: string) => void;
  renderDiagram: (play: T) => ReactNode;
  playerView: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const [data, setData] = useState<Payload>(empty);
  const [plays, setPlays] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reloadOpen, setReloadOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const mutationLock = useRef(false);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<
    'create' | 'edit' | 'add' | 'publish' | 'delete' | null
  >(null);
  const requestId = useRef(0);
  const selected =
    data.items.find((item) => item.id === selectedId) ?? data.items[0];
  const play = plays.find((item) => item.id === selected?.playId);
  const published = Boolean(data.package?.publishedAt);
  const currentReviews = data.reviews.filter(
    (review) => review.itemId === selected?.id,
  );
  const complete = data.reviews.filter((review) => review.acknowledged).length;

  const load = useCallback(async (packageId = '') => {
    const ticket = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const [installResponse, playResponse] = await Promise.all([
        fetch(
          `/api/install${packageId ? `?packageId=${encodeURIComponent(packageId)}` : ''}`,
          { cache: 'no-store' },
        ),
        fetch('/api/playbooks', { cache: 'no-store' }),
      ]);
      const next = (await installResponse.json()) as Payload & {
        error?: string;
      };
      const library = (await playResponse.json()) as {
        plays: T[];
        error?: string;
      };
      if (!installResponse.ok || !playResponse.ok)
        throw new Error(
          next.error || library.error || 'Unable to load installs.',
        );
      if (ticket !== requestId.current) return;
      const checked = parseInstallPayload(next, packageId);
      if (
        !Array.isArray(library.plays) ||
        !library.plays.every(
          (play) =>
            play &&
            typeof play.id === 'string' &&
            typeof play.name === 'string',
        ) ||
        new Set(library.plays.map((play) => play.id)).size !==
          library.plays.length
      )
        throw new Error(
          'The saved play library was incomplete. Reload before changing any data.',
        );
      setData(checked);
      setLoadFailed(false);
      setConflict(false);
      setPlays(library.plays);
      setSelectedId((current) =>
        next.items.some((item) => item.id === current)
          ? current
          : (next.items[0]?.id ?? ''),
      );
      setError('');
    } catch (failure) {
      if (ticket === requestId.current) {
        setLoadFailed(true);
        setError(
          failure instanceof Error
            ? failure.message
            : 'Unable to load installs.',
        );
      }
    } finally {
      if (ticket === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!playerView) void Promise.resolve().then(() => load());
    return () => {
      requestId.current++;
    };
  }, [load, playerView]);

  useEffect(() => {
    onEditingChange(formDirty || busy);
    const guard = (event: BeforeUnloadEvent) => {
      if (formDirty || busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => {
      onEditingChange(false);
      window.removeEventListener('beforeunload', guard);
    };
  }, [formDirty, busy, onEditingChange]);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 4500);
    return () => window.clearTimeout(timer);
  }, [message]);
  const closeDialog = () => {
    if (busy) return;
    if (formDirty) setDiscardOpen(true);
    else setDialog(null);
  };
  const matchingPlays = plays.filter(
    (candidate) =>
      candidate.name.toLowerCase().includes(query.toLowerCase()) &&
      (data.package?.unit === 'Team' || candidate.unit === data.package?.unit),
  );
  const mutate = async (
    method: string,
    body: Record<string, unknown>,
    success: string,
  ) => {
    if (mutationLock.current || loading || loadFailed) return;
    mutationLock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/install', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packageId: data.package?.id, ...body }),
      });
      const next = (await response.json()) as Payload & { error?: string };
      if (!response.ok) {
        if (response.status === 409) setConflict(true);
        throw new Error(next.error || 'Unable to save install.');
      }
      let checked: Payload;
      try {
        checked = parseInstallPayload(next);
      } catch {
        setLoadFailed(true);
        setConflict(true);
        throw new Error(
          'The saved response could not be confirmed. Reload before retrying to avoid duplicate changes.',
        );
      }
      setData(checked);
      setSelectedId((current) =>
        next.items.some((item) => item.id === current)
          ? current
          : (next.items[0]?.id ?? ''),
      );
      setDialog((current) => (current === 'add' ? current : null));
      setFormDirty(false);
      setConflict(false);
      setMessage(success);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Unable to save install.',
      );
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  };

  const savePackage = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void mutate(
      dialog === 'edit' ? 'PATCH' : 'POST',
      {
        kind: 'package',
        version: data.package?.version,
        name: fields.get('name'),
        unit: fields.get('unit'),
        dueAt: fields.get('dueAt'),
      },
      dialog === 'edit'
        ? 'Install updated.'
        : 'Install created. Add saved plays when you are ready.',
    );
  };

  if (playerView)
    return (
      <section className="module-surface install-workspace">
        <header>
          <h1>Your installs</h1>
        </header>
        <div className="install-honest-empty">
          <ClipboardList />
          <h2>Connect your player account</h2>
          <p>
            A coach must link your signed-in account to a roster athlete before
            you can see private learning assignments or record completion.
          </p>
        </div>
      </section>
    );

  return (
    <section className="module-surface install-workspace">
      <header className="install-workspace-header">
        <div>
          <h1>Installs</h1>
          <p>
            Organize teaching into packages. Use any cadence, with or without a
            due date.
          </p>
        </div>
        <Button
          className="module-primary"
          disabled={busy || loading || loadFailed}
          onClick={() => {
            setError('');
            setDialog('create');
          }}
        >
          <Plus /> New install
        </Button>
      </header>
      {error ? (
        <div className="install-feedback error" role="alert">
          {error}
          <Button
            disabled={busy || loading}
            onClick={() => {
              if (formDirty) setReloadOpen(true);
              else void load(data.package?.id);
            }}
            size="sm"
            variant="outline"
          >
            Reload
          </Button>
          {loadFailed ? (
            <Button
              disabled={busy || loading}
              onClick={() => void load()}
              variant="outline"
            >
              View all installs
            </Button>
          ) : null}
        </div>
      ) : null}
      {message ? <output className="install-feedback">{message}</output> : null}
      {loading ? (
        <p className="install-loading">Loading installs…</p>
      ) : loadFailed ? (
        <p role="status">
          Installs are unavailable. Reload to continue; saved data has not been
          changed.
        </p>
      ) : data.package ? (
        <>
          <div className="install-package-bar">
            <label htmlFor="install-package">
              Install
              <NativeSelect
                className="w-full"
                disabled={busy}
                id="install-package"
                onChange={(event) => {
                  setMessage('');
                  void load(event.target.value);
                }}
                value={data.package.id}
              >
                {data.packages.map((pack) => (
                  <NativeSelectOption key={pack.id} value={pack.id}>
                    {pack.name}
                    {pack.publishedAt ? ' · Published' : ' · Draft'}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <div>
              <span
                className={
                  published ? 'install-state published' : 'install-state'
                }
              >
                {published ? 'Published' : 'Draft'}
              </span>
              <span>{data.package.unit}</span>
              <span>
                {data.package.dueAt
                  ? `Due ${data.package.dueAt}`
                  : 'No due date'}
              </span>
            </div>
            <div className="install-package-actions">
              {!published ? (
                <>
                  <Button
                    disabled={busy}
                    onClick={() => setDialog('edit')}
                    variant="outline"
                  >
                    Edit details
                  </Button>
                  <Button
                    className="module-primary"
                    disabled={busy || !data.items.length}
                    onClick={() => setDialog('publish')}
                  >
                    Publish
                  </Button>
                  <Button
                    aria-label="Delete draft install"
                    disabled={busy}
                    onClick={() => setDialog('delete')}
                    size="icon"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </>
              ) : (
                <span>
                  {complete} / {data.reviews.length} reviews complete
                </span>
              )}
            </div>
          </div>
          <div className="install-core-layout">
            <aside className="install-play-list">
              <details className="install-list-disclosure">
                <summary>
                  {data.items.length}{' '}
                  {data.items.length === 1 ? 'play' : 'plays'} — choose or add
                </summary>
                <div className="install-list-body">
                  <div className="install-list-heading">
                    <strong>
                      {data.items.length}{' '}
                      {data.items.length === 1 ? 'play' : 'plays'}
                    </strong>
                    {!published ? (
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setQuery('');
                          setDialog('add');
                        }}
                        size="sm"
                        variant="outline"
                      >
                        <Plus /> Add plays
                      </Button>
                    ) : null}
                  </div>
                  {data.items.map((item) => (
                    <button
                      className={item.id === selected?.id ? 'active' : ''}
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      type="button"
                    >
                      <BookOpen />
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {item.group}
                          {published
                            ? ` · ${item.reviewCount ? `${item.complete}% complete` : 'No recipients'}`
                            : ''}
                        </small>
                      </span>
                    </button>
                  ))}
                  {!data.items.length ? (
                    <div className="install-honest-empty">
                      <BookOpen />
                      <p>Add saved plays to build this install.</p>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setQuery('');
                          setDialog('add');
                        }}
                        variant="outline"
                      >
                        Choose plays
                      </Button>
                    </div>
                  ) : null}
                </div>
              </details>
            </aside>
            <main className="install-content">
              {selected ? (
                <>
                  <header>
                    <div>
                      <h2>{selected.title}</h2>
                      <span>{selected.group} · Saved play</span>
                    </div>
                    {!published ? (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void mutate(
                            'DELETE',
                            { kind: 'item', itemId: selected.id },
                            'Play removed from this draft.',
                          )
                        }
                        size="sm"
                        variant="outline"
                      >
                        <Trash2 /> Remove from install
                      </Button>
                    ) : null}
                  </header>
                  {play ? (
                    <>
                      {play.players?.length ||
                      play.routes?.length ||
                      play.zones?.length ||
                      play.labels?.length ? (
                        <div className="install-real-diagram">
                          {renderDiagram(play)}
                        </div>
                      ) : (
                        <p className="install-draft-note">
                          No diagram has been saved for this play. Open Playbook
                          to draw and save it.
                        </p>
                      )}
                      <details className="install-teaching-details">
                        <summary>Assignments and coaching notes</summary>
                        <div className="install-teaching">
                          <section>
                            <h3>Position assignments</h3>
                            {play.assignments?.length ? (
                              play.assignments.map((assignment) => (
                                <article key={assignment.id}>
                                  <strong>
                                    {assignment.position} · {assignment.title}
                                  </strong>
                                  <p>
                                    {assignment.detail ||
                                      'No additional detail.'}
                                  </p>
                                </article>
                              ))
                            ) : (
                              <p>
                                No position assignments saved for this play.
                              </p>
                            )}
                          </section>
                          <section>
                            <h3>Coaching notes</h3>
                            <p>
                              {play.notes ||
                                'No coaching notes saved for this play.'}
                            </p>
                          </section>
                        </div>
                      </details>
                    </>
                  ) : (
                    <p>
                      This play is unavailable. Remove it from the draft and
                      choose an existing play.
                    </p>
                  )}
                  {published ? (
                    <details className="install-review-table">
                      <summary>Review tracking</summary>
                      <h3>Review tracking</h3>
                      <p>
                        Read-only coach view. Completion requires a linked
                        athlete account.
                      </p>
                      <table>
                        <thead>
                          <tr>
                            <th>Athlete</th>
                            <th>Position</th>
                            <th>Play</th>
                            <th>Assignment</th>
                            <th>Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentReviews.map((review) => (
                            <tr key={review.id}>
                              <td>{review.name}</td>
                              <td>{review.position}</td>
                              <td>
                                {review.reviewed ? 'Reviewed' : 'Pending'}
                              </td>
                              <td>
                                {review.assignment ? 'Reviewed' : 'Pending'}
                              </td>
                              <td>{review.note ? 'Reviewed' : 'Pending'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!currentReviews.length ? (
                        <p>No recipients are assigned to this play.</p>
                      ) : null}
                    </details>
                  ) : (
                    <p className="install-draft-note">
                      Publishing assigns each play to the roster athletes in its
                      unit. Published material is locked; create a new install
                      when the teaching changes.
                    </p>
                  )}
                </>
              ) : (
                <div className="install-honest-empty">
                  <ClipboardList />
                  <h2>Build at your team’s pace</h2>
                  <p>
                    A practice, a week, a month, or an entire concept—each
                    install is a separate package you name.
                  </p>
                </div>
              )}
            </main>
          </div>
        </>
      ) : !error ? (
        <div className="install-honest-empty">
          <ClipboardList />
          <h2>Create your first install</h2>
          <p>Give it a name, choose a unit, and optionally set a due date.</p>
          <Button onClick={() => setDialog('create')}>
            <Plus /> New install
          </Button>
        </div>
      ) : null}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="athlete-dialog install-dialog">
          <DialogHeader>
            <DialogTitle>
              {dialog === 'create'
                ? 'New install'
                : dialog === 'edit'
                  ? 'Install details'
                  : dialog === 'add'
                    ? 'Add saved plays'
                    : dialog === 'publish'
                      ? 'Publish this install?'
                      : 'Delete this draft?'}
            </DialogTitle>
            <DialogDescription>
              {dialog === 'publish'
                ? 'All plays will be assigned to matching roster athletes. Published installs and their plays are locked to keep review records accurate.'
                : dialog === 'delete'
                  ? 'This deletes the draft package. The source plays stay in Playbook.'
                  : 'Choose the content and timing that fit your team.'}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="install-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
          {conflict ? (
            <div className="install-feedback error">
              <p>Your open draft is preserved. Reloading will discard it.</p>
              <Button
                onClick={() => {
                  const fields = formRef.current
                    ? Object.fromEntries(new FormData(formRef.current))
                    : {};
                  const blob = new Blob(
                    [
                      JSON.stringify(
                        { packageId: data.package?.id, fields },
                        null,
                        2,
                      ),
                    ],
                    { type: 'application/json' },
                  );
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'install-draft.json';
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Download draft
              </Button>
              <Button onClick={() => setReloadOpen(true)}>
                Reload latest install
              </Button>
            </div>
          ) : null}
          {dialog === 'create' || dialog === 'edit' ? (
            <form
              ref={formRef}
              inert={busy}
              onChange={() => setFormDirty(true)}
              onSubmit={savePackage}
            >
              <div className="athlete-form-grid">
                <label className="full" htmlFor="install-name">
                  Name
                  <Input
                    defaultValue={dialog === 'edit' ? data.package?.name : ''}
                    id="install-name"
                    maxLength={100}
                    name="name"
                    placeholder="Example: Camp day 2 — red zone"
                    required
                  />
                </label>
                <label htmlFor="install-unit">
                  Unit
                  <NativeSelect
                    defaultValue={
                      dialog === 'edit' ? data.package?.unit : 'Team'
                    }
                    id="install-unit"
                    name="unit"
                  >
                    {['Team', 'Offence', 'Defence', 'Special teams'].map(
                      (unit) => (
                        <NativeSelectOption key={unit} value={unit}>
                          {unit}
                        </NativeSelectOption>
                      ),
                    )}
                  </NativeSelect>
                </label>
                <label htmlFor="install-due">
                  Due date (optional)
                  <Input
                    defaultValue={dialog === 'edit' ? data.package?.dueAt : ''}
                    id="install-due"
                    name="dueAt"
                    type="date"
                  />
                </label>
              </div>
              <DialogFooter>
                <Button disabled={busy} type="submit">
                  {busy ? 'Saving…' : 'Save install'}
                </Button>
              </DialogFooter>
            </form>
          ) : dialog === 'add' ? (
            <>
              <Input
                aria-label="Search saved plays"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search saved plays…"
                value={query}
              />
              <div className="install-play-picker">
                {matchingPlays.map((candidate) => {
                  const included = data.items.some(
                    (item) => item.playId === candidate.id,
                  );
                  return (
                    <div key={candidate.id}>
                      <span>
                        <strong>{candidate.name}</strong>
                        <small>{candidate.unit}</small>
                      </span>
                      <Button
                        disabled={busy || included}
                        onClick={() =>
                          void mutate(
                            'POST',
                            { playId: candidate.id },
                            `${candidate.name} added.`,
                          )
                        }
                        size="sm"
                        variant="outline"
                      >
                        {included ? (
                          <>
                            <Check /> Added
                          </>
                        ) : (
                          <>
                            <Plus /> Add
                          </>
                        )}
                      </Button>
                    </div>
                  );
                })}
                {!matchingPlays.length ? (
                  <p>
                    {plays.length
                      ? 'No saved plays match this unit and search. Clear the search or choose another install.'
                      : 'No saved plays yet. Create one in Playbook first.'}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDialog(null);
                    onNavigate('Playbook');
                  }}
                  variant="outline"
                >
                  Open Playbook
                </Button>
              </DialogFooter>
            </>
          ) : (
            <DialogFooter>
              <Button
                disabled={busy}
                onClick={() => setDialog(null)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void mutate(
                    dialog === 'publish' ? 'PATCH' : 'DELETE',
                    { kind: dialog === 'publish' ? 'publish' : 'package' },
                    dialog === 'publish'
                      ? 'Install published. Review tracking is ready.'
                      : 'Draft deleted.',
                  )
                }
              >
                {busy
                  ? 'Saving…'
                  : dialog === 'publish'
                    ? 'Publish install'
                    : 'Delete draft'}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard install changes?</DialogTitle>
            <DialogDescription>
              Your saved install will remain unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDiscardOpen(false)} variant="outline">
              Keep editing
            </Button>
            <Button
              onClick={() => {
                setFormDirty(false);
                setDiscardOpen(false);
                setDialog(null);
              }}
            >
              Discard draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={reloadOpen} onOpenChange={setReloadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reload the latest install?</DialogTitle>
            <DialogDescription>
              This discards the open form. Download the draft first if you want
              a copy.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setReloadOpen(false)} variant="outline">
              Keep draft
            </Button>
            <Button
              onClick={() => {
                setReloadOpen(false);
                setFormDirty(false);
                setDialog(null);
                void load(data.package?.id);
              }}
            >
              Discard draft and reload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

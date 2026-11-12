'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WorkspaceSelect } from '@/components/ui/select';
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
import { emptyGameplan } from '@/lib/gameplan-state';
import {
  readGameplans,
  writeGameplan,
  type NamedGameplan,
} from '@/lib/named-gameplans';

export function GameplanWorkspace({
  children,
  onEditingChange,
  initialPlanId = '',
}: {
  initialPlanId?: string;
  onEditingChange: (editing: boolean) => void;
  children: (props: {
    plan: NamedGameplan;
    onSaved: (plan: NamedGameplan) => void;
    onEditingChange: (editing: boolean) => void;
    onBusyChange: (busy: boolean) => void;
  }) => ReactNode;
}) {
  const [plans, setPlans] = useState<NamedGameplan[]>([]),
    [selected, setSelected] = useState(''),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [epoch, setEpoch] = useState(0);
  const [editorEditing, setEditorEditing] = useState(false),
    [editorBusy, setEditorBusy] = useState(false),
    [form, setForm] = useState<NamedGameplan | 'new' | null>(null),
    [formDirty, setFormDirty] = useState(false),
    [formError, setFormError] = useState(''),
    [discardOpen, setDiscardOpen] = useState(false),
    [reloadOpen, setReloadOpen] = useState(false),
    [archiveTarget, setArchiveTarget] = useState<NamedGameplan | null>(null);
  const lock = useRef(false),
    creationId = useRef(''),
    mounted = useRef(true);
  const requestedPlan = useRef(initialPlanId);
  const editing = editorEditing || formDirty || busy;
  useEffect(() => {
    onEditingChange(editing);
    return () => onEditingChange(false);
  }, [editing, onEditingChange]);
  useEffect(() => {
    if (!editing) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editing]);
  const load = useCallback(async (reset = false) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const rows = await readGameplans();
      if (!mounted.current) return;
      setPlans(rows);
      if (requestedPlan.current) {
        const requested = requestedPlan.current;
        requestedPlan.current = '';
        setSelected(
          rows.some((plan) => plan.id === requested) ? requested : '',
        );
        if (!rows.some((plan) => plan.id === requested))
          setError(
            'That source gameplan is unavailable. Choose another saved plan.',
          );
      } else
        setSelected((id) =>
          rows.some((plan) => plan.id === id)
            ? id
            : (rows.find((plan) => !plan.archived)?.id ?? ''),
        );
      setLoaded(true);
      if (reset) {
        setEpoch((value) => value + 1);
        setEditorEditing(false);
        setForm(null);
        setFormDirty(false);
      }
      setReloadOpen(false);
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Gameplans could not be loaded.',
        );
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  const saved = useCallback((plan: NamedGameplan) => {
    setPlans((rows) =>
      [plan, ...rows.filter((row) => row.id !== plan.id)].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    );
    setSelected(plan.id);
  }, []);
  const active = plans.find((plan) => plan.id === selected);
  const closeForm = () => {
    if (busy) return;
    if (formDirty) setDiscardOpen(true);
    else setForm(null);
  };
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form || lock.current) return;
    lock.current = true;
    setBusy(true);
    setFormError('');
    const fields = new FormData(event.currentTarget),
      text = (name: string) => String(fields.get(name) ?? '').trim();
    try {
      const value =
        form === 'new'
          ? {
              id: creationId.current,
              title: text('title'),
              opponent: text('opponent'),
              date: text('date'),
              archived: false,
              state: { ...emptyGameplan(), unit: text('unit') },
            }
          : {
              ...form,
              title: text('title'),
              opponent: text('opponent'),
              date: text('date'),
            };
      const plan = await writeGameplan(
        value,
        form === 'new' ? undefined : form.version,
      );
      saved(plan);
      setForm(null);
      setFormDirty(false);
    } catch (failure) {
      setFormError(
        failure instanceof Error
          ? failure.message
          : 'The gameplan save could not be confirmed.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <section className="gameplan-library-controls">
        <label htmlFor="gameplan-selection">
          Gameplan
          <WorkspaceSelect
            id="gameplan-selection"
            label="Choose gameplan"
            value={selected}
            disabled={busy || editorEditing || Boolean(form)}
            onChange={setSelected}
            options={[
              { value: '', label: 'Choose a gameplan…' },
              ...plans
                .filter((plan) => !plan.archived || plan.id === selected)
                .map((plan) => ({
                  value: plan.id,
                  label: [
                    plan.title,
                    plan.opponent,
                    plan.date,
                    plan.archived && 'Archived',
                  ]
                    .filter(Boolean)
                    .join(' · '),
                })),
            ]}
          />
        </label>
        <Button
          disabled={busy || editorEditing}
          onClick={() => {
            creationId.current = crypto.randomUUID();
            setFormError('');
            setFormDirty(false);
            setForm('new');
          }}
        >
          New gameplan
        </Button>
        <details>
          <summary>Plan options</summary>
          <div className="gameplan-option-actions">
            <Button
              variant="outline"
              disabled={!active || active.archived || busy || editorEditing}
              onClick={() => {
                if (active) {
                  setForm(active);
                  setFormDirty(false);
                  setFormError('');
                }
              }}
            >
              Edit plan details
            </Button>
            <Button
              variant="outline"
              disabled={!active || busy || editorEditing}
              onClick={() => {
                setError('');
                setArchiveTarget(active ?? null);
              }}
            >
              {active?.archived ? 'Restore plan' : 'Archive plan'}
            </Button>
            <Button
              variant="outline"
              disabled={busy || editorBusy}
              onClick={() => setReloadOpen(true)}
            >
              Reload saved gameplans
            </Button>
          </div>
        </details>
      </section>
      {error ? <p role="alert">{error}</p> : null}
      {!loaded ? (
        <section className="module-surface">
          <p role="status">
            {busy ? 'Loading saved gameplans…' : 'Gameplans are unavailable.'}
          </p>
          <Button disabled={busy} onClick={() => void load()}>
            Retry gameplans
          </Button>
        </section>
      ) : active ? (
        <div key={`${active.id}:${epoch}`}>
          <p className="gameplan-record-context">
            {[active.opponent, active.date].filter(Boolean).join(' · ') ||
              'No opponent or date set'}
            {active.previous
              ? ' · Previous saved content is preserved until you save this plan.'
              : ''}
          </p>
          {active.archived ? (
            <p role="status">
              Archived gameplan. Restore it from Plan options to edit or
              generate practice.
            </p>
          ) : null}
          <fieldset
            className="gameplan-editor-boundary"
            disabled={active.archived}
          >
            {children({
              plan: active,
              onSaved: saved,
              onEditingChange: setEditorEditing,
              onBusyChange: setEditorBusy,
            })}
          </fieldset>
        </div>
      ) : (
        <section className="module-surface">
          <h1>Gameplans</h1>
          <p>
            Keep separate plans for opponents, dates, or any teaching period
            your team uses.
          </p>
          <p>
            No active gameplan selected. Choose one above or create your first
            plan.
          </p>
        </section>
      )}
      {plans.some((plan) => plan.archived) ? (
        <details className="gameplan-archives">
          <summary>
            Archived gameplans ({plans.filter((plan) => plan.archived).length})
          </summary>
          {plans
            .filter((plan) => plan.archived)
            .map((plan) => (
              <Button
                key={plan.id}
                variant="outline"
                disabled={busy || editorEditing}
                onClick={() => setSelected(plan.id)}
              >
                Open {plan.title}
              </Button>
            ))}
        </details>
      ) : null}
      <Dialog
        open={form !== null}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <DialogContent className="athlete-dialog">
          <form
            onSubmit={(event) => void submit(event)}
            onChange={() => setFormDirty(true)}
            inert={busy}
          >
            <DialogHeader>
              <DialogTitle>
                {form === 'new' ? 'New gameplan' : 'Edit gameplan details'}
              </DialogTitle>
              <DialogDescription>
                Name the plan using your team’s terminology. Opponent and date
                are optional.
              </DialogDescription>
            </DialogHeader>
            <div className="athlete-form-grid">
              <label className="full">
                Plan title
                <Input
                  name="title"
                  required
                  maxLength={120}
                  defaultValue={form && form !== 'new' ? form.title : ''}
                />
              </label>
              <label>
                Opponent
                <Input
                  name="opponent"
                  maxLength={200}
                  defaultValue={form && form !== 'new' ? form.opponent : ''}
                />
              </label>
              <label>
                Date
                <Input
                  type="date"
                  name="date"
                  defaultValue={form && form !== 'new' ? form.date : ''}
                />
              </label>
              {form === 'new' ? (
                <label>
                  Unit
                  <NativeSelect name="unit" defaultValue="Offence">
                    <NativeSelectOption>Offence</NativeSelectOption>
                    <NativeSelectOption>Defence</NativeSelectOption>
                    <NativeSelectOption>Special teams</NativeSelectOption>
                  </NativeSelect>
                </label>
              ) : null}
            </div>
            {formError ? (
              <div className="dialog-feedback">
                <p role="alert">{formError}</p>
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit">
                {busy ? 'Saving…' : 'Save gameplan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved plan details?</DialogTitle>
            <DialogDescription>
              Unsaved plan details will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDiscardOpen(false);
                setForm(null);
                setFormDirty(false);
              }}
            >
              Discard details
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={reloadOpen}
        onOpenChange={(open) => {
          if (!busy) setReloadOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reload saved gameplans?</DialogTitle>
            <DialogDescription>
              This replaces the open editor and any unsaved form or failed draft
              only after saved gameplans load successfully. Download a failed
              draft first if you need it.
            </DialogDescription>
          </DialogHeader>
          {error ? <p role="alert">{error}</p> : null}
          <DialogFooter>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => setReloadOpen(false)}
            >
              Keep editing
            </Button>
            <Button disabled={busy} onClick={() => void load(true)}>
              Reload gameplans
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!busy && !open) setArchiveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {archiveTarget?.archived ? 'Restore' : 'Archive'}{' '}
              {archiveTarget?.title}?
            </DialogTitle>
            <DialogDescription>
              Its content and practice source links are retained. Archived plans
              are read-only until restored.
            </DialogDescription>
          </DialogHeader>
          {error ? <p role="alert">{error}</p> : null}
          <DialogFooter>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => setArchiveTarget(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!archiveTarget || lock.current) return;
                lock.current = true;
                setBusy(true);
                setError('');
                try {
                  const result = await writeGameplan(
                    { ...archiveTarget, archived: !archiveTarget.archived },
                    archiveTarget.version,
                  );
                  saved(result);
                  setArchiveTarget(null);
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : 'Archive state was not confirmed. Reload before retrying.',
                  );
                } finally {
                  lock.current = false;
                  setBusy(false);
                }
              }}
            >
              {archiveTarget?.archived
                ? 'Restore gameplan'
                : 'Archive gameplan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

'use client';
import { workspaceFetch as fetch } from '@/lib/workspace-fetch';
/* oxlint-disable jsx-a11y/media-has-caption -- User-uploaded game film has no supplied caption track; do not substitute an empty caption file. */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Film,
  Maximize2,
  Pin,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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

type Asset = { id: string; title: string; storageKey: string | null };
type Clip = {
  id: string;
  assetId: string;
  clipNumber: number;
  playName: string | null;
  concept: string;
  startSeconds: number;
  endSeconds: number;
  odk: string;
  down: number | null;
  distance: number | null;
  result: string;
};
type FilmData = { assets: Asset[]; asset: Asset | null; clips: Clip[] };
type Note = {
  id: string;
  clipId: string | null;
  text: string;
  createdAt: string;
};
type Notebook = {
  flaggedClipIds: string[];
  notes: Note[];
  legacyNotes: string[];
  legacyFlagCount: number;
};
type Selection = { filmId: string } | { clipId: string };
const label = (clip: Clip) =>
  clip.playName || clip.concept || `Clip ${clip.clipNumber}`;
const blankNotebook: Notebook = {
  flaggedClipIds: [],
  notes: [],
  legacyNotes: [],
  legacyFlagCount: 0,
};

async function read<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(data.error || 'Saved work could not be loaded.');
  return data;
}

export function SidelineWorkspace({
  focusMode,
  onToggleFocus,
  onNavigate,
  onEditingChange,
}: {
  focusMode: boolean;
  onToggleFocus: () => void;
  onNavigate: (view: string) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [film, setFilm] = useState<FilmData>({
    assets: [],
    asset: null,
    clips: [],
  });
  const [filmLoading, setFilmLoading] = useState(true),
    [filmError, setFilmError] = useState('');
  const [playbackError, setPlaybackError] = useState('');
  const [clipId, setClipId] = useState('');
  const [notebook, setNotebook] = useState(blankNotebook);
  const [notesLoading, setNotesLoading] = useState(true),
    [notesError, setNotesError] = useState('');
  const [draft, setDraft] = useState(''),
    [saving, setSaving] = useState(false),
    [writeError, setWriteError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Selection | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null),
    [cameraBusy, setCameraBusy] = useState(false),
    [cameraError, setCameraError] = useState('');
  const streamRef = useRef<MediaStream | null>(null),
    mounted = useRef(true);
  const video = useRef<HTMLVideoElement>(null),
    camera = useRef<HTMLVideoElement>(null);
  const noteId = useRef(''),
    writeLock = useRef(false),
    filmRequest = useRef(0);
  const clip = film.clips.find((item) => item.id === clipId) ?? null;
  const source = film.asset?.storageKey
    ? `/api/media?key=${encodeURIComponent(film.asset.storageKey)}`
    : '';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      filmRequest.current += 1;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    onEditingChange(Boolean(draft.trim()) || saving);
    return () => onEditingChange(false);
  }, [draft, saving, onEditingChange]);
  useEffect(() => {
    if (!draft.trim() && !saving) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft, saving]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (camera.current) camera.current.srcObject = stream;
  }, [stream]);
  useEffect(() => {
    if (!video.current || !clip) return;
    video.current.pause();
    if (video.current.readyState >= 1)
      video.current.currentTime = clip.startSeconds;
  }, [clip, source]);

  const loadFilm = useCallback(async (assetId = '') => {
    const request = ++filmRequest.current;
    setFilmLoading(true);
    setFilmError('');
    video.current?.pause();
    try {
      const data = await read<FilmData>(
        `/api/film${assetId ? `?assetId=${encodeURIComponent(assetId)}` : ''}`,
      );
      if (
        !Array.isArray(data.assets) ||
        !Array.isArray(data.clips) ||
        (assetId && data.asset?.id !== assetId)
      )
        throw new Error('The saved film response was incomplete.');
      if (request !== filmRequest.current || !mounted.current) return;
      setFilm(data);
      setClipId(data.clips[0]?.id ?? '');
      setPlaybackError('');
    } catch (error) {
      if (request === filmRequest.current && mounted.current)
        setFilmError(
          error instanceof Error ? error.message : 'Unable to load saved film.',
        );
    } finally {
      if (request === filmRequest.current && mounted.current)
        setFilmLoading(false);
    }
  }, []);
  const loadNotes = useCallback(async () => {
    setNotesLoading(true);
    setNotesError('');
    try {
      const data = await read<Notebook>('/api/sideline');
      if (
        !Array.isArray(data.notes) ||
        !Array.isArray(data.flaggedClipIds) ||
        !Array.isArray(data.legacyNotes)
      )
        throw new Error('The saved notebook response was incomplete.');
      if (mounted.current) setNotebook(data);
    } catch (error) {
      if (mounted.current)
        setNotesError(
          error instanceof Error
            ? error.message
            : 'Unable to load sideline notes.',
        );
    } finally {
      if (mounted.current) setNotesLoading(false);
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(() => {
      void loadFilm();
      void loadNotes();
    });
  }, [loadFilm, loadNotes]);

  const applySelection = (selection: Selection) => {
    if ('filmId' in selection) void loadFilm(selection.filmId);
    else {
      video.current?.pause();
      setClipId(selection.clipId);
    }
  };
  const select = (selection: Selection) => {
    if (writeLock.current || filmLoading) return;
    if (draft.trim()) setPending(selection);
    else applySelection(selection);
  };
  const move = (direction: number) => {
    if (!film.clips.length) return;
    const index = film.clips.findIndex((item) => item.id === clipId);
    select({
      clipId:
        film.clips[(index + direction + film.clips.length) % film.clips.length]
          .id,
    });
  };
  const write = async (action: 'note' | 'flag') => {
    if (writeLock.current || notesLoading || notesError) return;
    if ((action === 'note' && !draft.trim()) || (action === 'flag' && !clip))
      return;
    writeLock.current = true;
    setSaving(true);
    setWriteError('');
    if (!noteId.current) noteId.current = crypto.randomUUID();
    try {
      const data = await read<
        Omit<Notebook, 'legacyNotes' | 'legacyFlagCount'>
      >('/api/sideline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          action === 'note'
            ? {
                action,
                id: noteId.current,
                text: draft,
                clipId: clip?.id ?? null,
              }
            : {
                action,
                clipId: clip!.id,
                flagged: !notebook.flaggedClipIds.includes(clip!.id),
              },
        ),
      });
      if (!Array.isArray(data.notes) || !Array.isArray(data.flaggedClipIds))
        throw new Error(
          'The save response was incomplete. Reopen the notebook before retrying.',
        );
      if (!mounted.current) return;
      setNotebook((current) => ({ ...current, ...data }));
      if (action === 'note') {
        setDraft('');
        noteId.current = '';
      }
      setNotice(
        action === 'note' ? 'Sideline note saved.' : 'Clip flag saved.',
      );
    } catch (error) {
      if (mounted.current)
        setWriteError(
          error instanceof Error
            ? error.message
            : 'Sideline changes could not be saved.',
        );
    } finally {
      writeLock.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const toggleCamera = async () => {
    if (cameraBusy) return;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStream(null);
      return;
    }
    setCameraBusy(true);
    setCameraError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('Camera preview is unavailable in this browser.');
      const next = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      if (!mounted.current) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = next;
      setStream(next);
    } catch (error) {
      if (mounted.current)
        setCameraError(
          error instanceof Error
            ? error.message
            : 'Camera access was not granted.',
        );
    } finally {
      if (mounted.current) setCameraBusy(false);
    }
  };
  return (
    <section className="module-surface sideline-review">
      <div className="module-header">
        <div>
          <p className="eyebrow">Film review</p>
          <h1>Sideline</h1>
          <p>Review saved clips and keep your bench notes beside the film.</p>
        </div>
        <div className="module-actions">
          <Button variant="outline" onClick={onToggleFocus}>
            <Maximize2 />
            {focusMode ? 'Exit focus' : 'Focus mode'}
          </Button>
          <Button variant="outline" onClick={() => onNavigate('Film Room')}>
            <Film />
            Film Room
          </Button>
        </div>
      </div>
      {notice && <output>{notice}</output>}
      {writeError && <p role="alert">{writeError}</p>}
      {notesError && <p role="alert">{notesError} Open Notebook to retry.</p>}
      <details className="sideline-disclosure">
        <summary>
          Film & clips {film.asset ? `· ${film.asset.title}` : ''}
        </summary>
        {film.assets.length > 0 && (
          <label>
            Saved film
            <NativeSelect
              aria-label="Saved sideline film"
              value={film.asset?.id ?? ''}
              disabled={filmLoading || saving}
              onChange={(event) => select({ filmId: event.target.value })}
            >
              {film.assets.map((asset) => (
                <NativeSelectOption key={asset.id} value={asset.id}>
                  {asset.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        )}
        <div className="sideline-review-clips">
          {film.clips.map((item) => (
            <Button
              key={item.id}
              variant={clipId === item.id ? 'secondary' : 'ghost'}
              disabled={filmLoading || saving}
              onClick={() => select({ clipId: item.id })}
            >
              {notebook.flaggedClipIds.includes(item.id) && <Pin />}#
              {item.clipNumber} · {label(item)}
            </Button>
          ))}
        </div>
        {!filmLoading && !filmError && film.clips.length === 0 && (
          <p>
            No charted clips in this film. You can review the recording or chart
            clips in Film Room.
          </p>
        )}
      </details>
      {filmLoading ? (
        <output>Loading saved film…</output>
      ) : filmError ? (
        <div role="alert">
          <p>{filmError}</p>
          <Button onClick={() => void loadFilm(film.asset?.id)}>
            Retry film
          </Button>
        </div>
      ) : source ? (
        <>
          <video
            key={source}
            aria-label="Saved sideline film"
            className="sideline-recorded-video"
            controls
            playsInline
            preload="metadata"
            ref={video}
            src={source}
            onLoadedMetadata={(event) => {
              if (clip) event.currentTarget.currentTime = clip.startSeconds;
            }}
            onPlay={(event) => {
              if (
                clip &&
                (event.currentTarget.currentTime < clip.startSeconds ||
                  event.currentTarget.currentTime >= clip.endSeconds)
              )
                event.currentTarget.currentTime = clip.startSeconds;
            }}
            onTimeUpdate={(event) => {
              if (
                clip &&
                !event.currentTarget.paused &&
                event.currentTarget.currentTime >= clip.endSeconds
              ) {
                event.currentTarget.pause();
                event.currentTarget.currentTime = clip.endSeconds;
              }
            }}
            onError={() =>
              setPlaybackError(
                'This recording could not be played. Check the file and this device’s video support.',
              )
            }
          />
          {playbackError && <p role="alert">{playbackError}</p>}
        </>
      ) : (
        <div className="viewer-empty-state">
          <Film />
          <strong>No saved film yet</strong>
          <span>Upload a recording in Film Room to review it here.</span>
          <Button onClick={() => onNavigate('Film Room')}>
            Open Film Room
          </Button>
        </div>
      )}
      <div className="sideline-review-controls">
        <Button
          aria-label="Previous saved clip"
          variant="outline"
          disabled={filmLoading || saving || !film.clips.length}
          onClick={() => move(-1)}
        >
          <SkipBack />
        </Button>
        <span>
          {clip
            ? `Clip ${clip.clipNumber} · ${label(clip)} · ${clip.startSeconds}s–${clip.endSeconds}s`
            : film.asset
              ? 'Full recording'
              : 'No clip selected'}
        </span>
        <Button
          aria-label="Next saved clip"
          variant="outline"
          disabled={filmLoading || saving || !film.clips.length}
          onClick={() => move(1)}
        >
          <SkipForward />
        </Button>
        <Button
          variant="outline"
          disabled={
            !clip ||
            saving ||
            filmLoading ||
            Boolean(filmError) ||
            notesLoading ||
            Boolean(notesError)
          }
          onClick={() => void write('flag')}
        >
          <Pin />
          {clip && notebook.flaggedClipIds.includes(clip.id)
            ? 'Unflag clip'
            : 'Flag clip'}
        </Button>
      </div>
      <details className="sideline-disclosure">
        <summary>
          Notebook ·{' '}
          {notesLoading
            ? 'Loading…'
            : notesError
              ? 'Unable to load'
              : String(notebook.notes.length + notebook.legacyNotes.length) +
                ' saved notes'}
        </summary>
        {notesLoading ? (
          <output>Loading saved notes…</output>
        ) : notesError ? (
          <div role="alert">
            <p>{notesError}</p>
            <Button onClick={() => void loadNotes()}>Retry notebook</Button>
          </div>
        ) : (
          <>
            <label htmlFor="sideline-note">
              {clip ? `Note for clip ${clip.clipNumber}` : 'Team note'}
            </label>
            <Textarea
              id="sideline-note"
              maxLength={1000}
              value={draft}
              disabled={saving || filmLoading || Boolean(filmError)}
              onChange={(event) => {
                setDraft(event.target.value);
                noteId.current = '';
              }}
              placeholder="Add a bench observation…"
            />
            <Button
              disabled={
                saving || filmLoading || Boolean(filmError) || !draft.trim()
              }
              onClick={() => void write('note')}
            >
              {saving ? 'Saving…' : 'Save note'}
            </Button>
            <ul className="sideline-notes">
              {[...notebook.notes].reverse().map((note) => (
                <li key={note.id}>
                  <small>
                    {new Date(note.createdAt).toLocaleString()} ·{' '}
                    {note.clipId
                      ? film.clips.find((item) => item.id === note.clipId)
                        ? `Clip ${film.clips.find((item) => item.id === note.clipId)!.clipNumber}`
                        : 'Saved clip note'
                      : 'Team note'}
                  </small>
                  <p>{note.text}</p>
                </li>
              ))}
            </ul>
            {notebook.notes.length === 0 &&
              notebook.legacyNotes.length === 0 && (
                <p>No saved sideline notes yet.</p>
              )}
            {notebook.legacyNotes.length > 0 && (
              <>
                <h3>Earlier notes</h3>
                <ul className="sideline-notes">
                  {notebook.legacyNotes.map((text, index) => (
                    <li key={index}>{text}</li>
                  ))}
                </ul>
              </>
            )}
            {notebook.legacyFlagCount > 0 && (
              <p>
                Earlier flags are preserved. Flag the matching saved clips here
                to identify them by film.
              </p>
            )}
          </>
        )}
      </details>
      <details className="sideline-disclosure">
        <summary>Camera preview {stream ? '· Connected' : ''}</summary>
        <p>
          This device’s live camera preview does not record or provide instant
          replay.
        </p>
        <Button
          variant="outline"
          disabled={cameraBusy}
          onClick={() => void toggleCamera()}
        >
          <Camera />
          {cameraBusy
            ? 'Connecting…'
            : stream
              ? 'Disconnect camera'
              : 'Connect camera'}
        </Button>
        {cameraError && <p role="alert">{cameraError}</p>}
        {stream && (
          <video
            aria-label="Live camera preview"
            className="sideline-recorded-video"
            autoPlay
            muted
            playsInline
            ref={camera}
          />
        )}
      </details>
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this note draft?</DialogTitle>
            <DialogDescription>
              Save the note before switching clips, or discard the draft to
              continue.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Keep editing
            </Button>
            <Button
              onClick={() => {
                const target = pending;
                setDraft('');
                noteId.current = '';
                setPending(null);
                if (target) applySelection(target);
              }}
            >
              Discard draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

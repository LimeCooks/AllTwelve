'use client';
import { BackupControls } from '@/components/backup-controls';
import { WorkspaceSearch } from '@/components/workspace-search';
import type { SearchResult } from '@/lib/workspace-search';
import { loadDashboard } from '@/lib/dashboard-load';
import {
  calendarClock,
  calendarDate,
  calendarExport,
  calendarEditInstant,
  calendarTimeInput,
} from '@/lib/calendar-time';
import {
  GAMEPLAN_KEY,
  loadGameplan,
  linkGameplanPlays,
  resolveGameplanPlay,
} from '@/lib/gameplan-state';
import {
  WorkspaceGate,
  useWorkspaceSession,
  type WorkspaceSession,
} from '@/components/workspace-gate';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import NextImage from 'next/image';
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BookOpen,
  GraduationCap,
  Printer,
  Trophy,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  CloudOff,
  ClipboardList,
  Download,
  Eye,
  Film,
  GripVertical,
  Hash,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  Lock,
  Mail,
  Maximize2,
  Megaphone,
  MessageSquareText,
  Moon,
  MoreHorizontal,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pencil,
  Phone,
  Pin,
  Play,
  Plus,
  Radio,
  Search,
  Send,
  Settings,
  Shield,
  Shirt,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Sun,
  Tag,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Volume2,
  X,
  Zap,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  InstallWorkspace,
  type InstallPackage,
} from '@/components/install-workspace';
import { PlaybookWorkspace } from '@/components/playbook-workspace';
import { PlayField } from '@/components/play-field';
import type { Assignment as PlayAssignment } from '@/lib/play-designer';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Toaster, toast } from '@/components/ui/toast';
import type {
  AthleteMetrics,
  AthleteRecord,
  AthleteStatus,
  AthleteUnit,
  CalendarEventRecord,
  DepthChartPayload,
  InstallItemRecord,
  InstallReview,
} from '@/types/domain';

const primaryNavigation = [
  { label: 'Home', icon: LayoutDashboard },
  { label: 'Film Room', icon: Film },
  { label: 'Sideline', icon: Radio },
  { label: 'Athletes', icon: Users },
  { label: 'Depth Charts', icon: Shirt },
];

const planningNavigation = [
  { label: 'Reports', icon: SlidersHorizontal },
  { label: 'Gameplanning', icon: Zap },
  { label: 'Calendar', icon: CalendarDays },
  { label: 'Practice Plans', icon: ClipboardList },
];

const workspaceNavigation = [
  { label: 'Messages', icon: MessageSquareText, badge: undefined },
  { label: 'Settings', icon: Settings, badge: undefined },
];

const focusableTools = new Set(['Film Room', 'Sideline', 'Playbook']);
const playerAllowedViews = new Set(['Home', 'Messages', 'Install']);

type NoticeTone = 'success' | 'info' | 'warning' | 'error';
type Notify = (message: string, tone?: NoticeTone) => void;
type TeamSettings = {
  teamName: string;
  level: string;
  city: string;
  province: string;
  colour: string;
  season: string;
  notifications: boolean;
  practiceFacility: string;
  homeField: string;
  teamRoom: string;
};

const initialTeamSettings: TeamSettings = {
  teamName: '',
  level: '',
  city: '',
  province: '',
  colour: 'navy',
  season: String(new Date().getFullYear()),
  notifications: true,
  practiceFacility: '',
  homeField: '',
  teamRoom: '',
};

function formText(fields: FormData, name: string, fallback = '') {
  const value = fields.get(name);
  return typeof value === 'string' ? value : fallback;
}

function initialsFor(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || 'TM'
  );
}

async function loadWorkspaceState<T>(key: string, fallback: T): Promise<T> {
  const response = await fetch(
    `/api/workspace-state?key=${encodeURIComponent(key)}`,
    { cache: 'no-store' },
  );
  const body = (await response.json()) as { value?: T | null; error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Unable to load saved data.');
  return body.value ?? fallback;
}

async function saveWorkspaceState(key: string, value: unknown) {
  const response = await fetch('/api/workspace-state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
  const body = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Unable to save changes.');
}

function downloadText(
  filename: string,
  content: string,
  mime = 'text/plain;charset=utf-8',
) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function quoteCsv(value: unknown) {
  const rendered =
    value == null
      ? ''
      : typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          typeof value === 'bigint'
        ? String(value)
        : JSON.stringify(value);
  return `"${rendered.replaceAll('"', '""')}"`;
}

function mediaUrl(key: string, revision = 0) {
  return `/api/media?key=${encodeURIComponent(key)}&v=${revision}`;
}

async function uploadMedia(key: string, file: File) {
  if (!file.size) throw new Error('Choose a file that is not empty.');
  if (file.size > 250 * 1024 * 1024)
    throw new Error('Choose a file smaller than 250 MB.');
  const response = await fetch(`/api/media?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-chalktalk-upload-size': String(file.size),
      'x-chalktalk-filename': encodeURIComponent(file.name),
    },
    body: file,
  });
  if (response.status === 413)
    throw new Error(
      'This file is larger than the server currently accepts. Choose a smaller file.',
    );
  const body = (await response.json().catch(() => ({
    error: 'The upload service did not respond correctly. Please retry.',
  }))) as {
    error?: string;
    key?: string;
    contentType?: string;
    size?: number;
    uploadedAt?: string;
  };
  if (!response.ok || body.error || body.key !== key || body.size !== file.size)
    throw new Error(
      body.error ?? 'The upload could not be confirmed. Please retry.',
    );
  return body;
}

async function deleteMedia(key: string) {
  const response = await fetch(`/api/media?key=${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Unable to remove media.');
}

function MediaAvatar({
  assetKey,
  revision,
  fallback,
  className,
  label,
}: {
  assetKey: string;
  revision: number;
  fallback: ReactNode;
  className: string;
  label: string;
}) {
  const url = mediaUrl(assetKey, revision);
  const [failedUrl, setFailedUrl] = useState('');
  const failed = failedUrl === url;
  return (
    <span
      className={`${className} media-avatar`}
      title={failed ? `${label} has no uploaded image` : label}
    >
      {failed ? (
        fallback
      ) : (
        <NextImage
          alt={label}
          fill
          onError={() => setFailedUrl(url)}
          sizes="64px"
          src={url}
          unoptimized
        />
      )}
    </span>
  );
}

function MediaUploadControl({
  assetKey,
  accept = 'image/*',
  label,
  onUploaded,
  onNotify,
  disabled = false,
}: {
  assetKey: string | (() => string);
  accept?: string;
  label: string;
  onUploaded: (file?: File, storageKey?: string) => void | Promise<void>;
  onNotify: Notify;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const storageKey = typeof assetKey === 'function' ? assetKey() : assetKey;
      await uploadMedia(storageKey, file);
      await onUploaded(file, storageKey);
      onNotify(`${file.name} uploaded.`);
    } catch (error) {
      onNotify(
        error instanceof Error
          ? error.message
          : `${label} could not be uploaded.`,
        'error',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className={`media-upload-control${busy ? ' busy' : ''}`}>
      <Upload /> <span>{busy ? 'Uploading…' : label}</span>
      <input
        accept={accept}
        disabled={busy || disabled}
        onChange={upload}
        type="file"
      />
    </label>
  );
}

export default function Home() {
  return (
    <WorkspaceGate>
      {(session) => <WorkspaceHome session={session} />}
    </WorkspaceGate>
  );
}

function WorkspaceHome({ session }: { session: WorkspaceSession }) {
  const [searchTarget, setSearchTarget] = useState<
    (SearchResult & { revision: number }) | null
  >(null);
  const [activeView, setActiveViewUnsafe] = useState('Home');
  const [pendingView, setPendingView] = useState('');
  const editingPlayRef = useRef(false);
  const onPlayEditingChange = useCallback((editing: boolean) => {
    editingPlayRef.current = editing;
  }, []);
  const setActiveView = useCallback((view: string) => {
    if (editingPlayRef.current) setPendingView(view);
    else {
      setSearchTarget(null);
      setActiveViewUnsafe(view);
    }
  }, []);
  const [isDark, setIsDark] = useState(true);
  const [userRole, setUserRole] = useState<'Coach' | 'Player'>('Coach');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [assetRevision, setAssetRevision] = useState(0);
  const [settingsLoad, setSettingsLoad] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [settingsRetry, setSettingsRetry] = useState(0);
  const [dashboardLoad, setDashboardLoad] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [dashboardRetry, setDashboardRetry] = useState(0);
  const [dashboardEvents, setDashboardEvents] = useState<CalendarEventRecord[]>(
    [],
  );
  const [dashboardInstall, setDashboardInstall] = useState<{
    items: InstallItemRecord[];
    reviews: InstallReview[];
  }>({ items: [], reviews: [] });
  const [teamSettings, setTeamSettings] = useState<TeamSettings>({
    ...initialTeamSettings,
    teamName: session.team?.name ?? '',
    season: session.team?.season ?? initialTeamSettings.season,
  });
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);
  const [toolFocus, setToolFocus] = useState(false);
  const [loadingVisible, setLoadingVisible] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const teamMenuRef = useRef<HTMLDivElement>(null);
  const pendingRequestCount = useRef(0);
  const loadingThreshold = useRef<number | null>(null);

  const notify = useCallback<Notify>((message, tone = 'success') => {
    toast.add({ title: message, type: tone, timeout: 3200 });
  }, []);

  useEffect(() => {
    const storedTheme =
      window.localStorage.getItem('chalktalk-theme') !== 'light';
    const frame = window.requestAnimationFrame(() => setIsDark(storedTheme));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const trackedFetch: typeof window.fetch = async (...args) => {
      pendingRequestCount.current += 1;
      if (pendingRequestCount.current === 1) {
        loadingThreshold.current = window.setTimeout(
          () => setLoadingVisible(true),
          400,
        );
      }
      try {
        return await originalFetch(...args);
      } finally {
        pendingRequestCount.current = Math.max(
          0,
          pendingRequestCount.current - 1,
        );
        if (pendingRequestCount.current === 0) {
          if (loadingThreshold.current !== null)
            window.clearTimeout(loadingThreshold.current);
          loadingThreshold.current = null;
          setLoadingVisible(false);
        }
      }
    };
    window.fetch = trackedFetch;
    return () => {
      window.fetch = originalFetch;
      if (loadingThreshold.current !== null)
        window.clearTimeout(loadingThreshold.current);
    };
  }, []);

  useEffect(() => {
    if (!profileMenuOpen && !teamMenuOpen) return;
    const closeOnOutsideClick = (event: globalThis.PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node))
        setProfileMenuOpen(false);
      if (!teamMenuRef.current?.contains(event.target as Node))
        setTeamMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileMenuOpen(false);
        setTeamMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [profileMenuOpen, teamMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    loadWorkspaceState('team-settings', initialTeamSettings)
      .then((saved) => {
        if (cancelled) return;
        setTeamSettings({ ...initialTeamSettings, ...saved });
        setSettingsLoad('ready');
      })
      .catch(() => {
        if (!cancelled) setSettingsLoad('error');
      });
    return () => {
      cancelled = true;
    };
  }, [settingsRetry]);

  useEffect(() => {
    if (activeView !== 'Home') return;
    let cancelled = false;
    const load = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setDashboardLoad('loading');
      const { events, install } = await loadDashboard();
      if (cancelled) return;
      setDashboardEvents(events);
      setDashboardInstall(install);
      setDashboardLoad('ready');
    };
    void load().catch(() => {
      if (!cancelled) setDashboardLoad('error');
    });
    return () => {
      cancelled = true;
    };
  }, [activeView, dashboardRetry]);

  const nextGameEvent = dashboardEvents.find(
    (event) => event.eventType === 'game',
  );
  const agendaEvents = dashboardEvents
    .filter((event) => event.eventType !== 'game')
    .slice(0, 3);
  const installReadiness = dashboardInstall.items.length
    ? Math.round(
        dashboardInstall.items.reduce(
          (total, item) => total + item.complete,
          0,
        ) / dashboardInstall.items.length,
      )
    : 0;
  const completedInstallReviews = dashboardInstall.reviews.filter(
    (review) => review.acknowledged,
  ).length;

  const toggleTheme = () => {
    setIsDark((current) => {
      window.localStorage.setItem(
        'chalktalk-theme',
        current ? 'light' : 'dark',
      );
      return !current;
    });
  };

  const changeRole = (role: 'Coach' | 'Player') => {
    if (editingPlayRef.current) {
      setProfileMenuOpen(false);
      notify('Save or cancel the current play before switching roles.', 'info');
      return;
    }
    setUserRole(role);
    setActiveView('Home');
    setProfileMenuOpen(false);
  };

  const openSearchRecord = (record: SearchResult) => {
    if (editingPlayRef.current) {
      notify(
        'Save or cancel your current changes before opening a search result.',
        'info',
      );
      return false;
    }
    setSearchTarget({ ...record, revision: Date.now() });
    setActiveViewUnsafe(
      record.kind === 'play'
        ? 'Playbook'
        : record.kind === 'athlete'
          ? 'Athletes'
          : 'Film Room',
    );
    return true;
  };

  const accountName =
    userRole === 'Coach' ? session.user.name : 'Player account';
  const accountInitials = initialsFor(accountName);
  const mobileQuickLinks = [
    { label: 'Home', icon: LayoutDashboard },
    { label: 'Film Room', icon: Film },
    { label: 'Playbook', icon: BookOpen },
    { label: 'Install', icon: ClipboardList },
  ].filter(
    (item) => userRole === 'Coach' || playerAllowedViews.has(item.label),
  );
  const mobileAllLinks = [
    ...primaryNavigation,
    { label: 'Playbook', icon: BookOpen },
    { label: 'Install', icon: ClipboardList },
    { label: 'Learn', icon: GraduationCap },
    { label: 'Printouts', icon: Printer },
    { label: 'Leaderboard', icon: Trophy },
    { label: 'Formations', icon: Shirt },
    ...planningNavigation,
    ...workspaceNavigation,
  ].filter(
    (item) => userRole === 'Coach' || playerAllowedViews.has(item.label),
  );
  const teamShortName =
    teamSettings.teamName
      .trim()
      .replace(/\s+(wolves|tigers|eagles|bears|lions)$/i, '') ||
    teamSettings.teamName;
  const teamInitials = initialsFor(teamSettings.teamName);
  const programLabel =
    teamSettings.level === 'junior'
      ? 'Junior varsity'
      : teamSettings.level === 'club'
        ? 'Club'
        : 'Varsity';
  const currentHour = new Date().getHours();
  const coachGreeting =
    currentHour < 12
      ? 'Good morning, Coach.'
      : currentHour < 17
        ? 'Good afternoon, Coach.'
        : 'Good evening, Coach.';

  if (settingsLoad !== 'ready')
    return (
      <main className="workspace-welcome">
        <section aria-busy={settingsLoad === 'loading'}>
          <span className="eyebrow">ChalkTalk · Your workspace</span>
          <h1>
            {settingsLoad === 'error'
              ? 'Unable to load your team settings.'
              : 'Opening your team…'}
          </h1>
          {settingsLoad === 'error' ? (
            <>
              <p role="alert">
                Your saved settings could not be loaded. Retry before making
                changes.
              </p>
              <Button
                onClick={() => {
                  setSettingsLoad('loading');
                  setSettingsRetry((value) => value + 1);
                }}
              >
                Retry
              </Button>
            </>
          ) : (
            <output>Loading your saved team profile.</output>
          )}
        </section>
      </main>
    );

  return (
    <main
      className={`${isDark ? 'app-shell dark' : 'app-shell'}${sidebarCollapsed ? ' sidebar-collapsed' : ''}${toolFocus && focusableTools.has(activeView) ? ' tool-focus' : ''}`}
      data-team-colour={teamSettings.colour}
    >
      <aside className="sidebar">
        <button
          aria-label={
            sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'
          }
          className="sidebar-collapse-toggle"
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          type="button"
        >
          {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
        <div className="brand-lockup">
          <span className="brand-mark brand-mark-v2">
            <span>CT</span>
          </span>
          <span className="brand-name">
            <strong>
              chalk<span>talk</span>
            </strong>
            <small>FOOTBALL OS</small>
          </span>
        </div>

        <div className="team-menu-wrap" ref={teamMenuRef}>
          <button
            aria-expanded={teamMenuOpen}
            aria-haspopup="menu"
            className="team-switcher"
            onClick={() => setTeamMenuOpen((open) => !open)}
            type="button"
          >
            <MediaAvatar
              assetKey="team-logo"
              className="team-crest"
              fallback={teamInitials}
              label={`${teamSettings.teamName} logo`}
              revision={assetRevision}
            />
            <span className="min-w-0 flex-1 text-left">
              <strong>{teamShortName}</strong>
              <small>
                {programLabel} · {teamSettings.season}
              </small>
            </span>
            <ChevronDown className={teamMenuOpen ? 'rotated' : ''} size={15} />
          </button>
          {teamMenuOpen ? (
            <div className="team-switcher-menu" role="menu">
              <div>
                <MediaAvatar
                  assetKey="team-logo"
                  className="team-crest"
                  fallback={teamInitials}
                  label={`${teamSettings.teamName} logo`}
                  revision={assetRevision}
                />
                <span>
                  <strong>{teamSettings.teamName}</strong>
                  <small>Active team workspace</small>
                </span>
                <Check />
              </div>
              {userRole === 'Coach' ? (
                <button
                  onClick={() => {
                    setActiveView('Settings');
                    setTeamMenuOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Settings />
                  <span>
                    <strong>Team settings</strong>
                    <small>Identity, season, staff, and defaults</small>
                  </span>
                </button>
              ) : (
                <p>
                  <Lock /> Team settings are managed by coaches.
                </p>
              )}
            </div>
          ) : null}
        </div>

        <nav aria-label="Main navigation" className="nav-stack">
          <p className="nav-label">Team</p>
          {primaryNavigation
            .filter((item) => userRole === 'Coach' || item.label === 'Home')
            .map((item) => (
              <button
                className={
                  activeView === item.label ? 'nav-item active' : 'nav-item'
                }
                onClick={() => setActiveView(item.label)}
                title={item.label}
                type="button"
                key={item.label}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </button>
            ))}
          <details className="pd-nav-section">
            <summary>
              <span>Playbook</span>
              <ChevronDown size={14} />
            </summary>
            {[
              'Playbook',
              'Install',
              'Learn',
              'Printouts',
              'Leaderboard',
              'Formations',
            ]
              .filter((view) => userRole === 'Coach' || view === 'Install')
              .map((view) => (
                <button
                  key={view}
                  className={
                    activeView === view ? 'nav-item active' : 'nav-item'
                  }
                  onClick={() => setActiveView(view)}
                  type="button"
                >
                  {view === 'Formations' ? (
                    <Shirt size={16} />
                  ) : view === 'Install' ? (
                    <ClipboardList size={16} />
                  ) : view === 'Learn' ? (
                    <GraduationCap size={16} />
                  ) : view === 'Printouts' ? (
                    <Printer size={16} />
                  ) : view === 'Leaderboard' ? (
                    <Trophy size={16} />
                  ) : (
                    <BookOpen size={16} />
                  )}
                  <span>{view}</span>
                </button>
              ))}
          </details>
          {userRole === 'Coach' ? <p className="nav-label mt-7">Plan</p> : null}
          {planningNavigation
            .filter(() => userRole === 'Coach')
            .map((item) => (
              <button
                className={
                  activeView === item.label ? 'nav-item active' : 'nav-item'
                }
                onClick={() => setActiveView(item.label)}
                title={item.label}
                type="button"
                key={item.label}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </button>
            ))}
          <p className="nav-label mt-7">Workspace</p>
          {workspaceNavigation
            .filter(
              (item) =>
                userRole === 'Coach' ||
                ['Messages', 'Install'].includes(item.label),
            )
            .map((item) => (
              <button
                className={
                  activeView === item.label ? 'nav-item active' : 'nav-item'
                }
                onClick={() => setActiveView(item.label)}
                title={item.label}
                type="button"
                key={item.label}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {item.badge ? (
                  <span className="nav-badge">{item.badge}</span>
                ) : null}
              </button>
            ))}
        </nav>

        <div className="season-card">
          <div className="flex items-center justify-between">
            <span className="eyebrow text-white/50">Season</span>
            <Sparkles size={15} className="text-[#ff8a72]" />
          </div>
          <strong>{teamSettings.season}</strong>
          <span>
            {dashboardLoad !== 'ready'
              ? dashboardLoad === 'error'
                ? 'Schedule unavailable'
                : 'Loading schedule…'
              : nextGameEvent
                ? `Next: ${new Date(nextGameEvent.startsAt).toLocaleDateString([], { weekday: 'short' })} · ${new Date(nextGameEvent.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                : 'No game scheduled'}
          </span>
          <small>
            {teamShortName} · {programLabel}
          </small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark brand-mark-v2">
              <span>CT</span>
            </span>
            <strong>
              chalk<span>talk</span>
            </strong>
          </div>
          {userRole === 'Coach' && (
            <WorkspaceSearch onOpenRecord={openSearchRecord} />
          )}
          <div className="top-actions">
            <Button
              aria-label="Notifications"
              className="rounded-full"
              onClick={() => setActiveView('Messages')}
              size="icon-lg"
              variant="ghost"
            >
              <Bell />
            </Button>
            <div className="profile-menu-wrap" ref={profileMenuRef}>
              <button
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
                className="profile-trigger"
                onClick={() => setProfileMenuOpen((open) => !open)}
                type="button"
              >
                <MediaAvatar
                  assetKey={
                    userRole === 'Coach' ? 'coach-profile' : 'player-profile'
                  }
                  className="profile-avatar"
                  fallback={accountInitials}
                  label={`${accountName} profile photo`}
                  revision={assetRevision}
                />
                <span className="profile-name">
                  {accountName} <ChevronDown size={14} />
                </span>
              </button>
              {profileMenuOpen ? (
                <div
                  aria-label="Account menu"
                  className="profile-menu"
                  role="menu"
                >
                  <div className="profile-menu-head">
                    <MediaAvatar
                      assetKey={
                        userRole === 'Coach'
                          ? 'coach-profile'
                          : 'player-profile'
                      }
                      className="profile-avatar"
                      fallback={accountInitials}
                      label={`${accountName} profile photo`}
                      revision={assetRevision}
                    />
                    <span>
                      <strong>{accountName}</strong>
                      <small>{userRole} workspace</small>
                    </span>
                  </div>
                  {userRole === 'Coach' ? (
                    <button
                      onClick={() => {
                        setActiveView('Settings');
                        setProfileMenuOpen(false);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <Settings />
                      <span>
                        <strong>Profile &amp; team settings</strong>
                        <small>
                          Account media, identity, and workspace defaults
                        </small>
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setActiveView('Home');
                        setProfileMenuOpen(false);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <Users />
                      <span>
                        <strong>Player workspace</strong>
                        <small>Assignments and team messages</small>
                      </span>
                    </button>
                  )}
                  {session.mode === 'prototype' ? (
                    <>
                      <button
                        onClick={() => changeRole('Coach')}
                        role="menuitem"
                        type="button"
                      >
                        <Shield />
                        <span>
                          <strong>Coach view</strong>
                          <small>
                            {userRole === 'Coach'
                              ? 'Currently active'
                              : 'Open the staff workspace'}
                          </small>
                        </span>
                      </button>
                      <button
                        onClick={() => changeRole('Player')}
                        role="menuitem"
                        type="button"
                      >
                        <Users />
                        <span>
                          <strong>Player view</strong>
                          <small>
                            {userRole === 'Player'
                              ? 'Currently active'
                              : 'Preview a connected player account'}
                          </small>
                        </span>
                      </button>
                    </>
                  ) : (
                    // Sites sign-out requires top-level navigation.
                    // eslint-disable-next-line next/no-html-link-for-pages
                    <a
                      href="/signout-with-chatgpt?return_to=%2F"
                      target="_top"
                      role="menuitem"
                    >
                      Sign out
                    </a>
                  )}
                  <button
                    onClick={() => {
                      toggleTheme();
                      setProfileMenuOpen(false);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {isDark ? <Sun /> : <Moon />}
                    <span>
                      <strong>Use {isDark ? 'light' : 'dark'} theme</strong>
                      <small>Change this device only</small>
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div
          className={
            activeView === 'Home'
              ? `content-grid home-clean${userRole === 'Player' ? ' player-home-grid' : ''}`
              : 'content-grid module-grid'
          }
        >
          {activeView === 'Home' ? (
            userRole === 'Coach' && dashboardLoad !== 'ready' ? (
              <section
                className="module-surface"
                aria-busy={dashboardLoad === 'loading'}
              >
                <h1>Team overview</h1>
                {dashboardLoad === 'error' ? (
                  <>
                    <p role="alert">
                      Your schedule and install progress could not be loaded.
                      Your saved data has not been changed.
                    </p>
                    <Button
                      onClick={() => setDashboardRetry((value) => value + 1)}
                    >
                      Retry overview
                    </Button>
                  </>
                ) : (
                  <output>Loading your schedule and install progress…</output>
                )}
              </section>
            ) : userRole === 'Coach' ? (
              <>
                <div className="main-column">
                  <section className="welcome-row">
                    <div>
                      <p className="eyebrow">Team overview</p>
                      <h1>{coachGreeting}</h1>
                      <p>
                        Everything your team needs for the next kickoff, in one
                        place.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        className="h-10 rounded-xl bg-[#101d2e] px-4 text-white hover:bg-[#20344f]"
                        onClick={() => setActiveView('Film Room')}
                      >
                        <Play data-icon="inline-start" fill="currentColor" />{' '}
                        Start film session
                      </Button>
                    </div>
                  </section>

                  <section className="game-card">
                    <div className="game-card-top">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge className="bg-[#e4472e] text-white">
                            NEXT GAME
                          </Badge>
                          <span className="text-xs font-medium text-slate-500">
                            Saved schedule
                          </span>
                        </div>
                        <p className="game-kicker">
                          {nextGameEvent
                            ? `${new Date(nextGameEvent.startsAt).toLocaleDateString([], { weekday: 'long' })} · ${new Date(nextGameEvent.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${nextGameEvent.location}`
                            : 'Add the next game in Calendar'}
                        </p>
                      </div>
                      <Button
                        aria-label="Game options"
                        onClick={() => setActiveView('Gameplanning')}
                        size="icon"
                        variant="ghost"
                      >
                        <MoreHorizontal />
                      </Button>
                    </div>

                    <div className="matchup">
                      <div className="team-panel">
                        <MediaAvatar
                          assetKey="team-logo"
                          className="large-crest home-crest"
                          fallback={teamInitials}
                          label={`${teamSettings.teamName} logo`}
                          revision={assetRevision}
                        />
                        <div>
                          <strong>{teamShortName}</strong>
                          <small>
                            {programLabel} · {teamSettings.season}
                          </small>
                        </div>
                      </div>
                      <div className="versus">
                        <span>VS</span>
                        <small>{nextGameEvent ? 'Scheduled' : 'Open'}</small>
                      </div>
                      <div className="team-panel away">
                        <div>
                          <strong>
                            {nextGameEvent
                              ? nextGameEvent.title.split(' at ')[0]
                              : 'Opponent not scheduled'}
                          </strong>
                          <small>
                            {nextGameEvent
                              ? 'Scheduled game'
                              : 'Open Calendar to add one'}
                          </small>
                        </div>
                        <MediaAvatar
                          assetKey="opponent-logo"
                          className="large-crest away-crest"
                          fallback="OP"
                          label="Opponent logo"
                          revision={assetRevision}
                        />
                      </div>
                    </div>

                    <div className="readiness">
                      <div className="readiness-heading">
                        <strong>Game-day readiness</strong>
                        <span>{installReadiness}%</span>
                      </div>
                      <div className="readiness-track">
                        <span style={{ width: `${installReadiness}%` }} />
                      </div>
                      <div className="readiness-items">
                        <span>
                          <i className={dashboardEvents.length ? 'done' : ''} />{' '}
                          {dashboardEvents.length} calendar{' '}
                          {dashboardEvents.length === 1 ? 'event' : 'events'}{' '}
                          scheduled
                        </span>
                        <span>
                          <i
                            className={
                              dashboardInstall.items.length ? 'done' : ''
                            }
                          />{' '}
                          {dashboardInstall.items.length} install{' '}
                          {dashboardInstall.items.length === 1
                            ? 'item'
                            : 'items'}
                        </span>
                        <span>
                          <i /> Install at {installReadiness}%
                        </span>
                        <span>
                          <i />{' '}
                          {dashboardInstall.reviews.length -
                            completedInstallReviews}{' '}
                          athlete reviews open
                        </span>
                      </div>
                    </div>
                  </section>

                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Pick up where you left off</p>
                      <h2>Recent work</h2>
                    </div>
                    <button
                      onClick={() => setActiveView('Reports')}
                      type="button"
                    >
                      View all
                    </button>
                  </div>

                  <section className="recent-grid">
                    <article className="film-card">
                      <HomeFilmPreview
                        onOpen={() => setActiveView('Film Room')}
                        revision={assetRevision}
                      />
                      <div className="card-copy">
                        <div>
                          <span className="content-type">FILM</span>
                          <strong>Team film library</strong>
                        </div>
                        <p>
                          Uploaded footage appears here—no sample film is
                          substituted.
                        </p>
                      </div>
                    </article>

                    <article className="play-card">
                      <HomePlayPreview
                        onOpen={() => setActiveView('Playbook')}
                      />
                      <div className="card-copy">
                        <div>
                          <span className="content-type playbook-type">
                            PLAYBOOK
                          </span>
                          <strong>Team play library</strong>
                        </div>
                        <p>
                          Saved diagrams appear here—no sample plays are
                          substituted.
                        </p>
                      </div>
                    </article>
                  </section>

                  <div className="section-heading week-heading">
                    <div>
                      <p className="eyebrow">Stay ahead</p>
                      <h2>Game week command board</h2>
                    </div>
                    <Badge className="live-plan-badge">
                      <span /> Live plan
                    </Badge>
                  </div>

                  <section className="command-board">
                    <article className="command-card agenda-card">
                      <div className="command-card-head">
                        <span className="command-icon blue">
                          <CalendarDays />
                        </span>
                        <div>
                          <strong>Upcoming agenda</strong>
                          <small>
                            {agendaEvents.length} saved{' '}
                            {agendaEvents.length === 1 ? 'event' : 'events'}
                          </small>
                        </div>
                        <ChevronRight />
                      </div>
                      <div className="agenda-list">
                        {agendaEvents.map((event, index) => (
                          <div key={event.id}>
                            <b>
                              {new Date(event.startsAt).toLocaleTimeString([], {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </b>
                            <span>
                              <strong>{event.title}</strong>
                              <small>
                                {event.location || 'Location not set'}
                              </small>
                            </span>
                            <i
                              className={
                                index === 0
                                  ? 'blue'
                                  : index === 1
                                    ? 'teal'
                                    : 'violet'
                              }
                            />
                          </div>
                        ))}
                        {agendaEvents.length === 0 ? (
                          <div className="dashboard-empty-row">
                            <CalendarDays />
                            <span>
                              <strong>No upcoming events</strong>
                              <small>Add one in Calendar.</small>
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </article>

                    <article className="command-card install-pulse-card">
                      <div className="command-card-head">
                        <span className="command-icon teal">
                          <ClipboardList />
                        </span>
                        <div>
                          <strong>Install pulse</strong>
                          <small>
                            {completedInstallReviews} of{' '}
                            {dashboardInstall.reviews.length} reviews complete
                          </small>
                        </div>
                        <button
                          onClick={() => setActiveView('Install')}
                          type="button"
                        >
                          Open
                        </button>
                      </div>
                      <div className="pulse-number">
                        <strong>{installReadiness}%</strong>
                        <span>Team completion</span>
                      </div>
                      <div className="readiness-track pulse">
                        <span style={{ width: `${installReadiness}%` }} />
                      </div>
                      <div className="unit-progress">
                        <span>
                          Assignments <b>{dashboardInstall.items.length}</b>
                        </span>
                        <span>
                          Complete <b>{completedInstallReviews}</b>
                        </span>
                        <span>
                          Open{' '}
                          <b>
                            {dashboardInstall.reviews.length -
                              completedInstallReviews}
                          </b>
                        </span>
                      </div>
                    </article>

                    <article className="command-card staff-focus-card">
                      <div className="command-card-head">
                        <span className="command-icon violet">
                          <Zap />
                        </span>
                        <div>
                          <strong>Next actions</strong>
                          <small>Based on saved workspace data</small>
                        </div>
                      </div>
                      <button
                        onClick={() => setActiveView('Install')}
                        type="button"
                      >
                        <span className="focus-status urgent">
                          {dashboardInstall.reviews.length -
                            completedInstallReviews}
                        </span>
                        <div>
                          <strong>Open athlete reviews</strong>
                          <small>Install · incomplete acknowledgements</small>
                        </div>
                        <ChevronRight />
                      </button>
                      <button
                        onClick={() => setActiveView('Calendar')}
                        type="button"
                      >
                        <span className="focus-status">
                          {agendaEvents.length}
                        </span>
                        <div>
                          <strong>Upcoming calendar</strong>
                          <small>
                            {agendaEvents.length
                              ? agendaEvents[0].title
                              : 'Add the first team event'}
                          </small>
                        </div>
                        <ChevronRight />
                      </button>
                    </article>
                  </section>
                </div>

                <aside className="right-rail">
                  <section className="rail-card chat-card">
                    <div className="rail-heading">
                      <div>
                        <p className="eyebrow">Team chat</p>
                        <h3>Messages</h3>
                      </div>
                    </div>
                    <div className="rail-empty-state">
                      <MessageSquareText />
                      <strong>No recent messages</strong>
                      <span>New team conversations will appear here.</span>
                    </div>
                    <Button
                      className="mt-2 h-9 w-full rounded-xl"
                      onClick={() => setActiveView('Messages')}
                      variant="outline"
                    >
                      <MessageSquareText /> Open team chat
                    </Button>
                  </section>

                  <section className="rail-card">
                    <div className="rail-heading">
                      <div>
                        <p className="eyebrow">Updates</p>
                        <h3>Team activity</h3>
                      </div>
                    </div>
                    <div className="rail-empty-state">
                      <Clock3 />
                      <strong>No recorded activity yet</strong>
                      <span>
                        Saved changes and completed reviews will populate this
                        feed once activity logging is connected.
                      </span>
                    </div>
                  </section>

                  <section className="rail-card quick-card">
                    <div className="rail-heading">
                      <div>
                        <p className="eyebrow">Quick access</p>
                        <h3>Build your week</h3>
                      </div>
                    </div>
                    <div className="quick-grid">
                      <button
                        onClick={() => setActiveView('Playbook')}
                        type="button"
                      >
                        <BookOpen />
                        <span>
                          <strong>New play</strong>
                          <small>Draw & install</small>
                        </span>
                      </button>
                      <button
                        onClick={() => setActiveView('Film Room')}
                        type="button"
                      >
                        <Film />
                        <span>
                          <strong>Upload film</strong>
                          <small>Add game tape</small>
                        </span>
                      </button>
                      <button
                        onClick={() => setActiveView('Depth Charts')}
                        type="button"
                      >
                        <Shield />
                        <span>
                          <strong>Depth chart</strong>
                          <small>Set starters</small>
                        </span>
                      </button>
                      <button
                        onClick={() => setActiveView('Sideline')}
                        type="button"
                      >
                        <Radio />
                        <span>
                          <strong>Sideline</strong>
                          <small>Start replay</small>
                        </span>
                      </button>
                    </div>
                  </section>
                </aside>
              </>
            ) : (
              <PlayerDashboard
                assetRevision={assetRevision}
                onNavigate={setActiveView}
              />
            )
          ) : (
            <ModuleView
              key={searchTarget?.revision ?? 'workspace'}
              searchTarget={searchTarget}
              onPlayEditingChange={onPlayEditingChange}
              assetRevision={assetRevision}
              focusMode={toolFocus && focusableTools.has(activeView)}
              onAssetsChanged={() => setAssetRevision(Date.now())}
              onNavigate={setActiveView}
              onNotify={notify}
              onTeamSettingsChange={setTeamSettings}
              onToggleFocus={() => setToolFocus((focused) => !focused)}
              teamSettings={teamSettings}
              userRole={userRole}
              view={activeView}
            />
          )}
        </div>
      </section>
      <nav aria-label="Mobile navigation" className="mobile-dock">
        {mobileQuickLinks.map((item) => (
          <button
            className={activeView === item.label ? 'active' : ''}
            key={item.label}
            onClick={() => setActiveView(item.label)}
            type="button"
          >
            <item.icon />
            <span>{item.label === 'Film Room' ? 'Film' : item.label}</span>
          </button>
        ))}
        <button
          type="button"
          aria-label="More sections"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen(true)}
        >
          <MoreHorizontal />
          <span>More</span>
        </button>
      </nav>
      <Dialog open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <DialogContent className="mobile-sections-dialog">
          <DialogHeader>
            <DialogTitle>Your workspace</DialogTitle>
            <DialogDescription>
              Open a team tool or manage your workspace.
            </DialogDescription>
          </DialogHeader>
          <nav
            aria-label="All workspace sections"
            className="mobile-sections-list"
          >
            {mobileAllLinks.map((item) => (
              <button
                key={item.label}
                type="button"
                aria-current={activeView === item.label ? 'page' : undefined}
                onClick={() => {
                  setMobileMenuOpen(false);
                  setActiveView(item.label);
                }}
              >
                <item.icon />
                <span>{item.label}</span>
                <ChevronRight />
              </button>
            ))}
          </nav>
        </DialogContent>
      </Dialog>
      {loadingVisible ? (
        <div aria-live="polite" className="app-loading-overlay">
          <div className="app-loading-card">
            <LoaderCircle aria-hidden="true" />
            <span>
              <strong>Loading saved data</strong>
              <small>Waiting for your workspace to respond…</small>
            </span>
          </div>
        </div>
      ) : null}
      <Toaster />
      <Dialog
        open={Boolean(pendingView)}
        onOpenChange={(open) => {
          if (!open) setPendingView('');
        }}
      >
        <DialogContent className="athlete-dialog">
          <DialogHeader>
            <DialogTitle>Leave the editor?</DialogTitle>
            <DialogDescription>
              Your unsaved changes will be discarded. Save your work first to
              keep them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setPendingView('')} variant="outline">
              Keep editing
            </Button>
            <Button
              onClick={() => {
                editingPlayRef.current = false;
                setActiveViewUnsafe(pendingView);
                setSearchTarget(null);
                setPendingView('');
              }}
              variant="destructive"
            >
              Discard and leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function HomeFilmPreview({
  onOpen,
  revision,
}: {
  onOpen: () => void;
  revision: number;
}) {
  const [film, setFilm] = useState<FilmAssetRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [failedSource, setFailedSource] = useState('');
  useEffect(() => {
    let active = true;
    readFilmData()
      .then((data) => {
        if (active) {
          setFilm(data.asset);
          setError('');
        }
      })
      .catch(() => {
        if (active) setError('The saved film library could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const source = film?.storageKey ? mediaUrl(film.storageKey, revision) : '';
  const [readySource, setReadySource] = useState('');
  const available = Boolean(source && readySource === source);
  return (
    <div
      className={`film-preview real-media-preview${available ? ' available' : ''}`}
    >
      {source ? (
        <video
          aria-label="Uploaded team film"
          muted
          onCanPlay={() => setReadySource(source)}
          onError={() => {
            setReadySource('');
            setFailedSource(source);
          }}
          preload="metadata"
          src={source}
        />
      ) : null}
      {available ? (
        <button
          aria-label="Open team film"
          className="play-button"
          onClick={onOpen}
          type="button"
        >
          <Play fill="currentColor" />
        </button>
      ) : (
        <button className="real-media-empty" onClick={onOpen} type="button">
          <Film />
          <strong>
            {error || (source && failedSource === source)
              ? 'Film unavailable'
              : loading || source
                ? 'Loading film…'
                : 'No film uploaded'}
          </strong>
          <span>
            {error || (source && failedSource === source)
              ? 'Open Film Room to retry'
              : source
                ? film?.title
                : 'Add game footage in Film Room'}
          </span>
        </button>
      )}
    </div>
  );
}

function HomePlayPreview({ onOpen }: { onOpen: () => void }) {
  const [play, setPlay] = useState<StudioPlay | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    loadPlaybookData()
      .then((saved) => {
        if (active)
          setPlay(
            saved.plays.find(
              (item) =>
                (item.players?.length ?? 0) +
                  (item.routes?.length ?? 0) +
                  (item.zones?.length ?? 0) +
                  (item.labels?.length ?? 0) >
                0,
            ) ??
              saved.plays[0] ??
              null,
          );
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <button
      aria-label="Open saved playbooks"
      className="play-preview real-play-preview"
      onClick={onOpen}
      type="button"
    >
      {play &&
      (play.players?.length ?? 0) +
        (play.routes?.length ?? 0) +
        (play.zones?.length ?? 0) +
        (play.labels?.length ?? 0) >
        0 ? (
        <StudioPlayDiagram label={false} play={play} />
      ) : (
        <span className="real-media-empty">
          <BookOpen />
          <strong>
            {error
              ? 'Playbook unavailable'
              : loading
                ? 'Loading saved plays…'
                : 'No diagram saved'}
          </strong>
          <span>
            {error
              ? 'Open Playbook to retry'
              : 'Open Playbook to create a play'}
          </span>
        </span>
      )}
    </button>
  );
}

function PlayerDashboard({
  assetRevision,
  onNavigate,
}: {
  assetRevision: number;
  onNavigate: (view: string) => void;
}) {
  return (
    <div className="main-column player-home">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">Player view</p>
          <h1>Player workspace</h1>
          <p>A focused home for assigned learning and team communication.</p>
        </div>
      </section>

      <section className="player-home-shell">
        <header className="player-home-profile">
          <MediaAvatar
            assetKey="player-profile"
            className="detail-avatar"
            fallback="PL"
            label="Player account profile photo"
            revision={assetRevision}
          />
          <div>
            <Badge variant="outline">Setup needed</Badge>
            <h2>Player account is not connected yet</h2>
            <p>
              A coach must link this login to a roster athlete before private
              assignments or feedback can appear.
            </p>
          </div>
          <Lock />
        </header>
        <div className="player-home-actions">
          <article>
            <span className="command-icon violet">
              <ClipboardList />
            </span>
            <div>
              <strong>Assigned learning</strong>
              <p>
                Install reviews will appear here once the account is linked.
              </p>
            </div>
            <Button onClick={() => onNavigate('Install')} variant="outline">
              Open install <ChevronRight />
            </Button>
          </article>
          <article>
            <span className="command-icon blue">
              <MessageSquareText />
            </span>
            <div>
              <strong>Team communication</strong>
              <p>
                Use the player-safe workspace to read and send team messages.
              </p>
            </div>
            <Button onClick={() => onNavigate('Messages')} variant="outline">
              Open messages <ChevronRight />
            </Button>
          </article>
        </div>
        <div className="player-access-note">
          <Shield />
          <span>
            <strong>Player permissions are active</strong>
            <small>
              Team settings, roster management, planning tools, and coach-only
              workspaces are hidden.
            </small>
          </span>
        </div>
      </section>
    </div>
  );
}

type ModuleProps = {
  searchTarget: SearchResult | null;
  onPlayEditingChange: (editing: boolean) => void;
  view: string;
  userRole: 'Coach' | 'Player';
  focusMode: boolean;
  onToggleFocus: () => void;
  onNavigate: (view: string) => void;
  onNotify: Notify;
  assetRevision: number;
  onAssetsChanged: () => void;
  teamSettings: TeamSettings;
  onTeamSettingsChange: (settings: TeamSettings) => void;
};

function ModuleView({
  searchTarget,
  view,
  userRole,
  focusMode,
  onToggleFocus,
  onNavigate,
  onNotify,
  assetRevision,
  onAssetsChanged,
  teamSettings,
  onTeamSettingsChange,
  onPlayEditingChange,
}: ModuleProps) {
  if (userRole === 'Player' && !playerAllowedViews.has(view))
    return (
      <PlayerDashboard assetRevision={assetRevision} onNavigate={onNavigate} />
    );
  if (view === 'Film Room')
    return (
      <FilmRoomView
        initialAssetId={searchTarget?.kind === 'film' ? searchTarget.id : ''}
        assetRevision={assetRevision}
        focusMode={focusMode}
        onAssetsChanged={onAssetsChanged}
        onNavigate={onNavigate}
        onNotify={onNotify}
        onToggleFocus={onToggleFocus}
        onEditingChange={onPlayEditingChange}
      />
    );
  if (
    ['Playbook', 'Formations', 'Learn', 'Printouts', 'Leaderboard'].includes(
      view,
    )
  )
    return (
      <PlaybookWorkspace
        initialPlayId={searchTarget?.kind === 'play' ? searchTarget.id : ''}
        view={view}
        onEditingChange={onPlayEditingChange}
        onNavigate={onNavigate}
      />
    );
  if (view === 'Sideline')
    return (
      <SidelineView
        assetRevision={assetRevision}
        focusMode={focusMode}
        onNavigate={onNavigate}
        onNotify={onNotify}
        onToggleFocus={onToggleFocus}
        teamSettings={teamSettings}
      />
    );
  if (view === 'Athletes')
    return (
      <AthletesView
        initialAthleteId={
          searchTarget?.kind === 'athlete' ? searchTarget.id : ''
        }
        onEditingChange={onPlayEditingChange}
        assetRevision={assetRevision}
        onAssetsChanged={onAssetsChanged}
        onNotify={onNotify}
      />
    );
  if (view === 'Depth Charts') return <DepthChartsView onNotify={onNotify} />;
  if (view === 'Messages')
    return (
      <MessagesView
        onNavigate={onNavigate}
        onNotify={onNotify}
        teamSettings={teamSettings}
      />
    );
  if (view === 'Install')
    return (
      <InstallWorkspace<StudioPlay>
        onNavigate={onNavigate}
        playerView={userRole === 'Player'}
        renderDiagram={(play) => <StudioPlayDiagram play={play} />}
      />
    );
  if (view === 'Reports')
    return <ReportsView onNavigate={onNavigate} onNotify={onNotify} />;
  if (view === 'Gameplanning')
    return <GameplanningView onNavigate={onNavigate} onNotify={onNotify} />;
  if (view === 'Calendar')
    return (
      <CalendarView
        onEditingChange={onPlayEditingChange}
        onNavigate={onNavigate}
        onNotify={onNotify}
        teamSettings={teamSettings}
      />
    );
  if (view === 'Practice Plans')
    return <PracticePlansView onNavigate={onNavigate} onNotify={onNotify} />;
  return (
    <SettingsView
      assetRevision={assetRevision}
      onAssetsChanged={onAssetsChanged}
      onNavigate={onNavigate}
      onNotify={onNotify}
      onTeamSettingsChange={onTeamSettingsChange}
      teamSettings={teamSettings}
    />
  );
}

function ModuleHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="module-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children ? <div className="module-actions">{children}</div> : null}
    </div>
  );
}

function FocusModeButton({
  focused,
  onToggle,
}: {
  focused: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      aria-pressed={focused}
      className="focus-mode-button"
      onClick={onToggle}
      variant="outline"
    >
      {focused ? <PanelLeftOpen /> : <Maximize2 />}
      {focused ? 'Exit focus' : 'Focus mode'}
    </Button>
  );
}

type FilmAssetRecord = {
  id: string;
  gameId: string | null;
  opponent: string | null;
  title: string;
  storageKey: string | null;
  durationSeconds: number;
  status: string;
  createdAt: string;
};
type FilmClipRecord = {
  id: string;
  assetId: string;
  playId: string | null;
  playName: string | null;
  clipNumber: number;
  startSeconds: number;
  endSeconds: number;
  odk: string;
  down: number | null;
  distance: number | null;
  yardLine: string;
  result: string;
  tags: string[];
  note: string;
  concept: string;
  quarter: string;
  clock: string;
};
type FilmPayload = {
  assets: FilmAssetRecord[];
  asset: FilmAssetRecord | null;
  clips: FilmClipRecord[];
  error?: string;
};

async function readFilmData(assetId = ''): Promise<FilmPayload> {
  const response = await fetch(
    `/api/film${assetId ? `?assetId=${encodeURIComponent(assetId)}` : ''}`,
    { cache: 'no-store' },
  );
  const data = (await response.json()) as FilmPayload;
  if (!response.ok || !Array.isArray(data.assets) || !Array.isArray(data.clips))
    throw new Error(data.error ?? 'Saved film could not be loaded.');
  return data;
}

function clipLabel(clip: FilmClipRecord) {
  return clip.playName || clip.concept || `Clip ${clip.clipNumber}`;
}

function FilmRoomView({
  initialAssetId = '',
  assetRevision,
  focusMode,
  onAssetsChanged,
  onNavigate,
  onNotify,
  onToggleFocus,
  onEditingChange,
}: {
  initialAssetId?: string;
  assetRevision: number;
  focusMode: boolean;
  onAssetsChanged: () => void;
  onNavigate: (view: string) => void;
  onNotify: Notify;
  onToggleFocus: () => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [filmAsset, setFilmAsset] = useState<FilmAssetRecord | null>(null);
  const [filmAssets, setFilmAssets] = useState<FilmAssetRecord[]>([]);
  const [filmClips, setFilmClips] = useState<FilmClipRecord[]>([]);
  const [selectedClip, setSelectedClip] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [filmLoading, setFilmLoading] = useState(true);
  const [filmLoadError, setFilmLoadError] = useState('');
  const [filmPlaybackError, setFilmPlaybackError] = useState('');
  const [filmSaving, setFilmSaving] = useState(false);
  const [clipDirty, setClipDirty] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<
    { type: 'film'; id: string } | { type: 'clip'; number: number } | null
  >(null);
  useEffect(() => {
    onEditingChange(clipDirty || filmSaving);
    return () => onEditingChange(false);
  }, [clipDirty, filmSaving, onEditingChange]);
  useEffect(() => {
    if (!clipDirty && !filmSaving) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [clipDirty, filmSaving]);
  const [note, setNote] = useState('');
  const [filmSearch, setFilmSearch] = useState('');
  const [libraryTab, setLibraryTab] = useState<'Games' | 'Clips'>('Games');
  const [libraryCollapsed, setLibraryCollapsed] = useState(true);
  const [readyFilmSource, setReadyFilmSource] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeClip =
    filmClips.find((clip) => clip.clipNumber === selectedClip) ?? null;
  const nextClipNumber =
    Math.max(0, ...filmClips.map((clip) => clip.clipNumber)) + 1;
  const visibleClips = filmClips.filter((clip) =>
    `${clipLabel(clip)} ${clip.odk} ${clip.quarter} ${clip.tags.join(' ')}`
      .toLowerCase()
      .includes(filmSearch.toLowerCase()),
  );
  const filmSource = filmAsset?.storageKey
    ? mediaUrl(filmAsset.storageKey, assetRevision)
    : '';
  const filmAvailable = Boolean(filmSource && readyFilmSource === filmSource);

  useEffect(() => {
    fetch(
      `/api/film${initialAssetId ? `?assetId=${encodeURIComponent(initialAssetId)}` : ''}`,
      { cache: 'no-store' },
    )
      .then(async (response) => {
        const data = (await response.json()) as FilmPayload;
        if (!response.ok) throw new Error(data.error ?? 'Unable to load film.');
        setFilmAsset(data.asset);
        setFilmAssets(data.assets);
        setFilmClips(data.clips);
        setSelectedClip((current) =>
          data.clips.some((clip) => clip.clipNumber === current)
            ? current
            : (data.clips[0]?.clipNumber ?? 0),
        );
        setNote(data.clips[0]?.note ?? '');
      })
      .catch(() =>
        setFilmLoadError('Saved film could not be loaded. Try again.'),
      )
      .finally(() => setFilmLoading(false));
  }, [onNotify, initialAssetId]);

  const openFilm = async (assetId: string, discard = false) => {
    if (filmSaving) return;
    if (clipDirty && !discard) {
      setPendingSelection({ type: 'film', id: assetId });
      return;
    }
    videoRef.current?.pause();
    setFilmLoading(true);
    setFilmLoadError('');
    setFilmPlaybackError('');
    try {
      const data = await readFilmData(assetId);
      setFilmAsset(data.asset);
      setFilmAssets(data.assets);
      setFilmClips(data.clips);
      setSelectedClip(data.clips[0]?.clipNumber ?? 0);
      setNote(data.clips[0]?.note ?? '');
      setReadyFilmSource('');
      setIsPlaying(false);
      setClipDirty(false);
      if (assetId === filmAsset?.id) videoRef.current?.load();
    } catch {
      setFilmLoadError(
        'This film could not be opened. Your current film is still selected. Try again.',
      );
    } finally {
      setFilmLoading(false);
    }
  };

  const chooseClip = (clipId: number, discard = false) => {
    if (filmSaving) return;
    if (clipDirty && !discard) {
      setPendingSelection({ type: 'clip', number: clipId });
      return;
    }
    setClipDirty(false);
    setSelectedClip(clipId);
    const clip = filmClips.find((item) => item.clipNumber === clipId);
    setNote(clip?.note ?? '');
    if (clip && videoRef.current)
      videoRef.current.currentTime = clip.startSeconds;
  };

  const moveClip = (direction: number) => {
    if (!filmClips.length) return;
    const index = Math.max(
      0,
      filmClips.findIndex((clip) => clip.clipNumber === selectedClip),
    );
    chooseClip(
      filmClips[(index + direction + filmClips.length) % filmClips.length]
        .clipNumber,
    );
  };

  const saveBreakdown = async (advance = false) => {
    if (filmSaving || filmLoading) return;
    if (!filmAsset) {
      onNotify('Upload film before charting clips.', 'info');
      return;
    }
    const value = (id: string) =>
      (
        document.getElementById(id) as
          | HTMLInputElement
          | HTMLSelectElement
          | null
      )?.value ?? '';
    setFilmSaving(true);
    try {
      const response = await fetch('/api/film', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'upsertClip',
          assetId: filmAsset.id,
          id: activeClip?.id,
          clipNumber: activeClip?.clipNumber,
          startSeconds: value('film-start'),
          endSeconds: value('film-end'),
          odk: value('film-unit'),
          down: value('film-down'),
          distance: value('film-distance'),
          yardLine: value('film-yardline'),
          playId: value('film-play'),
          concept: value('film-concept'),
          result: value('film-result'),
          quarter: value('film-quarter'),
          clock: value('film-clock'),
          tags: value('film-tags')
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          note: value('film-note'),
        }),
      });
      const data = (await response.json()) as FilmPayload;
      if (!response.ok)
        throw new Error(data.error ?? 'Unable to save the clip.');
      setFilmAsset(data.asset);
      setFilmAssets(data.assets);
      setFilmClips(data.clips);
      const saved = activeClip
        ? data.clips.find((clip) => clip.id === activeClip.id)
        : data.clips.at(-1);
      if (saved) {
        setSelectedClip(saved.clipNumber);
        setNote(saved.note);
      }
      onNotify(`Clip ${saved?.clipNumber ?? nextClipNumber} saved.`);
      setClipDirty(false);
      if (advance) {
        setSelectedClip(0);
        setNote('');
      }
    } catch (error) {
      onNotify(
        error instanceof Error
          ? error.message
          : 'The clip breakdown could not be saved.',
        'error',
      );
    } finally {
      setFilmSaving(false);
    }
  };

  const registerFilm = async (file?: File, storageKey?: string) => {
    if (!file || !storageKey) throw new Error('Choose a video to upload.');
    const response = await fetch('/api/film', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'register',
        storageKey,
        title: file.name,
      }),
    });
    const data = (await response.json()) as FilmPayload;
    if (!response.ok)
      throw new Error(
        data.error ??
          'The video uploaded, but its library record could not be saved. Try again.',
      );
    setFilmAsset(data.asset);
    setFilmAssets(data.assets);
    setFilmClips(data.clips);
    setSelectedClip(data.clips[0]?.clipNumber ?? 0);
    setNote(data.clips[0]?.note ?? '');
    setReadyFilmSource('');
    setFilmLoadError('');
    setFilmPlaybackError('');
    onAssetsChanged();
  };

  const deleteChartedClip = async () => {
    if (!activeClip) return;
    if (filmSaving || filmLoading || clipDirty) {
      onNotify('Save or discard your clip changes before removing it.', 'info');
      return;
    }
    try {
      const response = await fetch(
        `/api/film?clipId=${encodeURIComponent(activeClip.id)}`,
        { method: 'DELETE' },
      );
      const data = (await response.json()) as FilmPayload;
      if (!response.ok)
        throw new Error(data.error ?? 'Unable to remove the clip.');
      setFilmAsset(data.asset);
      setFilmAssets(data.assets);
      setFilmClips(data.clips);
      setSelectedClip(data.clips[0]?.clipNumber ?? 0);
      setNote(data.clips[0]?.note ?? '');
      onNotify(`Clip ${activeClip.clipNumber} removed.`);
    } catch (error) {
      onNotify(
        error instanceof Error ? error.message : 'Unable to remove the clip.',
        'error',
      );
    }
  };

  const saveFilmDuration = async () => {
    const asset = filmAsset,
      duration = videoRef.current?.duration;
    if (
      !asset ||
      !duration ||
      !Number.isFinite(duration) ||
      Math.round(duration) === asset.durationSeconds
    )
      return;
    try {
      const response = await fetch('/api/film', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'metadata',
          assetId: asset.id,
          durationSeconds: duration,
        }),
      });
      const data = (await response.json()) as FilmPayload;
      if (!response.ok) throw new Error();
      setFilmAsset((current) =>
        current?.id === asset.id
          ? {
              ...current,
              durationSeconds:
                data.asset?.durationSeconds ?? current.durationSeconds,
            }
          : current,
      );
    } catch {
      onNotify(
        'The film can play, but its duration could not be saved. Reopen it to retry.',
        'warning',
      );
    }
  };

  const toggleFilm = async () => {
    const video = videoRef.current;
    if (!video || !filmAvailable) {
      onNotify('Upload game film before using playback controls.', 'info');
      return;
    }
    if (video.paused) {
      await video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  return (
    <section className="module-surface film-room-surface film-review-tool">
      <ModuleHeader
        eyebrow={
          filmAsset
            ? `${filmAsset.opponent || 'Team film'} · ${filmClips.length} saved ${filmClips.length === 1 ? 'clip' : 'clips'}`
            : 'Team film library'
        }
        title={filmAsset?.title ?? 'Film Room'}
        description="Review film, chart every snap, and keep teaching notes beside the video."
      >
        <FocusModeButton focused={focusMode} onToggle={onToggleFocus} />
        <MediaUploadControl
          accept="video/*"
          assetKey={() => `film-${crypto.randomUUID()}`}
          label="Upload film"
          disabled={clipDirty || filmLoading || filmSaving}
          onNotify={onNotify}
          onUploaded={registerFilm}
        />
        <Button
          className="module-primary"
          disabled={!filmAsset || filmLoading || filmSaving}
          onClick={() => chooseClip(0)}
        >
          <Plus /> New clip
        </Button>
      </ModuleHeader>
      {filmLoadError ? (
        <div className="pd-error" role="alert">
          {filmLoadError}
          <Button
            variant="outline"
            onClick={() => void openFilm(filmAsset?.id ?? '')}
          >
            Retry
          </Button>
        </div>
      ) : null}

      <div
        className={
          filmAsset ? 'local-data-status' : 'local-data-status status-warning'
        }
      >
        <span className="sync-dot" />
        <strong>
          {filmLoading
            ? 'Loading film library…'
            : filmAsset
              ? 'Film saved'
              : 'No film uploaded'}
        </strong>
        <small>
          {filmClips.length} charted {filmClips.length === 1 ? 'clip' : 'clips'}
        </small>
      </div>

      <div className="toolbar-row">
        <div className="toolbar-search">
          <Search />
          <Input
            aria-label="Search charted clips"
            onChange={(event) => setFilmSearch(event.target.value)}
            placeholder="Search clips, concepts, units or tags…"
            value={filmSearch}
          />
        </div>

        <Button onClick={() => onNavigate('Reports')} variant="outline">
          <SlidersHorizontal /> Reports
        </Button>
      </div>

      <div
        className={
          libraryCollapsed
            ? 'film-workspace library-collapsed'
            : 'film-workspace'
        }
      >
        <aside
          className={
            libraryCollapsed
              ? 'clip-panel film-library-panel collapsed'
              : 'clip-panel film-library-panel'
          }
        >
          {libraryCollapsed ? (
            <button
              aria-expanded="false"
              aria-label="Expand film library"
              className="film-library-expand"
              onClick={() => setLibraryCollapsed(false)}
              type="button"
            >
              <ChevronLeft />
              <span>Film library</span>
            </button>
          ) : (
            <>
              <div className="panel-title film-library-title">
                <div>
                  <strong>Film library</strong>
                  <span>
                    {filmAssets.length} saved{' '}
                    {filmAssets.length === 1 ? 'film' : 'films'} ·{' '}
                    {filmClips.length} clips
                  </span>
                </div>
                <div>
                  <Button
                    aria-label="Add clip"
                    disabled={!filmAsset || filmLoading || filmSaving}
                    onClick={() => chooseClip(0)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Plus />
                  </Button>
                  <Button
                    aria-label="Collapse film library"
                    onClick={() => setLibraryCollapsed(true)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <ChevronRight />
                  </Button>
                </div>
              </div>
              <div className="film-library-tabs">
                <button
                  className={libraryTab === 'Games' ? 'active' : ''}
                  onClick={() => setLibraryTab('Games')}
                  type="button"
                >
                  <Film /> Games
                </button>
                <button
                  className={libraryTab === 'Clips' ? 'active' : ''}
                  onClick={() => setLibraryTab('Clips')}
                  type="button"
                >
                  <ListFilter /> Clips
                </button>
              </div>
              {libraryTab === 'Games' ? (
                <div className="film-assets-list">
                  {filmAssets.map((asset) => (
                    <button
                      className={filmAsset?.id === asset.id ? 'active' : ''}
                      key={asset.id}
                      disabled={filmLoading || filmSaving}
                      onClick={() => void openFilm(asset.id)}
                      type="button"
                    >
                      <span>
                        <Film />
                      </span>
                      <div>
                        <strong>{asset.title}</strong>
                        <small>
                          {asset.opponent || 'Team film'} · {asset.status}
                        </small>
                      </div>
                      <b>{filmAsset?.id === asset.id ? 'OPEN' : ''}</b>
                    </button>
                  ))}
                  {!filmAssets.length ? (
                    <div className="film-library-empty">
                      <Film />
                      <strong>No saved film</strong>
                      <span>
                        Upload a video to create the first review session.
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {libraryTab === 'Clips' ? (
                <>
                  <div className="clip-library-heading">
                    <span>Charted clips</span>
                    <b>{visibleClips.length}</b>
                  </div>
                  <div className="clip-list">
                    {visibleClips.map((clip) => (
                      <button
                        className={
                          selectedClip === clip.clipNumber
                            ? 'clip-row active'
                            : 'clip-row'
                        }
                        key={clip.id}
                        onClick={() => chooseClip(clip.clipNumber)}
                        type="button"
                      >
                        <span className="clip-index">
                          {String(clip.clipNumber).padStart(2, '0')}
                        </span>
                        <span className="clip-thumb">
                          <Film />
                        </span>
                        <span className="clip-main">
                          <strong>{clipLabel(clip)}</strong>
                          <small>
                            {clip.odk || 'Unit unassigned'}
                            {clip.down
                              ? ` · ${clip.down} & ${clip.distance ?? '—'}`
                              : ''}
                          </small>
                        </span>
                        <span className="clip-result">
                          {clip.result || '—'}
                        </span>
                      </button>
                    ))}
                    {!visibleClips.length ? (
                      <div className="channel-empty">
                        {filmAsset
                          ? 'No clips charted yet.'
                          : 'Upload film to begin.'}
                      </div>
                    ) : null}
                  </div>
                  <button
                    className="add-clips"
                    disabled={!filmAsset || filmLoading || filmSaving}
                    onClick={() => chooseClip(0)}
                    type="button"
                  >
                    <Plus /> Chart another clip
                  </button>
                </>
              ) : null}
            </>
          )}
        </aside>

        <div
          className="film-stage"
          onChangeCapture={(event) => {
            if ((event.target as HTMLElement).id.startsWith('film-'))
              setClipDirty(true);
          }}
        >
          <div className="viewer">
            <div className="viewer-field">
              {filmSource ? (
                <video
                  aria-label="Uploaded game film"
                  className={
                    filmAvailable ? 'film-video available' : 'film-video'
                  }
                  onCanPlay={() => setReadyFilmSource(filmSource)}
                  onLoadedMetadata={() => void saveFilmDuration()}
                  onEnded={() => setIsPlaying(false)}
                  onError={() => {
                    setReadyFilmSource('');
                    setFilmPlaybackError(
                      'This saved film could not be played in this browser.',
                    );
                  }}
                  onPause={() => setIsPlaying(false)}
                  onPlay={() => setIsPlaying(true)}
                  playsInline
                  preload="metadata"
                  ref={videoRef}
                  src={filmSource}
                >
                  <track
                    kind="captions"
                    label="No captions uploaded"
                    src="/empty.vtt"
                    srcLang="en"
                  />
                </video>
              ) : null}
              {filmAvailable ? (
                <>
                  <button
                    aria-label={isPlaying ? 'Pause film' : 'Play film'}
                    className="viewer-play"
                    onClick={() => void toggleFilm()}
                    type="button"
                  >
                    {isPlaying ? (
                      <Pause fill="currentColor" />
                    ) : (
                      <Play fill="currentColor" />
                    )}
                  </button>
                  {activeClip ? (
                    <span className="viewer-tag">
                      <Tag /> {clipLabel(activeClip)}
                    </span>
                  ) : null}
                </>
              ) : (
                <div className="viewer-empty-state">
                  <Film />
                  <strong>
                    {filmPlaybackError ||
                      (filmSource ? 'Loading film…' : 'No film uploaded')}
                  </strong>
                  <span>
                    {filmSource
                      ? 'Open another saved film or upload a compatible video.'
                      : 'Upload a video to begin reviewing and charting clips.'}
                  </span>
                  <MediaUploadControl
                    accept="video/*"
                    assetKey={() => `film-${crypto.randomUUID()}`}
                    label="Choose video"
                    disabled={clipDirty || filmLoading || filmSaving}
                    onNotify={onNotify}
                    onUploaded={registerFilm}
                  />
                </div>
              )}
            </div>
            <div className="player-controls">
              <Button
                aria-label="Previous clip"
                onClick={() => moveClip(-1)}
                size="icon-sm"
                variant="ghost"
              >
                <SkipBack />
              </Button>
              <Button
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="control-play"
                disabled={!filmAvailable}
                size="icon"
                onClick={() => void toggleFilm()}
              >
                <>
                  {isPlaying ? (
                    <Pause fill="currentColor" />
                  ) : (
                    <Play fill="currentColor" />
                  )}
                </>
              </Button>
              <Button
                aria-label="Next clip"
                onClick={() => moveClip(1)}
                size="icon-sm"
                variant="ghost"
              >
                <SkipForward />
              </Button>
              <span className="timecode">
                {activeClip
                  ? `${activeClip.startSeconds}s – ${activeClip.endSeconds}s`
                  : 'No clip selected'}
              </span>
              <Slider
                aria-label="Film timeline"
                className="film-slider"
                disabled={!filmAvailable}
                value={[
                  activeClip && filmAsset?.durationSeconds
                    ? (activeClip.startSeconds / filmAsset.durationSeconds) *
                      100
                    : 0,
                ]}
                max={100}
              />
              <Button
                aria-label="Volume"
                disabled={!filmAvailable}
                onClick={() => {
                  if (videoRef.current)
                    videoRef.current.muted = !videoRef.current.muted;
                }}
                size="icon-sm"
                variant="ghost"
              >
                <Volume2 />
              </Button>
              <Button
                aria-label="Fullscreen"
                onClick={() =>
                  document.querySelector('.viewer')?.requestFullscreen?.()
                }
                size="icon-sm"
                variant="ghost"
              >
                <Maximize2 />
              </Button>
            </div>
          </div>

          <div className="film-lower">
            <div className="timeline-card">
              <div className="timeline-head">
                <div>
                  <Badge variant="outline">
                    {activeClip?.quarter || 'Unscheduled'}
                    {activeClip?.clock ? ` · ${activeClip.clock}` : ''}
                  </Badge>
                  <strong>
                    {activeClip ? clipLabel(activeClip) : 'No clip selected'}
                  </strong>
                </div>
                <div className="timeline-tools">
                  <Button
                    disabled={!activeClip}
                    onClick={() =>
                      document.getElementById('film-tags')?.focus()
                    }
                    size="sm"
                    variant="ghost"
                  >
                    <Tag /> Edit tags
                  </Button>
                </div>
              </div>
              <div className="mini-timeline">
                <span className="timeline-playhead" />
                {filmClips.map((clip) => (
                  <button
                    aria-label={`Clip ${clip.clipNumber}`}
                    className={selectedClip === clip.clipNumber ? 'active' : ''}
                    key={clip.id}
                    onClick={() => chooseClip(clip.clipNumber)}
                    type="button"
                  />
                ))}
              </div>
              <div className="tag-strip">
                <span>
                  <b>Unit</b> {activeClip?.odk || '—'}
                </span>
                <span>
                  <b>Down</b> {activeClip?.down ?? '—'}
                </span>
                <span>
                  <b>Concept</b> {activeClip?.concept || '—'}
                </span>
                <span>
                  <b>Result</b> {activeClip?.result || '—'}
                </span>
                <button
                  onClick={() => document.getElementById('film-tags')?.focus()}
                  type="button"
                >
                  <Plus /> Add tag
                </button>
              </div>
            </div>
            <aside className="notes-card">
              <div className="panel-title">
                <div>
                  <strong>Teaching notes</strong>
                  <span>Saved with this clip</span>
                </div>
                <Eye />
              </div>
              <Textarea
                aria-label="Teaching note"
                id="film-note"
                maxLength={280}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Add a coaching point for this clip…"
                value={note}
              />
              <div className="notes-actions">
                <span>{note.length}/280</span>
                <Button
                  disabled={!filmAsset || filmLoading || filmSaving}
                  onClick={() => void saveBreakdown(false)}
                  size="sm"
                >
                  {filmSaving ? 'Saving…' : 'Save with clip'}
                </Button>
              </div>
            </aside>
          </div>

          <section className="film-stat-sheet" aria-label="Film stat entry">
            <header className="film-sheet-toolbar">
              <div>
                <p className="eyebrow">Stat entry</p>
                <h3>
                  {activeClip
                    ? `Editing clip ${activeClip.clipNumber}`
                    : `Chart clip ${nextClipNumber}`}
                </h3>
              </div>
              <span>
                {filmClips.length} saved · spreadsheet entry stays beside the
                video
              </span>
            </header>
            <div className="film-sheet-scroll">
              <div className="film-sheet-grid film-sheet-head">
                <span>Clip</span>
                <span>Unit</span>
                <span>Down</span>
                <span>Dist</span>
                <span>Yard line</span>
                <span>Play / concept</span>
                <span>Qtr</span>
                <span>Clock</span>
                <span>Result</span>
                <span>Tags</span>
                <span>Start / end</span>
                <span>Actions</span>
              </div>
              <div
                className="film-sheet-grid film-sheet-editor"
                key={activeClip?.id ?? `new-${filmClips.length}`}
              >
                <strong>
                  {activeClip
                    ? String(activeClip.clipNumber).padStart(2, '0')
                    : `+${nextClipNumber}`}
                </strong>
                <NativeSelect
                  aria-label="Unit"
                  defaultValue={activeClip?.odk || 'Offence'}
                  id="film-unit"
                >
                  <NativeSelectOption value="Offence">
                    Offence
                  </NativeSelectOption>
                  <NativeSelectOption value="Defence">
                    Defence
                  </NativeSelectOption>
                  <NativeSelectOption value="Special teams">
                    Special teams
                  </NativeSelectOption>
                </NativeSelect>
                <Input
                  aria-label="Down"
                  defaultValue={activeClip?.down ?? ''}
                  id="film-down"
                  inputMode="numeric"
                  placeholder="1"
                />
                <Input
                  aria-label="Distance"
                  defaultValue={activeClip?.distance ?? ''}
                  id="film-distance"
                  inputMode="numeric"
                  placeholder="10"
                />
                <Input
                  aria-label="Yard line"
                  defaultValue={activeClip?.yardLine ?? ''}
                  id="film-yardline"
                  placeholder="H 47"
                />
                <Input
                  aria-label="Play or concept"
                  defaultValue={activeClip ? clipLabel(activeClip) : ''}
                  id="film-concept"
                  placeholder="Play / concept"
                />
                <Input
                  aria-label="Quarter"
                  defaultValue={activeClip?.quarter ?? ''}
                  id="film-quarter"
                  placeholder="Q1"
                />
                <Input
                  aria-label="Clock"
                  defaultValue={activeClip?.clock ?? ''}
                  id="film-clock"
                  placeholder="12:46"
                />
                <Input
                  aria-label="Result"
                  defaultValue={activeClip?.result ?? ''}
                  id="film-result"
                  placeholder="+6"
                />
                <Input
                  aria-label="Tags"
                  defaultValue={activeClip?.tags.join(', ') ?? ''}
                  id="film-tags"
                  placeholder="pressure"
                />
                <div className="film-sheet-time">
                  <Input
                    aria-label="Start seconds"
                    defaultValue={activeClip?.startSeconds ?? 0}
                    id="film-start"
                    inputMode="decimal"
                  />
                  <Input
                    aria-label="End seconds"
                    defaultValue={activeClip?.endSeconds ?? 0}
                    id="film-end"
                    inputMode="decimal"
                  />
                </div>
                <div className="film-sheet-actions">
                  <Button
                    aria-label="Save clip"
                    disabled={!filmAsset || filmLoading || filmSaving}
                    onClick={() => void saveBreakdown(false)}
                    size="icon-sm"
                  >
                    <Check />
                  </Button>
                  <Button
                    aria-label="Save and start a new clip"
                    disabled={!filmAsset || filmLoading || filmSaving}
                    onClick={() => void saveBreakdown(true)}
                    size="icon-sm"
                    variant="outline"
                  >
                    <Plus />
                  </Button>
                  {activeClip ? (
                    <Button
                      aria-label="Delete clip"
                      onClick={() => void deleteChartedClip()}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
                <input
                  id="film-play"
                  type="hidden"
                  value={activeClip?.playId ?? ''}
                  readOnly
                />
              </div>
              <div className="film-sheet-saved">
                {visibleClips.map((clip) => (
                  <button
                    className={
                      selectedClip === clip.clipNumber
                        ? 'film-sheet-grid film-sheet-row active'
                        : 'film-sheet-grid film-sheet-row'
                    }
                    key={clip.id}
                    onClick={() => chooseClip(clip.clipNumber)}
                    type="button"
                  >
                    <strong>{String(clip.clipNumber).padStart(2, '0')}</strong>
                    <span>{clip.odk || '—'}</span>
                    <span>{clip.down ?? '—'}</span>
                    <span>{clip.distance ?? '—'}</span>
                    <span>{clip.yardLine || '—'}</span>
                    <span>{clipLabel(clip)}</span>
                    <span>{clip.quarter || '—'}</span>
                    <span>{clip.clock || '—'}</span>
                    <span>{clip.result || '—'}</span>
                    <span>{clip.tags.join(', ') || '—'}</span>
                    <span>
                      {clip.startSeconds}s / {clip.endSeconds}s
                    </span>
                    <span>Open</span>
                  </button>
                ))}
                {!visibleClips.length ? (
                  <div className="film-sheet-empty">
                    Enter the first snap in the highlighted row above.
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
      <Dialog
        open={Boolean(pendingSelection)}
        onOpenChange={(open) => {
          if (!open) setPendingSelection(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave this clip?</DialogTitle>
            <DialogDescription>
              Your unsaved clip changes will be discarded. Save the clip first
              to keep them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingSelection(null)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const next = pendingSelection;
                setPendingSelection(null);
                if (next?.type === 'film') void openFilm(next.id, true);
                else if (next?.type === 'clip') chooseClip(next.number, true);
              }}
            >
              Discard and continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

type StudioPlay = {
  id: string;
  playbookId?: string;
  formationId?: string | null;
  name: string;
  unit?: string;
  formation: string;
  category: string;
  family:
    | 'Unassigned'
    | 'Run'
    | 'Pass'
    | 'RPO'
    | 'Screen'
    | 'Coverage'
    | 'Pressure'
    | 'Run fit'
    | 'Kickoff'
    | 'Kick return'
    | 'Punt'
    | 'Punt return'
    | 'Field goal';
  concept: string;
  variant: number;
  routes?: DiagramRoute[];
  players?: DiagramPlayer[];
  zones?: DiagramZone[];
  labels?: DiagramLabel[];
  assignments?: PlayAssignment[];
  notes?: string;
  locked?: boolean;
  fieldPosition?: number;
  showOpponent?: boolean;
};

type DiagramPoint = { x: number; y: number };

type DiagramRoute = {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  colour: string;
  lineStyle: 'solid' | 'dashed' | 'dotted' | 'curve';
  playerId?: string;
  points?: DiagramPoint[];
};

type DiagramPlayer = {
  id: string;
  label: string;
  x: number;
  y: number;
  kind: 'line' | 'skill' | 'qb' | 'back';
  colour?: string;
};

type DiagramZone = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  colour: string;
};

type DiagramLabel = {
  id: string;
  x: number;
  y: number;
  text: string;
  colour: string;
};

type StudioBook = {
  id: string;
  name: string;
  side: 'Offence' | 'Defence' | 'Special teams' | 'Scout';
  plays: number;
  formations: number;
  updated: string;
  archived: boolean;
};

type StudioFormation = {
  id: string;
  name: string;
  personnel: string;
  count: number;
  unit?: string;
  variant?: number;
  players?: DiagramPlayer[];
};

type PlaybookPayload = {
  books: StudioBook[];
  formations: StudioFormation[];
  plays: StudioPlay[];
  createdId?: string;
};

async function loadPlaybookData(): Promise<PlaybookPayload> {
  const response = await fetch('/api/playbooks');
  const data = (await response.json()) as PlaybookPayload & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Unable to load playbooks.');
  return data;
}

function StudioPlayDiagram({ play }: { play: StudioPlay; label?: boolean }) {
  return <PlayField drawing={play} name={play.name} heightYards={60} />;
}

type SidelinePlayRecord = {
  id: number;
  dbId: string;
  down: string;
  yard: string;
  gain: string;
  call: string;
  status: string;
};

function SidelineView({
  assetRevision,
  focusMode,
  onNavigate,
  onNotify,
  onToggleFocus,
  teamSettings,
}: {
  assetRevision: number;
  focusMode: boolean;
  onNavigate: (view: string) => void;
  onNotify: Notify;
  onToggleFocus: () => void;
  teamSettings: TeamSettings;
}) {
  const [sidelinePlays, setSidelinePlays] = useState<SidelinePlayRecord[]>([]);
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [angle, setAngle] = useState('End zone');
  const [telestrate, setTelestrate] = useState(true);
  const [quickNote, setQuickNote] = useState('');
  const [flagged, setFlagged] = useState<number[]>([]);
  const [cameraCount, setCameraCount] = useState(0);
  const [unitSendPending, setUnitSendPending] = useState(false);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const play =
    sidelinePlays.find((item) => item.id === selected) ??
    sidelinePlays[0] ??
    null;

  useEffect(() => {
    loadWorkspaceState('sideline-session-v2', {
      flagged: [] as number[],
      notes: [] as string[],
    })
      .then((saved) => {
        setFlagged(saved.flagged);
      })
      .catch(() =>
        onNotify('Saved sideline notes could not be restored.', 'warning'),
      );
    fetch('/api/film', { cache: 'no-store' })
      .then(async (response) => (await response.json()) as FilmPayload)
      .then((data) => {
        const plays = (data.clips ?? []).map((clip) => ({
          id: clip.clipNumber,
          dbId: clip.id,
          down: clip.down
            ? `${clip.down} & ${clip.distance ?? '—'}`
            : 'Down not charted',
          yard: clip.yardLine || 'Yard line not charted',
          gain: clip.result || '—',
          call: clipLabel(clip),
          status: 'saved',
        }));
        setSidelinePlays(plays);
        setSelected(plays[0]?.id ?? 0);
      })
      .catch(() => setSidelinePlays([]));
    return () => {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [onNotify]);

  const toggleCamera = async () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
      setCameraCount(0);
      setPlaying(false);
      onNotify('Sideline camera disconnected.', 'info');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) cameraVideoRef.current.srcObject = stream;
      setCameraCount(1);
      onNotify('Real camera feed connected.');
    } catch {
      onNotify(
        'Camera access was not granted. Check browser permissions and try again.',
        'error',
      );
    }
  };

  const moveSidelinePlay = (direction: number) => {
    if (!sidelinePlays.length) return;
    const index = sidelinePlays.findIndex((item) => item.id === selected);
    setSelected(
      sidelinePlays[
        (index + direction + sidelinePlays.length) % sidelinePlays.length
      ].id,
    );
  };

  return (
    <section className="module-surface sideline-surface">
      <ModuleHeader
        eyebrow="Game-day replay"
        title="Sideline"
        description="Review the last snap before the next one. Fast, local, and built for the bench."
      >
        <FocusModeButton focused={focusMode} onToggle={onToggleFocus} />
        <Badge
          className={
            cameraCount ? 'connection-badge' : 'connection-badge offline'
          }
        >
          <span /> {cameraCount ? 'Camera live' : 'No live camera'}
        </Badge>
        <Button
          className="module-secondary"
          onClick={() =>
            onNotify(
              'Sideline replay is operating on the local team network.',
              'info',
            )
          }
          variant="outline"
        >
          <CloudOff /> Local network
        </Button>
        <Button className="module-primary" onClick={() => void toggleCamera()}>
          {cameraCount ? <X /> : <Camera />}{' '}
          {cameraCount ? 'Disconnect camera' : 'Connect camera'}
        </Button>
      </ModuleHeader>

      <div className="sideline-scorebar">
        <div className="score-team">
          <MediaAvatar
            assetKey="team-logo"
            className="team-crest dark"
            fallback={initialsFor(teamSettings.teamName)}
            label={`${teamSettings.teamName || 'Team'} logo`}
            revision={assetRevision}
          />
          <div>
            <small>{teamSettings.teamName || 'Team'} replay</small>
            <strong>
              {cameraCount ? 'Camera connected' : 'Camera offline'}
            </strong>
          </div>
        </div>
        <div className="game-clock">
          <span>SAVED PLAY HISTORY</span>
          <strong>{sidelinePlays.length}</strong>
          <small>Charted in Film Room</small>
        </div>
        <div className="possession">
          <span>CURRENT CLIP</span>
          <strong>{play?.call ?? 'None selected'}</strong>
        </div>
      </div>

      <div className="sideline-grid">
        <aside className="drive-panel">
          <div className="panel-title">
            <div>
              <strong>Saved clip history</strong>
              <span>{sidelinePlays.length} charted plays</span>
            </div>
            <Badge variant="secondary">Local</Badge>
          </div>
          <div className="sideline-play-list">
            {sidelinePlays.map((item) => (
              <button
                className={
                  selected === item.id
                    ? 'sideline-play active'
                    : 'sideline-play'
                }
                key={item.id}
                onClick={() => setSelected(item.id)}
                type="button"
              >
                <span className="snap-number">{item.id}</span>
                <div>
                  <strong>
                    {item.down} · {item.call}
                  </strong>
                  <small>
                    {item.yard} <b>{item.gain}</b>
                  </small>
                </div>
                {flagged.includes(item.id) ? (
                  <Pin className="flagged" />
                ) : (
                  <Check />
                )}
              </button>
            ))}
            {!sidelinePlays.length ? (
              <div className="channel-empty">
                No play history yet. Chart clips in Film Room to populate this
                list.
              </div>
            ) : null}
          </div>
          <Button
            className="w-full"
            onClick={() => onNavigate('Film Room')}
            variant="outline"
          >
            <Film /> Open Film Room
          </Button>
        </aside>

        <div className="sideline-viewer-column">
          <div className="sideline-viewer">
            <div className="angle-tabs">
              {['Sideline', 'End zone', 'Tight'].map((item) => (
                <button
                  className={angle === item ? 'active' : ''}
                  key={item}
                  onClick={() => setAngle(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
              <span>
                {angle} · Cam{' '}
                {angle === 'End zone' ? '2' : angle === 'Sideline' ? '1' : '3'}
              </span>
            </div>
            <div className="replay-stage">
              <video
                aria-label="Connected sideline camera"
                autoPlay
                className={
                  cameraCount
                    ? 'sideline-live-video available'
                    : 'sideline-live-video'
                }
                muted
                playsInline
                ref={cameraVideoRef}
              />
              {cameraCount ? (
                <>
                  <span className="replay-label">
                    <Radio /> LIVE LOCAL CAMERA
                  </span>
                  {telestrate ? (
                    <svg className="telestration" viewBox="0 0 800 420" />
                  ) : null}
                  {play ? (
                    <div className="down-overlay">
                      <strong>{play.down}</strong>
                      <span>{play.call}</span>
                      <b>{play.gain}</b>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="viewer-empty-state">
                  <Camera />
                  <strong>No camera connected</strong>
                  <span>
                    Connect a real local camera to start the sideline view.
                  </span>
                  <Button onClick={() => void toggleCamera()}>
                    <Camera /> Connect camera
                  </Button>
                </div>
              )}
            </div>
            <div className="replay-controls">
              <Button
                aria-label="Previous snap"
                onClick={() => moveSidelinePlay(-1)}
                size="icon"
                variant="ghost"
              >
                <SkipBack />
              </Button>
              <Button
                aria-label={playing ? 'Pause replay' : 'Play replay'}
                className="control-play"
                disabled={!cameraCount}
                size="icon"
                onClick={() => setPlaying(!playing)}
              >
                {playing ? (
                  <Pause fill="currentColor" />
                ) : (
                  <Play fill="currentColor" />
                )}
              </Button>
              <Button
                aria-label="Next snap"
                onClick={() => moveSidelinePlay(1)}
                size="icon"
                variant="ghost"
              >
                <SkipForward />
              </Button>
              <span>{play ? `Clip ${play.id}` : 'No clip selected'}</span>
              <Slider
                aria-label="Replay timeline"
                className="film-slider"
                disabled={!cameraCount}
                value={[0]}
              />
              <button
                className={
                  telestrate ? 'telestrate-toggle active' : 'telestrate-toggle'
                }
                disabled={!cameraCount}
                onClick={() => setTelestrate(!telestrate)}
                type="button"
              >
                <Pencil /> Draw
              </button>
              <Button
                aria-label="Fullscreen"
                onClick={() =>
                  document
                    .querySelector('.sideline-viewer')
                    ?.requestFullscreen?.()
                }
                size="icon"
                variant="ghost"
              >
                <Maximize2 />
              </Button>
            </div>
          </div>

          <div className="sideline-bottom">
            <div className="coach-note">
              <span className="chat-avatar bg-[#dce4ef] text-[#234873]">
                OC
              </span>
              <div>
                <strong>Quick note to offence</strong>
                <Input
                  aria-label="Send a quick sideline note"
                  onChange={(event) => setQuickNote(event.target.value)}
                  placeholder="What should they see on the bench?"
                  value={quickNote}
                />
              </div>
              <Button
                disabled={!quickNote.trim()}
                onClick={async () => {
                  const state = await loadWorkspaceState<{
                    flagged: number[];
                    notes: string[];
                    cameraCount: number;
                  }>('sideline-session-v2', {
                    flagged,
                    notes: [],
                    cameraCount,
                  });
                  await saveWorkspaceState('sideline-session-v2', {
                    ...state,
                    flagged,
                    cameraCount,
                    notes: [...state.notes, quickNote.trim()],
                  });
                  setQuickNote('');
                  onNotify('Sideline note saved for the offence.');
                }}
              >
                <Send /> Save
              </Button>
            </div>
            <div className="sideline-actions">
              <button
                disabled={!play}
                onClick={async () => {
                  if (!play) return;
                  const next = flagged.includes(selected)
                    ? flagged.filter((id) => id !== selected)
                    : [...flagged, selected];
                  setFlagged(next);
                  await saveWorkspaceState('sideline-session-v2', {
                    flagged: next,
                    notes: [],
                    cameraCount,
                  });
                  onNotify(
                    flagged.includes(selected)
                      ? 'Halftime flag removed.'
                      : 'Play flagged for halftime.',
                  );
                }}
                type="button"
              >
                <Pin />
                <span>
                  <strong>
                    {flagged.includes(selected) ? 'Unflag play' : 'Flag play'}
                  </strong>
                  <small>For halftime</small>
                </span>
              </button>
              <button
                disabled={!play}
                onClick={() => setUnitSendPending(true)}
                type="button"
              >
                <Users />
                <span>
                  <strong>Send to unit</strong>
                  <small>Offence</small>
                </span>
              </button>
              <button
                disabled={!play}
                onClick={async () => {
                  if (!play) return;
                  const cutups = await loadWorkspaceState<
                    { name: string; clips: string[] }[]
                  >('film-cutups', []);
                  await saveWorkspaceState('film-cutups', [
                    ...cutups,
                    { name: `${play.call} sideline`, clips: [play.dbId] },
                  ]);
                  onNotify(`${play.call} added to a saved cut-up.`);
                }}
                type="button"
              >
                <Film />
                <span>
                  <strong>Add to cut-up</strong>
                  <small>Saved locally</small>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <Dialog onOpenChange={setUnitSendPending} open={unitSendPending}>
        <DialogContent className="athlete-dialog sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Send this play to Offence?</DialogTitle>
            <DialogDescription>
              {play
                ? `${play.call} will be queued in the Offence conversation.`
                : 'Choose a saved play first.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setUnitSendPending(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={!play}
              onClick={() => {
                if (!play) return;
                setUnitSendPending(false);
                onNotify(`${play.call} queued in the offence conversation.`);
                onNavigate('Messages');
              }}
            >
              Confirm and send <Send />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

const fallbackAthletes: AthleteRecord[] = [];

const fallbackMetrics: AthleteMetrics = {
  total: 0,
  active: 0,
  eligible: 0,
  limited: 0,
  out: 0,
  installAverage: 0,
};

function positionFamily(position: string, unit: string) {
  if (position === 'QB') return 'quarterback';
  if (position === 'OL' || position === 'DL') return 'line';
  if (position === 'LB') return 'linebacker';
  if (unit === 'Defence') return 'secondary';
  if (position === 'RB' || position === 'FB') return 'back';
  return 'receiver';
}

function AthletesView({
  initialAthleteId = '',
  onEditingChange,
  assetRevision,
  onAssetsChanged,
  onNotify,
}: {
  initialAthleteId?: string;
  onEditingChange: (editing: boolean) => void;
  assetRevision: number;
  onAssetsChanged: () => void;
  onNotify: Notify;
}) {
  const session = useWorkspaceSession();
  const [query, setQuery] = useState('');
  const [unit, setUnit] = useState('All');
  const [statusFilter, setStatusFilter] = useState<'All' | AthleteStatus>(
    'All',
  );
  const [roster, setRoster] = useState<AthleteRecord[]>(fallbackAthletes);
  const [metrics, setMetrics] = useState<AthleteMetrics>(fallbackMetrics);
  const [selected, setSelected] = useState<AthleteRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [profileFormDirty, setProfileFormDirty] = useState(false);
  const [profileLeaveOpen, setProfileLeaveOpen] = useState(false);
  const [profileEditor, setProfileEditor] = useState<AthleteRecord | null>(
    null,
  );
  const [dataMessage, setDataMessage] = useState('Loading your roster…');
  const [rosterLoadError, setRosterLoadError] = useState(false);
  const [rosterRetry, setRosterRetry] = useState(0);
  const [rosterSaveError, setRosterSaveError] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [pendingAthlete, setPendingAthlete] = useState<AthleteRecord | null>(
    null,
  );
  const rosterWriteLock = useRef(false);
  const noteDirty = Boolean(selected && noteDraft !== selected.staffNote);
  useEffect(() => {
    onEditingChange(noteDirty || profileFormDirty || saving);
    return () => onEditingChange(false);
  }, [noteDirty, profileFormDirty, saving, onEditingChange]);
  useEffect(() => {
    if (!noteDirty && !profileFormDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [noteDirty, profileFormDirty]);
  const visibleAthletes = useMemo(
    () =>
      roster.filter((athlete) => {
        const matchesQuery = `${athlete.name} ${athlete.position} ${athlete.no}`
          .toLowerCase()
          .includes(query.toLowerCase());
        return (
          matchesQuery &&
          (unit === 'All' || athlete.unit === unit) &&
          (statusFilter === 'All' || athlete.status === statusFilter)
        );
      }),
    [query, roster, statusFilter, unit],
  );

  useEffect(() => {
    let active = true;
    fetch('/api/athletes', { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as {
          athletes?: AthleteRecord[];
          metrics?: AthleteMetrics;
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.error ?? 'Unable to load the roster.');
        if (!Array.isArray(data.athletes) || !data.metrics)
          throw new Error('The saved roster response was incomplete.');
        return data;
      })
      .then((data) => {
        if (!active || !data.athletes || !data.metrics) return;
        setRoster(data.athletes);
        setMetrics(data.metrics);
        const requested = initialAthleteId
          ? data.athletes.find((athlete) => athlete.id === initialAthleteId)
          : data.athletes[0];
        setSelected(requested ?? null);
        setNoteDraft(requested?.staffNote ?? '');
        if (initialAthleteId && !requested)
          onNotify('That athlete is no longer available.', 'info');
        setDataMessage(
          data.athletes.length
            ? 'Saved roster'
            : 'Roster empty · ready for your athletes',
        );
      })
      .catch((error: unknown) => {
        if (active) {
          setRosterLoadError(true);
          setDataMessage(
            error instanceof Error
              ? error.message
              : 'The roster could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rosterRetry, initialAthleteId, onNotify]);

  const createAthlete = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (rosterWriteLock.current) return;
    rosterWriteLock.current = true;
    setRosterSaveError('');
    setSaving(true);
    setDataMessage(
      profileEditor ? 'Saving athlete profile…' : 'Saving athlete…',
    );
    const fields = new FormData(event.currentTarget);
    const textField = (name: string) => {
      const value = fields.get(name);
      return typeof value === 'string' ? value : '';
    };
    const payload = {
      number: textField('number') === '' ? null : Number(textField('number')),
      firstName: textField('firstName'),
      lastName: textField('lastName'),
      position: textField('position'),
      unit: textField('unit') || 'Offence',
      graduationYear: Number(fields.get('graduationYear')),
      height: textField('height'),
      weightLb: Number(fields.get('weightLb')),
      email: textField('email'),
      phone: textField('phone'),
      staffNote: textField('staffNote'),
    };
    try {
      const response = await fetch('/api/athletes', {
        method: profileEditor ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          ...(profileEditor ? { id: profileEditor.id } : {}),
        }),
      });
      const data = (await response.json()) as {
        athlete?: AthleteRecord;
        metrics?: AthleteMetrics;
        error?: string;
      };
      if (!response.ok || !data.athlete || !data.metrics)
        throw new Error(data.error ?? 'Unable to add athlete.');
      setRoster((items) =>
        (profileEditor
          ? items.map((item) =>
              item.id === data.athlete!.id ? data.athlete! : item,
            )
          : [...items, data.athlete!]
        ).sort(
          (a, b) =>
            (a.no ?? Number.MAX_SAFE_INTEGER) -
            (b.no ?? Number.MAX_SAFE_INTEGER),
        ),
      );
      setMetrics(data.metrics);
      setSelected(data.athlete);
      setNoteDraft(data.athlete.staffNote);
      setAddOpen(false);
      setProfileFormDirty(false);
      setProfileEditor(null);
      setDataMessage(
        `${data.athlete.name} ${profileEditor ? 'updated' : 'added to the roster'}`,
      );
      onNotify(
        `${data.athlete.name} ${profileEditor ? 'updated' : 'added to the roster'}.`,
      );
    } catch (error) {
      setRosterSaveError(
        error instanceof Error ? error.message : 'Unable to add athlete.',
      );
      setDataMessage(
        error instanceof Error ? error.message : 'Unable to add athlete.',
      );
    } finally {
      rosterWriteLock.current = false;
      setSaving(false);
    }
  };

  const updateAthlete = async (
    changes: Partial<
      Pick<AthleteRecord, 'status' | 'staffNote' | 'install' | 'attendance'>
    >,
  ) => {
    if (!selected || rosterWriteLock.current) return false;
    rosterWriteLock.current = true;
    setRosterSaveError('');
    setSaving(true);
    setDataMessage('Saving changes…');
    try {
      const response = await fetch('/api/athletes', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: selected.id,
          status: changes.status,
          staffNote: changes.staffNote,
          installPercent: changes.install,
          attendancePercent: changes.attendance,
        }),
      });
      const data = (await response.json()) as {
        athlete?: AthleteRecord;
        metrics?: AthleteMetrics;
        error?: string;
      };
      if (!response.ok || !data.athlete || !data.metrics)
        throw new Error(data.error ?? 'Unable to save changes.');
      setSelected((current) =>
        current?.id === data.athlete?.id ? data.athlete! : current,
      );
      setRoster((items) =>
        items.map((athlete) =>
          athlete.id === data.athlete?.id ? data.athlete : athlete,
        ),
      );
      setMetrics(data.metrics);
      if (changes.staffNote !== undefined) setNoteDraft(data.athlete.staffNote);
      setDataMessage('Changes saved');
      onNotify(`${data.athlete.name} updated.`);
      return true;
    } catch (error) {
      setRosterSaveError(
        error instanceof Error ? error.message : 'Unable to save changes.',
      );
      setDataMessage(
        error instanceof Error ? error.message : 'Unable to save changes.',
      );
      return false;
    } finally {
      rosterWriteLock.current = false;
      setSaving(false);
    }
  };

  const chooseAthlete = (athlete: AthleteRecord) => {
    if (rosterWriteLock.current || athlete.id === selected?.id) return;
    if (noteDirty) {
      setPendingAthlete(athlete);
      return;
    }
    setSelected(athlete);
    setNoteDraft(athlete.staffNote);
    setRosterSaveError('');
  };
  if (loading || rosterLoadError)
    return (
      <section className="module-surface roster-surface">
        <ModuleHeader
          eyebrow="People & availability"
          title="Athletes"
          description="Your saved team roster."
        />
        {rosterLoadError ? (
          <>
            <p role="alert">{dataMessage}</p>
            <Button
              onClick={() => {
                setLoading(true);
                setRosterLoadError(false);
                setRosterRetry((value) => value + 1);
              }}
            >
              Retry roster
            </Button>
          </>
        ) : (
          <output>Loading your roster…</output>
        )}
      </section>
    );
  return (
    <section className="module-surface roster-surface">
      <ModuleHeader
        eyebrow="People & availability"
        title="Athletes"
        description="One clean roster for contacts, eligibility, health, learning, and team communication."
      >
        <Button
          className="module-secondary"
          onClick={() => {
            const rows = [
              [
                'Name',
                'Number',
                'Position',
                'Unit',
                'Grade',
                'Status',
                'Email',
                'Phone',
                'Install',
              ],
              ...roster.map((athlete) => [
                athlete.name,
                athlete.no ?? '',
                athlete.position,
                athlete.unit,
                athlete.year,
                athlete.status,
                athlete.email,
                athlete.phone,
                athlete.install,
              ]),
            ];
            downloadText(
              'team-roster.csv',
              rows.map((row) => row.map(quoteCsv).join(',')).join('\n'),
              'text/csv;charset=utf-8',
            );
            onNotify('Roster exported as CSV.');
          }}
          variant="outline"
        >
          <Download /> Export
        </Button>
        <Button
          className="module-primary"
          disabled={saving || noteDirty}
          onClick={() => {
            setRosterSaveError('');
            setProfileEditor(null);
            setProfileFormDirty(false);
            setAddOpen(true);
          }}
        >
          <UserPlus /> Add athlete
        </Button>
      </ModuleHeader>

      <div className="local-data-status">
        <span className={loading || saving ? 'sync-dot working' : 'sync-dot'} />
        <strong>{dataMessage}</strong>
        <small>
          {session.mode === 'prototype'
            ? 'Development workspace'
            : 'Private team workspace'}
        </small>
      </div>

      <div className="roster-stats">
        <article>
          <span className="stat-icon navy">
            <Users />
          </span>
          <div>
            <small>Total roster</small>
            <strong>{metrics.total}</strong>
            <p>{metrics.active} active</p>
          </div>
        </article>
        <article>
          <span className="stat-icon green">
            <CheckCircle2 />
          </span>
          <div>
            <small>Game eligible</small>
            <strong>{metrics.eligible}</strong>
            <p>
              {metrics.total
                ? Math.round((metrics.eligible / metrics.total) * 100)
                : 0}
              % cleared
            </p>
          </div>
        </article>
        <article>
          <span className="stat-icon amber">
            <AlertCircle />
          </span>
          <div>
            <small>Availability</small>
            <strong>{metrics.limited + metrics.out}</strong>
            <p>
              {metrics.limited} limited · {metrics.out} out
            </p>
          </div>
        </article>
        <article>
          <span className="stat-icon blue">
            <ClipboardList />
          </span>
          <div>
            <small>Install average</small>
            <strong>{metrics.installAverage}%</strong>
            <p>Across saved athletes</p>
          </div>
        </article>
      </div>

      <div className="roster-toolbar">
        <div className="toolbar-search">
          <Search />
          <Input
            aria-label="Search roster"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, number, position…"
            value={query}
          />
        </div>
        <div className="segmented-control">
          {['All', 'Offence', 'Defence'].map((item) => (
            <button
              className={unit === item ? 'active' : ''}
              key={item}
              onClick={() => setUnit(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <Button
          onClick={() =>
            setStatusFilter((current) =>
              current === 'All'
                ? 'Limited'
                : current === 'Limited'
                  ? 'Out'
                  : 'All',
            )
          }
          variant="outline"
        >
          <ListFilter />{' '}
          {statusFilter === 'All' ? 'More filters' : statusFilter}{' '}
          {statusFilter !== 'All' ? <Badge variant="secondary">1</Badge> : null}
        </Button>
      </div>

      <div className={selected ? 'roster-grid' : 'roster-grid no-selection'}>
        <div className="roster-table-wrap">
          <table className="roster-table">
            <thead>
              <tr>
                <th>Athlete</th>
                <th>Pos</th>
                <th>Unit</th>
                <th>Year</th>
                <th>Status</th>
                <th>Install</th>
                <th>
                  <span className="sr-only">Open athlete</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!loading && visibleAthletes.length === 0 ? (
                <tr className="roster-empty">
                  <td colSpan={7}>
                    <Users />
                    <strong>No athletes match these filters.</strong>
                    <span>
                      {roster.length
                        ? 'Try another search or filter.'
                        : 'Your roster table will fill this workspace once athletes are added.'}
                    </span>
                    {!roster.length ? (
                      <Button
                        onClick={() => {
                          setProfileEditor(null);
                          setProfileFormDirty(false);
                          setRosterSaveError('');
                          setAddOpen(true);
                        }}
                        size="sm"
                      >
                        <UserPlus /> Add first athlete
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ) : null}
              {visibleAthletes.map((athlete) => {
                const family = positionFamily(athlete.position, athlete.unit);
                return (
                  <tr
                    className={`${selected?.id === athlete.id ? 'selected ' : ''}position-family-${family}`}
                    key={athlete.id}
                    onClick={() => chooseAthlete(athlete)}
                  >
                    <td>
                      <MediaAvatar
                        assetKey={`athlete-${athlete.id}`}
                        className="roster-avatar"
                        fallback={athlete.initials}
                        label={`${athlete.name} profile photo`}
                        revision={assetRevision}
                      />
                      <span>
                        <strong>{athlete.name}</strong>
                        <small>
                          {athlete.no === null
                            ? 'No jersey number'
                            : `#${athlete.no}`}
                        </small>
                      </span>
                    </td>
                    <td>
                      <Badge
                        className={`position-family-tag ${family}`}
                        variant="outline"
                      >
                        {athlete.position}
                      </Badge>
                    </td>
                    <td>{athlete.unit}</td>
                    <td>Grade {athlete.year}</td>
                    <td>
                      <span
                        className={`status-pill ${athlete.status.toLowerCase()}`}
                      >
                        <i /> {athlete.status}
                      </span>
                    </td>
                    <td>
                      <div className="install-cell">
                        <progress
                          aria-label={`${athlete.install}% install complete`}
                          className="sr-only"
                          max={100}
                          value={athlete.install}
                        />
                        <span>
                          <i style={{ width: `${athlete.install}%` }} />
                        </span>
                        <b>{athlete.install}%</b>
                      </div>
                    </td>
                    <td>
                      <Button
                        aria-label={`Open ${athlete.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          chooseAthlete(athlete);
                        }}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <ChevronRight />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {selected ? (
          <aside className="athlete-detail">
            <div className="athlete-detail-head">
              <MediaAvatar
                assetKey={`athlete-${selected.id}`}
                className="detail-avatar"
                fallback={selected.initials}
                label={`${selected.name} profile photo`}
                revision={assetRevision}
              />
              <div>
                <Badge variant="secondary">
                  {selected.no === null ? 'No number' : `#${selected.no}`} ·{' '}
                  {selected.position}
                </Badge>
                <h2>{selected.name}</h2>
                <p>
                  {selected.unit} · Grade {selected.year}
                </p>
              </div>
              <Button
                aria-label="Edit athlete profile"
                disabled={saving || noteDirty}
                onClick={() => {
                  setRosterSaveError('');
                  setProfileEditor(selected);
                  setProfileFormDirty(false);
                  setAddOpen(true);
                }}
                size="icon-sm"
                variant="outline"
              >
                <Pencil />
              </Button>
            </div>
            <div className="contact-actions">
              <Button
                aria-label="Email athlete"
                disabled={!selected.email}
                onClick={() => {
                  window.location.href = `mailto:${selected.email}`;
                }}
                size="icon"
                variant="outline"
              >
                <Mail />
              </Button>
              <Button
                aria-label="Phone athlete"
                disabled={!selected.phone}
                onClick={() => {
                  window.location.href = `tel:${selected.phone}`;
                }}
                size="icon"
                variant="outline"
              >
                <Phone />
              </Button>
            </div>
            <div className="profile-media-actions">
              <MediaUploadControl
                assetKey={`athlete-${selected.id}`}
                label="Upload athlete photo"
                onNotify={onNotify}
                onUploaded={onAssetsChanged}
              />
              <Button
                onClick={async () => {
                  try {
                    await deleteMedia(`athlete-${selected.id}`);
                    onAssetsChanged();
                    onNotify(`${selected.name}'s photo removed.`, 'info');
                  } catch {
                    onNotify(
                      'The athlete photo could not be removed.',
                      'error',
                    );
                  }
                }}
                size="sm"
                variant="ghost"
              >
                <Trash2 /> Remove
              </Button>
            </div>
            <div className="detail-grid">
              <div>
                <small>Height</small>
                <strong>{selected.height}</strong>
              </div>
              <div>
                <small>Weight</small>
                <strong>{selected.weight}</strong>
              </div>
              <div>
                <small>Eligibility</small>
                <strong>{selected.eligibility}</strong>
              </div>
              <div>
                <small>Attendance</small>
                <strong>{selected.attendance}%</strong>
              </div>
            </div>
            <label
              className="availability-editor"
              htmlFor="athlete-availability"
            >
              Availability
              <NativeSelect
                disabled={saving}
                id="athlete-availability"
                onChange={(event) =>
                  void updateAthlete({
                    status: event.target.value as AthleteStatus,
                  })
                }
                value={selected.status}
              >
                <NativeSelectOption value="Active">
                  Active · full participation
                </NativeSelectOption>
                <NativeSelectOption value="Limited">
                  Limited · modified work
                </NativeSelectOption>
                <NativeSelectOption value="Out">
                  Out · unavailable
                </NativeSelectOption>
              </NativeSelect>
            </label>
            <div className="detail-section">
              <div className="property-title">
                <strong>Install progress</strong>
                <span>{selected.install}%</span>
              </div>
              <div className="detail-progress">
                <i style={{ width: `${selected.install}%` }} />
              </div>
            </div>
            <div className="detail-section">
              <div className="property-title">
                <strong>Staff note</strong>
                <Lock />
              </div>
              <Textarea
                aria-label="Staff note"
                className="staff-note-editor"
                value={noteDraft}
                disabled={saving}
                key={selected.id}
                onChange={(event) => setNoteDraft(event.target.value)}
              />
              <p className="staff-note-save">
                Private · {noteDirty ? 'Unsaved changes' : 'Saved note'}
              </p>
              <Button
                disabled={!noteDirty || saving}
                onClick={() => void updateAthlete({ staffNote: noteDraft })}
              >
                {saving ? 'Saving…' : 'Save note'}
              </Button>
              {rosterSaveError ? <p role="alert">{rosterSaveError}</p> : null}
            </div>
          </aside>
        ) : null}
      </div>

      <Dialog open={profileLeaveOpen} onOpenChange={setProfileLeaveOpen}>
        <DialogContent className="athlete-dialog">
          <DialogHeader>
            <DialogTitle>Discard profile changes?</DialogTitle>
            <DialogDescription>
              Your last saved athlete profile will be kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProfileLeaveOpen(false)}
            >
              Keep editing
            </Button>
            <Button
              onClick={() => {
                setProfileLeaveOpen(false);
                setProfileFormDirty(false);
                setAddOpen(false);
                setProfileEditor(null);
                setRosterSaveError('');
              }}
            >
              Discard profile changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(pendingAthlete)}
        onOpenChange={(open) => {
          if (!open) setPendingAthlete(null);
        }}
      >
        <DialogContent className="athlete-dialog">
          <DialogHeader>
            <DialogTitle>Leave this athlete’s unsaved note?</DialogTitle>
            <DialogDescription>
              Save the note first, or discard it before opening another athlete.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAthlete(null)}>
              Keep editing
            </Button>
            <Button
              onClick={() => {
                if (!pendingAthlete) return;
                setSelected(pendingAthlete);
                setNoteDraft(pendingAthlete.staffNote);
                setPendingAthlete(null);
                setRosterSaveError('');
              }}
            >
              Discard note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={(open) => {
          if (!saving) {
            if (!open && profileFormDirty) {
              setProfileLeaveOpen(true);
              return;
            }
            setAddOpen(open);
            setRosterSaveError('');
          }
        }}
        open={addOpen}
      >
        <DialogContent className="athlete-dialog sm:max-w-[620px]">
          <form
            key={profileEditor?.id ?? 'new-athlete'}
            onChangeCapture={() => setProfileFormDirty(true)}
            inert={saving}
            onSubmit={createAthlete}
          >
            {rosterSaveError ? <p role="alert">{rosterSaveError}</p> : null}
            <DialogHeader>
              <DialogTitle>
                {profileEditor ? 'Edit athlete profile' : 'Add athlete'}
              </DialogTitle>
              <DialogDescription>
                {profileEditor
                  ? 'Correct this athlete’s details. Notes, availability, assignments and history stay with the same athlete.'
                  : 'Add an athlete to your team’s saved roster.'}
              </DialogDescription>
            </DialogHeader>
            <div className="athlete-form-grid">
              <label htmlFor="new-athlete-first-name">
                <span>
                  First name{' '}
                  <b className="field-required" aria-hidden="true">
                    *
                  </b>
                </span>
                <Input
                  id="new-athlete-first-name"
                  name="firstName"
                  defaultValue={profileEditor?.firstName ?? ''}
                  maxLength={80}
                  required
                />
              </label>
              <label htmlFor="new-athlete-last-name">
                <span>
                  Last name{' '}
                  <b className="field-required" aria-hidden="true">
                    *
                  </b>
                </span>
                <Input
                  id="new-athlete-last-name"
                  name="lastName"
                  defaultValue={profileEditor?.lastName ?? ''}
                  maxLength={80}
                  required
                />
              </label>
              <label htmlFor="new-athlete-number">
                Jersey number
                <Input
                  id="new-athlete-number"
                  defaultValue={profileEditor?.no ?? ''}
                  max="99"
                  min="0"
                  name="number"
                  type="number"
                />
              </label>
              <label htmlFor="new-athlete-position">
                Position
                <Input
                  id="new-athlete-position"
                  defaultValue={profileEditor?.position ?? ''}
                  maxLength={8}
                  name="position"
                  placeholder="ATH"
                />
              </label>
              <label htmlFor="new-athlete-unit">
                Unit
                <NativeSelect
                  defaultValue={profileEditor?.unit ?? 'Offence'}
                  id="new-athlete-unit"
                  name="unit"
                >
                  <NativeSelectOption value="Offence">
                    Offence
                  </NativeSelectOption>
                  <NativeSelectOption value="Defence">
                    Defence
                  </NativeSelectOption>
                  <NativeSelectOption value="Special teams">
                    Special teams
                  </NativeSelectOption>
                </NativeSelect>
              </label>
              <label htmlFor="new-athlete-grade">
                Grade
                <NativeSelect
                  defaultValue={profileEditor?.year ?? '12'}
                  id="new-athlete-grade"
                  name="graduationYear"
                >
                  <NativeSelectOption value="9">Grade 9</NativeSelectOption>
                  <NativeSelectOption value="10">Grade 10</NativeSelectOption>
                  <NativeSelectOption value="11">Grade 11</NativeSelectOption>
                  <NativeSelectOption value="12">Grade 12</NativeSelectOption>
                  <NativeSelectOption value="13">Grade 13</NativeSelectOption>
                </NativeSelect>
              </label>
              <label htmlFor="new-athlete-height">
                Height
                <Input
                  id="new-athlete-height"
                  defaultValue={
                    profileEditor?.height === '—'
                      ? ''
                      : (profileEditor?.height ?? '')
                  }
                  maxLength={40}
                  name="height"
                  placeholder={"6'1″"}
                />
              </label>
              <label htmlFor="new-athlete-weight">
                Weight (lb)
                <Input
                  id="new-athlete-weight"
                  defaultValue={profileEditor?.weightLb || ''}
                  max="450"
                  min="0"
                  name="weightLb"
                  type="number"
                />
              </label>
              <label htmlFor="new-athlete-email">
                <span>
                  Email{' '}
                  <b className="field-required" aria-hidden="true">
                    *
                  </b>
                </span>
                <Input
                  id="new-athlete-email"
                  defaultValue={profileEditor?.email ?? ''}
                  maxLength={254}
                  name="email"
                  required
                  type="email"
                />
              </label>
              <label htmlFor="new-athlete-phone">
                Phone
                <Input
                  id="new-athlete-phone"
                  name="phone"
                  defaultValue={profileEditor?.phone ?? ''}
                  maxLength={80}
                  type="tel"
                />
              </label>
              {!profileEditor ? (
                <label className="full" htmlFor="new-athlete-note">
                  Initial staff note
                  <Textarea
                    id="new-athlete-note"
                    name="staffNote"
                    placeholder="Health, development, or role context…"
                  />
                </label>
              ) : null}
            </div>
            <DialogFooter>
              <Button disabled={saving} type="submit">
                {saving
                  ? 'Saving…'
                  : profileEditor
                    ? 'Save profile'
                    : 'Add to roster'}{' '}
                {profileEditor ? <Check /> : <UserPlus />}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

type DepthPlayerSlot = {
  id: string;
  pos: string;
  athleteId: string;
  x: number;
  y: number;
};
type DepthLayouts = Record<AthleteUnit, DepthPlayerSlot[]>;

const emptyDepthLayouts: DepthLayouts = {
  Offence: [],
  Defence: [],
  'Special teams': [],
};
const depthUnits: AthleteUnit[] = ['Offence', 'Defence', 'Special teams'];

function DepthChartsView({ onNotify }: { onNotify: Notify }) {
  const [group, setGroup] = useState<AthleteUnit>('Offence');
  const [layouts, setLayouts] = useState<DepthLayouts>(emptyDepthLayouts);
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState(true);
  const [roster, setRoster] = useState<DepthChartPayload['athletes']>([]);
  const [depthSaving, setDepthSaving] = useState(false);
  const [depthMessage, setDepthMessage] = useState('Loading saved layout…');
  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [draggingId, setDraggingId] = useState('');
  const depthBoardRef = useRef<HTMLDivElement>(null);
  const lineup = layouts[group];
  const selected = lineup.find((slot) => slot.id === selectedId) ?? null;
  const assignedCount = lineup.filter((slot) => slot.athleteId).length;

  useEffect(() => {
    let active = true;
    Promise.all([
      loadWorkspaceState<DepthLayouts>('depth-layouts-v2', emptyDepthLayouts),
      fetch('/api/depth-charts', { cache: 'no-store' }).then(
        async (response) => {
          const data = (await response.json()) as DepthChartPayload & {
            error?: string;
          };
          if (!response.ok)
            throw new Error(data.error ?? 'Unable to load roster choices.');
          return data.athletes;
        },
      ),
    ])
      .then(([savedLayouts, athletes]) => {
        if (!active) return;
        setLayouts({ ...emptyDepthLayouts, ...savedLayouts });
        setRoster(athletes);
        setDepthMessage('Layout saved locally');
      })
      .catch((error: unknown) => {
        if (active)
          setDepthMessage(
            error instanceof Error
              ? error.message
              : 'Unable to load the depth chart.',
          );
      });
    return () => {
      active = false;
    };
  }, []);

  const persistLayouts = async (
    next: DepthLayouts,
    successMessage = 'Layout saved locally',
  ) => {
    setLayouts(next);
    setDepthSaving(true);
    setDepthMessage('Saving layout…');
    try {
      await saveWorkspaceState('depth-layouts-v2', next);
      setDepthMessage(successMessage);
    } catch (error) {
      setDepthMessage(
        error instanceof Error ? error.message : 'Unable to save the layout.',
      );
    } finally {
      setDepthSaving(false);
    }
  };

  const updateSlot = (
    id: string,
    patch: Partial<DepthPlayerSlot>,
    save = false,
  ) => {
    const next = {
      ...layouts,
      [group]: layouts[group].map((slot) =>
        slot.id === id ? { ...slot, ...patch } : slot,
      ),
    };
    if (save) void persistLayouts(next);
    else setLayouts(next);
  };

  const positionFromPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const bounds = depthBoardRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      x: Math.min(
        94,
        Math.max(6, ((event.clientX - bounds.left) / bounds.width) * 100),
      ),
      y: Math.min(
        92,
        Math.max(8, ((event.clientY - bounds.top) / bounds.height) * 100),
      ),
    };
  };

  const movePositionCard = (
    event: ReactPointerEvent<HTMLButtonElement>,
    slot: DepthPlayerSlot,
    save: boolean,
  ) => {
    const position = positionFromPointer(event);
    if (!position) return;
    const next = {
      ...layouts,
      [group]: layouts[group].map((item) =>
        item.id === slot.id ? { ...item, ...position } : item,
      ),
    };
    if (save) void persistLayouts(next, `${slot.pos} position saved.`);
    else setLayouts(next);
  };

  const addPosition = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const pos = formText(fields, 'positionName').trim();
    if (!pos) return;
    const index = lineup.length;
    const slot: DepthPlayerSlot = {
      id: globalThis.crypto?.randomUUID?.() ?? `position-${Date.now()}`,
      pos,
      athleteId: '',
      x: 18 + (index % 4) * 21,
      y: 22 + Math.floor(index / 4) * 22,
    };
    const next = { ...layouts, [group]: [...lineup, slot] };
    setSelectedId(slot.id);
    setEditing(true);
    setPositionDialogOpen(false);
    void persistLayouts(next, `${pos} added to ${group}.`);
  };

  const selectedAthlete = selected?.athleteId
    ? roster.find((athlete) => athlete.id === selected.athleteId)
    : null;

  return (
    <section className="module-surface depth-surface">
      <ModuleHeader
        eyebrow="Personnel"
        title="Depth Charts"
        description="Build each unit with the position names and alignment your team actually uses."
      >
        <Button
          className="module-secondary"
          onClick={() => window.print()}
          variant="outline"
        >
          <Download /> Print
        </Button>
        <Button
          className="module-primary"
          onClick={async () => {
            if (editing) {
              await saveWorkspaceState('depth-chart-publication', {
                unit: group,
                publishedAt: new Date().toISOString(),
              });
              onNotify(`${group} depth chart published.`);
            }
            setEditing((value) => !value);
          }}
        >
          {editing ? <Check /> : <Pencil />}{' '}
          {editing ? 'Publish layout' : 'Edit layout'}
        </Button>
      </ModuleHeader>

      <div className="depth-toolbar">
        <div className="segmented-control large">
          {depthUnits.map((item) => (
            <button
              className={group === item ? 'active' : ''}
              key={item}
              onClick={() => {
                setGroup(item);
                setSelectedId(layouts[item][0]?.id ?? '');
              }}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <Button onClick={() => setPositionDialogOpen(true)} variant="outline">
          <Plus /> Add position
        </Button>
        <Button
          onClick={() =>
            onNotify(
              `${assignedCount} of ${lineup.length} positions are assigned.`,
              'info',
            )
          }
          variant="outline"
        >
          <Users /> {assignedCount} assigned
        </Button>
      </div>
      <div className="local-data-status depth-data-status">
        <span className={depthSaving ? 'sync-dot working' : 'sync-dot'} />
        <strong>{depthMessage}</strong>
        <small>
          {lineup.length} team-defined{' '}
          {lineup.length === 1 ? 'position' : 'positions'} · {roster.length}{' '}
          roster athletes
        </small>
      </div>

      <div className="depth-grid">
        <div className="depth-field">
          <div className="depth-field-header">
            <span>{group} alignment</span>
            <small>
              {editing
                ? 'Drag a position card to move it, or use the precise controls'
                : 'Published team layout'}
            </small>
          </div>
          <div
            className="depth-field-inner depth-custom-board"
            ref={depthBoardRef}
          >
            {!lineup.length ? (
              <div className="viewer-empty-state">
                <Shirt />
                <strong>No positions in this unit</strong>
                <span>Create only the roles and alignment your team uses.</span>
                <Button onClick={() => setPositionDialogOpen(true)}>
                  <Plus /> Add first position
                </Button>
              </div>
            ) : null}
            {lineup.map((slot) => {
              const athlete = roster.find((item) => item.id === slot.athleteId);
              return (
                <button
                  aria-label={`${slot.pos}, ${athlete?.name ?? 'unassigned'}${editing ? '. Drag to reposition.' : ''}`}
                  className={`${selectedId === slot.id ? 'depth-player selected' : 'depth-player'}${draggingId === slot.id ? ' dragging' : ''}`}
                  key={slot.id}
                  onClick={() => setSelectedId(slot.id)}
                  onPointerCancel={() => setDraggingId('')}
                  onPointerDown={(event) => {
                    if (!editing || event.button !== 0) return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setSelectedId(slot.id);
                    setDraggingId(slot.id);
                    movePositionCard(event, slot, false);
                  }}
                  onPointerMove={(event) => {
                    if (editing && draggingId === slot.id)
                      movePositionCard(event, slot, false);
                  }}
                  onPointerUp={(event) => {
                    if (draggingId !== slot.id) return;
                    movePositionCard(event, slot, true);
                    setDraggingId('');
                  }}
                  style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
                  type="button"
                >
                  {editing ? <GripVertical aria-hidden="true" /> : null}
                  <span>{slot.pos}</span>
                  <strong>{athlete?.name ?? 'Unassigned'}</strong>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="depth-detail">
          {selected ? (
            <>
              <div className="properties-heading">
                <strong>{selected.pos}</strong>
                <Badge>{group}</Badge>
              </div>
              <label
                className="depth-position-name"
                htmlFor="depth-position-name"
              >
                Position name
                <Input
                  disabled={!editing}
                  id="depth-position-name"
                  onBlur={() => void persistLayouts(layouts)}
                  onChange={(event) =>
                    updateSlot(selected.id, { pos: event.target.value })
                  }
                  value={selected.pos}
                />
              </label>
              <div className="depth-rank starter">
                <span>1</span>
                <span className="roster-avatar">
                  {selectedAthlete?.name
                    .split(' ')
                    .map((part) => part[0])
                    .join('') || '—'}
                </span>
                <div>
                  <strong>{selectedAthlete?.name ?? 'Unassigned'}</strong>
                  <small>
                    {selectedAthlete
                      ? `${selectedAthlete.position || 'No roster position'} · ${selectedAthlete.status}`
                      : 'Choose a real roster athlete'}
                  </small>
                </div>
                <Badge>Starter</Badge>
              </div>
              <NativeSelect
                aria-label={`Choose ${selected.pos} starter`}
                className="depth-athlete-select"
                disabled={!editing || depthSaving}
                onChange={(event) =>
                  updateSlot(
                    selected.id,
                    { athleteId: event.target.value },
                    true,
                  )
                }
                value={selected.athleteId}
              >
                <NativeSelectOption value="">Unassigned</NativeSelectOption>
                {roster.map((athlete) => (
                  <NativeSelectOption key={athlete.id} value={athlete.id}>
                    {athlete.no === null ? '—' : `#${athlete.no}`} ·{' '}
                    {athlete.name}
                    {athlete.position ? ` · ${athlete.position}` : ''}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <div className="depth-coordinate-controls">
                <label htmlFor="depth-x">
                  Horizontal position
                  <input
                    disabled={!editing}
                    id="depth-x"
                    max="94"
                    min="6"
                    onChange={(event) =>
                      updateSlot(selected.id, { x: Number(event.target.value) })
                    }
                    onPointerUp={() => void persistLayouts(layouts)}
                    type="range"
                    value={selected.x}
                  />
                </label>
                <label htmlFor="depth-y">
                  Vertical position
                  <input
                    disabled={!editing}
                    id="depth-y"
                    max="92"
                    min="8"
                    onChange={(event) =>
                      updateSlot(selected.id, { y: Number(event.target.value) })
                    }
                    onPointerUp={() => void persistLayouts(layouts)}
                    type="range"
                    value={selected.y}
                  />
                </label>
              </div>
              <div className="property-divider" />
              <div className="detail-section compact">
                <div className="property-title">
                  <strong>Role notes</strong>
                  <Lock />
                </div>
                <Textarea
                  placeholder="Add a real game or role note…"
                  onBlur={async (event) => {
                    await saveWorkspaceState(
                      `depth-note-${group.toLowerCase().replaceAll(' ', '-')}-${selected.id}`,
                      event.target.value,
                    );
                    onNotify(`${selected.pos} note saved.`);
                  }}
                />
              </div>
              <Button
                className="w-full"
                disabled={!editing}
                onClick={() => {
                  const next = {
                    ...layouts,
                    [group]: lineup.filter((slot) => slot.id !== selected.id),
                  };
                  setSelectedId('');
                  void persistLayouts(next, `${selected.pos} removed.`);
                }}
                variant="outline"
              >
                <Trash2 /> Remove position
              </Button>
            </>
          ) : (
            <div className="viewer-empty-state compact">
              <CircleDot />
              <strong>Select a position</strong>
              <span>
                Add or select a position card to edit its name, athlete, and
                placement.
              </span>
            </div>
          )}
        </aside>
      </div>
      <Dialog onOpenChange={setPositionDialogOpen} open={positionDialogOpen}>
        <DialogContent className="athlete-dialog sm:max-w-[460px]">
          <form onSubmit={addPosition}>
            <DialogHeader>
              <DialogTitle>Add a team position</DialogTitle>
              <DialogDescription>
                Name the role exactly as your team uses it. You can assign an
                athlete and move it on the board next.
              </DialogDescription>
            </DialogHeader>
            <div className="athlete-form-grid">
              <label className="full" htmlFor="depth-new-position">
                Position name
                <Input
                  id="depth-new-position"
                  maxLength={24}
                  name="positionName"
                  placeholder="Example: Boundary half"
                  required
                />
              </label>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setPositionDialogOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button type="submit">
                Add position <Plus />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

type MessageRecord = {
  id: number;
  author: string;
  initials: string;
  time: string;
  text: string;
  own: boolean;
  reacted?: boolean;
  reactionCount?: number;
};
type MessageCentreState = {
  store: Record<string, MessageRecord[]>;
  channels: string[];
  kinds: Record<string, 'channel' | 'direct'>;
  members: Record<string, string[]>;
};

const channels = [
  { name: 'Coaches', icon: Hash, unread: 0 },
  { name: 'Announcements', icon: Megaphone, unread: 0 },
  { name: 'Offence', icon: Hash, unread: 0 },
  { name: 'Defence', icon: Hash, unread: 0 },
  { name: 'Special teams', icon: Hash, unread: 0 },
  { name: 'Athlete leadership', icon: Lock, unread: 0 },
];

function MessagesView({
  onNavigate,
  onNotify,
  teamSettings,
}: {
  onNavigate: (view: string) => void;
  onNotify: Notify;
  teamSettings: TeamSettings;
}) {
  const [activeChannel, setActiveChannel] = useState('Coaches');
  const [messageStore, setMessageStore] = useState<
    Record<string, MessageRecord[]>
  >({});
  const [channelNames, setChannelNames] = useState(
    channels.map((channel) => channel.name),
  );
  const [channelKinds, setChannelKinds] = useState<
    Record<string, 'channel' | 'direct'>
  >(() =>
    Object.fromEntries(channels.map((channel) => [channel.name, 'channel'])),
  );
  const [memberStore, setMemberStore] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [conversationDialogOpen, setConversationDialogOpen] = useState(false);
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const messages = (messageStore[activeChannel] ?? []).filter((message) =>
    message.text.toLowerCase().includes(messageSearch.toLowerCase()),
  );
  const ActiveChannelIcon =
    channels.find((channel) => channel.name === activeChannel)?.icon ?? Hash;

  useEffect(() => {
    const defaultKinds = Object.fromEntries(
      channels.map((channel) => [channel.name, 'channel' as const]),
    );
    loadWorkspaceState<MessageCentreState>('message-centre-v2', {
      store: {},
      channels: channels.map((channel) => channel.name),
      kinds: defaultKinds,
      members: {},
    })
      .then((saved) => {
        setMessageStore(saved.store ?? {});
        setChannelNames(saved.channels ?? []);
        setChannelKinds({ ...defaultKinds, ...saved.kinds });
        setMemberStore(saved.members ?? {});
      })
      .catch(() =>
        onNotify('Saved conversations could not be loaded.', 'warning'),
      );
  }, [onNotify]);

  const persistMessages = async (
    store = messageStore,
    names = channelNames,
    kinds = channelKinds,
    members = memberStore,
  ) =>
    saveWorkspaceState('message-centre-v2', {
      store,
      channels: names,
      kinds,
      members,
    });

  const sendMessage = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const next = {
      ...messageStore,
      [activeChannel]: [
        ...(messageStore[activeChannel] ?? []),
        {
          id: Date.now(),
          author: 'You',
          initials: 'CM',
          time: 'Now',
          text,
          own: true,
        },
      ],
    };
    setMessageStore(next);
    setDraft('');
    try {
      await persistMessages(next);
      onNotify(`Message sent to ${activeChannel}.`);
    } catch {
      onNotify('The message could not be saved.', 'error');
    }
  };

  const createConversation = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = formText(fields, 'conversationName').trim();
    const kind: 'channel' | 'direct' =
      fields.get('conversationKind') === 'direct' ? 'direct' : 'channel';
    if (!name) return;
    if (
      channelNames.some((item) => item.toLowerCase() === name.toLowerCase())
    ) {
      onNotify('A conversation with that name already exists.', 'warning');
      return;
    }
    const names = [...channelNames, name];
    const store = { ...messageStore, [name]: [] };
    const kinds: Record<string, 'channel' | 'direct'> = {
      ...channelKinds,
      [name]: kind,
    };
    setChannelNames(names);
    setMessageStore(store);
    setChannelKinds(kinds);
    setActiveChannel(name);
    setConversationOpen(true);
    setConversationDialogOpen(false);
    await persistMessages(store, names, kinds);
    onNotify(`${name} created.`);
  };

  const addMember = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = formText(
      new FormData(event.currentTarget),
      'memberName',
    ).trim();
    if (!name) return;
    const current = memberStore[activeChannel] ?? [];
    if (current.some((member) => member.toLowerCase() === name.toLowerCase())) {
      onNotify(`${name} is already in ${activeChannel}.`, 'info');
      return;
    }
    const members = { ...memberStore, [activeChannel]: [...current, name] };
    setMemberStore(members);
    setMemberDialogOpen(false);
    await persistMessages(messageStore, channelNames, channelKinds, members);
    onNotify(`${name} added to ${activeChannel}.`);
  };

  const toggleReaction = async (messageId: number) => {
    const nextMessages = (messageStore[activeChannel] ?? []).map((message) => {
      if (message.id !== messageId) return message;
      const reacted = !message.reacted;
      return {
        ...message,
        reacted,
        reactionCount: Math.max(
          0,
          (message.reactionCount ?? 0) + (reacted ? 1 : -1),
        ),
      };
    });
    const next = { ...messageStore, [activeChannel]: nextMessages };
    setMessageStore(next);
    try {
      await persistMessages(next);
    } catch {
      onNotify('The reaction could not be saved.', 'error');
    }
  };

  return (
    <section className="module-surface messages-surface">
      <ModuleHeader
        eyebrow="Team communication"
        title="Messages"
        description="Film, plays, assignments, and decisions stay attached to the conversation."
      >
        <Button
          className="module-secondary"
          onClick={() => setSearchOpen((value) => !value)}
          variant="outline"
        >
          <Search /> Search messages
        </Button>
        <Button
          className="module-primary"
          onClick={() => setConversationDialogOpen(true)}
        >
          <Plus /> New message
        </Button>
      </ModuleHeader>

      <div
        className={`messages-layout${conversationOpen ? ' conversation-open' : ''}`}
      >
        <aside className="channel-sidebar">
          <div className="panel-title">
            <div>
              <strong>{teamSettings.teamName || 'Team'}</strong>
              <span>{channelNames.length} saved channels</span>
            </div>
            <Button
              aria-label="Workspace options"
              onClick={() =>
                onNotify(
                  `${teamSettings.teamName || 'Team'} messaging workspace is active.`,
                  'info',
                )
              }
              size="icon-sm"
              variant="ghost"
            >
              <MoreHorizontal />
            </Button>
          </div>
          <p className="channel-label">Channels</p>
          {channelNames
            .filter((name) => channelKinds[name] !== 'direct')
            .map((name) => {
              const channel = channels.find((item) => item.name === name);
              const Icon = channel?.icon ?? Hash;
              return (
                <button
                  className={
                    activeChannel === name
                      ? 'channel-row active'
                      : 'channel-row'
                  }
                  key={name}
                  onClick={() => {
                    setActiveChannel(name);
                    setConversationOpen(true);
                  }}
                  type="button"
                >
                  <Icon />
                  <span>{name}</span>
                  {channel?.unread ? <b>{channel.unread}</b> : null}
                </button>
              );
            })}
          <p className="channel-label">Direct messages</p>
          {channelNames
            .filter((name) => channelKinds[name] === 'direct')
            .map((name) => (
              <button
                className={
                  activeChannel === name
                    ? 'channel-row active dm'
                    : 'channel-row dm'
                }
                key={name}
                onClick={() => {
                  setActiveChannel(name);
                  setConversationOpen(true);
                }}
                type="button"
              >
                <Users />
                <span>{name}</span>
              </button>
            ))}
          {!channelNames.some((name) => channelKinds[name] === 'direct') ? (
            <div className="channel-empty">No direct conversations yet</div>
          ) : null}
          <button
            className="add-channel"
            onClick={() => setConversationDialogOpen(true)}
            type="button"
          >
            <Plus /> Add people or channel
          </button>
        </aside>

        <div className="conversation">
          <header className="conversation-head">
            <div>
              <button
                className="conversation-back"
                onClick={() => setConversationOpen(false)}
                type="button"
              >
                <ChevronLeft /> Channels
              </button>
              <span className="channel-icon">
                <ActiveChannelIcon />
              </span>
              <div>
                <strong>{activeChannel}</strong>
                <small>Saved local channel</small>
              </div>
            </div>
            <div>
              <Button
                aria-label="Channel options"
                onClick={() => setDetailsOpen((value) => !value)}
                size="icon"
                variant="ghost"
              >
                <MoreHorizontal />
              </Button>
            </div>
          </header>
          {searchOpen ? (
            <div className="toolbar-search message-search">
              <Search />
              <Input
                aria-label="Search current conversation"
                onChange={(event) => setMessageSearch(event.target.value)}
                placeholder="Search this conversation…"
                value={messageSearch}
              />
            </div>
          ) : null}
          <div className="message-stream">
            {messages.length ? (
              <div className="day-divider">
                <span>Messages</span>
              </div>
            ) : (
              <div className="viewer-empty-state">
                <MessageSquareText />
                <strong>No messages in {activeChannel}</strong>
                <span>Write the first real message below.</span>
              </div>
            )}
            {messages.map((message) => (
              <article
                className={message.own ? 'message-row own' : 'message-row'}
                key={message.id}
              >
                <span className="message-avatar">{message.initials}</span>
                <div>
                  <div>
                    <strong>{message.author}</strong>
                    <small>{message.time}</small>
                  </div>
                  <p>{message.text}</p>
                  <button
                    aria-label={
                      message.reacted
                        ? 'Remove thumbs up reaction'
                        : 'Add thumbs up reaction'
                    }
                    aria-pressed={Boolean(message.reacted)}
                    className={
                      message.reacted
                        ? 'message-reaction active'
                        : 'message-reaction'
                    }
                    onClick={() => void toggleReaction(message.id)}
                    type="button"
                  >
                    👍{' '}
                    <span>
                      {message.reactionCount ? message.reactionCount : 'React'}
                    </span>
                  </button>
                </div>
              </article>
            ))}
          </div>
          <form className="message-composer" onSubmit={sendMessage}>
            <Textarea
              aria-label={`Message ${activeChannel}`}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={`Message #${activeChannel.toLowerCase().replace(' ', '-')}`}
              value={draft}
            />
            <div>
              <span>
                <Button
                  aria-label="Attach file"
                  onClick={() =>
                    onNotify(
                      'Choose Film or Play to attach saved team content.',
                      'info',
                    )
                  }
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Paperclip />
                </Button>
                <Button
                  aria-label="Add emoji"
                  onClick={() => setDraft((value) => `${value} 👍`)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Smile />
                </Button>
                <Button
                  onClick={() => {
                    setDraft(
                      (value) => `${value}${value ? ' ' : ''}[Film attachment]`,
                    );
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Film /> Add film
                </Button>
                <Button
                  onClick={() => {
                    setDraft(
                      (value) => `${value}${value ? ' ' : ''}[Play attachment]`,
                    );
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <BookOpen /> Add play
                </Button>
              </span>
              <Button
                aria-label="Send message"
                disabled={!draft.trim()}
                size="icon"
                type="submit"
              >
                <Send />
              </Button>
            </div>
          </form>
        </div>

        {detailsOpen ? (
          <aside className="chat-details">
            <div className="properties-heading">
              <strong>Conversation details</strong>
              <Button
                aria-label="Close details"
                onClick={() => setDetailsOpen(false)}
                size="icon-sm"
                variant="ghost"
              >
                <X />
              </Button>
            </div>
            <div className="channel-summary">
              <span className="channel-icon large">
                <Hash />
              </span>
              <h3>{activeChannel}</h3>
              <p>Messages written here are saved to this local workspace.</p>
            </div>
            <div className="property-divider" />
            <button
              className="detail-row-button"
              onClick={() => onNavigate('Film Room')}
              type="button"
            >
              <Film />
              <span>
                <strong>Shared film</strong>
                <small>No attachments yet</small>
              </span>
              <ChevronRight />
            </button>
            <button
              className="detail-row-button"
              onClick={() => onNavigate('Playbook')}
              type="button"
            >
              <BookOpen />
              <span>
                <strong>Shared plays</strong>
                <small>No attachments yet</small>
              </span>
              <ChevronRight />
            </button>
            <div className="property-divider" />
            <div className="property-title">
              <strong>Members</strong>
              <Button
                onClick={() => setMemberDialogOpen(true)}
                size="xs"
                variant="ghost"
              >
                <UserPlus /> Add
              </Button>
            </div>
            {(memberStore[activeChannel] ?? []).length ? (
              <div className="member-list">
                {memberStore[activeChannel].map((member) => (
                  <div key={member}>
                    <span className="dm-dot">{initialsFor(member)}</span>
                    <strong>{member}</strong>
                    <i />
                  </div>
                ))}
              </div>
            ) : (
              <div className="channel-empty">
                No membership records are attached yet.
              </div>
            )}
          </aside>
        ) : null}
      </div>
      <Dialog
        onOpenChange={setConversationDialogOpen}
        open={conversationDialogOpen}
      >
        <DialogContent className="athlete-dialog sm:max-w-[500px]">
          <form onSubmit={createConversation}>
            <DialogHeader>
              <DialogTitle>Create a conversation</DialogTitle>
              <DialogDescription>
                Choose what you are making and give it a name your staff will
                recognize.
              </DialogDescription>
            </DialogHeader>
            <div className="athlete-form-grid">
              <label htmlFor="conversation-kind">
                Conversation type
                <NativeSelect
                  defaultValue="channel"
                  id="conversation-kind"
                  name="conversationKind"
                >
                  <NativeSelectOption value="channel">
                    Team channel
                  </NativeSelectOption>
                  <NativeSelectOption value="direct">
                    Direct conversation
                  </NativeSelectOption>
                </NativeSelect>
              </label>
              <label htmlFor="conversation-name">
                Name
                <Input
                  id="conversation-name"
                  maxLength={48}
                  name="conversationName"
                  placeholder="Example: Quarterbacks"
                  required
                />
              </label>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setConversationDialogOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button type="submit">
                Create conversation <MessageSquareText />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog onOpenChange={setMemberDialogOpen} open={memberDialogOpen}>
        <DialogContent className="athlete-dialog sm:max-w-[460px]">
          <form onSubmit={addMember}>
            <DialogHeader>
              <DialogTitle>Add a member</DialogTitle>
              <DialogDescription>
                Add a saved local member name to {activeChannel}.
              </DialogDescription>
            </DialogHeader>
            <div className="athlete-form-grid">
              <label className="full" htmlFor="conversation-member-name">
                Member name
                <Input
                  id="conversation-member-name"
                  maxLength={64}
                  name="memberName"
                  placeholder="Full name"
                  required
                />
              </label>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setMemberDialogOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button type="submit">
                Add member <UserPlus />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ReportsView({
  onNavigate,
  onNotify,
}: {
  onNavigate: (view: string) => void;
  onNotify: Notify;
}) {
  const [reportUnit, setReportUnit] = useState('Offence');
  const [reportFilm, setReportFilm] = useState<FilmPayload>({
    assets: [],
    asset: null,
    clips: [],
  });
  useEffect(() => {
    fetch('/api/film', { cache: 'no-store' })
      .then(async (response) => (await response.json()) as FilmPayload)
      .then(setReportFilm)
      .catch(() => setReportFilm({ assets: [], asset: null, clips: [] }));
  }, []);
  const reportClips = reportFilm.clips.filter(
    (clip) => clip.odk === reportUnit,
  );
  const yardsFor = (clip: FilmClipRecord) => {
    const match = clip.result.match(/[+-]?\d+/);
    return match ? Number(match[0]) : null;
  };
  const numericYards = reportClips
    .map(yardsFor)
    .filter((value): value is number => value != null);
  const positive = numericYards.filter((value) => value > 0).length;
  const explosive = numericYards.filter((value) => value >= 20).length;
  const complete = reportClips.filter(
    (clip) =>
      clip.down != null && clip.distance != null && Boolean(clip.result),
  ).length;
  const grouped = reportClips.reduce<Record<string, FilmClipRecord[]>>(
    (groups, clip) => {
      const key = clip.down
        ? `${clip.down}${clip.distance != null ? ` & ${clip.distance}` : ' down'}`
        : 'Down not charted';
      (groups[key] ??= []).push(clip);
      return groups;
    },
    {},
  );
  const reportRows = Object.entries(grouped).map(([situation, clips]) => {
    const calls = clips.map(clipLabel);
    const topCall =
      calls.sort(
        (a, b) =>
          calls.filter((call) => call === b).length -
          calls.filter((call) => call === a).length,
      )[0] ?? '—';
    const yards = clips
      .map(yardsFor)
      .filter((value): value is number => value != null);
    return [
      situation,
      topCall,
      `${Math.round((clips.length / Math.max(1, reportClips.length)) * 100)}%`,
      yards.length
        ? (yards.reduce((sum, value) => sum + value, 0) / yards.length).toFixed(
            1,
          )
        : '—',
      `${clips.length}`,
    ];
  });
  return (
    <section className="module-surface reports-surface">
      <ModuleHeader
        eyebrow="Scouting intelligence"
        title="Reports"
        description="Turn every tagged snap into tendencies your coordinators can trust and act on."
      >
        <Button
          className="module-secondary"
          disabled={!reportRows.length}
          onClick={() => {
            const rows = [
              [
                'Situation',
                'Top saved play',
                'Share of charted clips',
                'Average yards',
                'Clip count',
              ],
              ...reportRows,
            ];
            downloadText(
              `${reportUnit.toLowerCase().replaceAll(' ', '-')}-report.csv`,
              rows.map((row) => row.map(quoteCsv).join(',')).join('\n'),
              'text/csv;charset=utf-8',
            );
            onNotify(`${reportUnit} report exported.`);
          }}
          variant="outline"
        >
          <Download /> Export
        </Button>
        <Button
          className="module-primary"
          onClick={() => onNavigate('Gameplanning')}
        >
          <Zap /> Build gameplan
        </Button>
      </ModuleHeader>
      <div className="planning-toolbar">
        <div className="segmented-control">
          {['Offence', 'Defence', 'Special teams'].map((unit) => (
            <button
              className={reportUnit === unit ? 'active' : ''}
              key={unit}
              onClick={() => setReportUnit(unit)}
              type="button"
            >
              {unit}
            </button>
          ))}
        </div>
        <NativeSelect aria-label="Choose film dataset" defaultValue="current">
          <NativeSelectOption value="current">
            {reportFilm.asset?.title ?? 'No uploaded film'}
          </NativeSelectOption>
        </NativeSelect>
        <Button onClick={() => onNavigate('Film Room')} variant="outline">
          <Film /> Chart film
        </Button>
      </div>
      <div className="report-kpis">
        <article>
          <span className="metric-icon blue">
            <SlidersHorizontal />
          </span>
          <div>
            <small>Charted clips</small>
            <strong>{reportClips.length}</strong>
            <p>{reportFilm.clips.length} across all units</p>
          </div>
        </article>
        <article>
          <span className="metric-icon teal">
            <CheckCircle2 />
          </span>
          <div>
            <small>Data completeness</small>
            <strong>
              {reportClips.length
                ? Math.round((complete / reportClips.length) * 100)
                : 0}
              %
            </strong>
            <p>Down, distance, and result</p>
          </div>
        </article>
        <article>
          <span className="metric-icon violet">
            <Film />
          </span>
          <div>
            <small>Positive results</small>
            <strong>
              {numericYards.length
                ? Math.round((positive / numericYards.length) * 100)
                : 0}
              %
            </strong>
            <p>{numericYards.length} clips with yardage</p>
          </div>
        </article>
        <article>
          <span className="metric-icon orange">
            <Zap />
          </span>
          <div>
            <small>Explosive clips</small>
            <strong>{explosive}</strong>
            <p>20 or more yards</p>
          </div>
        </article>
      </div>
      <div className="reports-layout">
        <div className="reports-main">
          <section className="analytics-card">
            <div className="analytics-head">
              <div>
                <p className="eyebrow">Down and distance</p>
                <h3>Charted tendency matrix</h3>
              </div>
              <Badge variant="secondary">{reportClips.length} clips</Badge>
            </div>
            {reportRows.length ? (
              <div className="tendency-table">
                <div className="tendency-table-head">
                  <span>Situation</span>
                  <span>Top saved play</span>
                  <span>Share</span>
                  <span>Yds/play</span>
                  <span>Clips</span>
                </div>
                {reportRows.map((row) => (
                  <button
                    key={row[0]}
                    onClick={() => onNavigate('Film Room')}
                    type="button"
                  >
                    {row.map((cell, index) => (
                      <span
                        className={index === 2 ? 'rate-cell' : ''}
                        key={`${index}-${cell}`}
                      >
                        {cell}
                      </span>
                    ))}
                  </button>
                ))}
              </div>
            ) : (
              <div className="viewer-empty-state compact">
                <SlidersHorizontal />
                <strong>No {reportUnit.toLowerCase()} clips charted</strong>
                <span>
                  Upload film and save clip data before ChalkTalk calculates
                  tendencies.
                </span>
                <Button onClick={() => onNavigate('Film Room')} size="sm">
                  Open Film Room
                </Button>
              </div>
            )}
          </section>
        </div>
        <aside className="reports-rail">
          <section className="analytics-card insight-rail-card">
            <div className="analytics-head">
              <div>
                <p className="eyebrow">Dataset health</p>
                <h3>What is actually available</h3>
              </div>
              <Film />
            </div>
            <article>
              <span>1</span>
              <div>
                <strong>
                  {reportFilm.asset ? 'Film uploaded' : 'Film missing'}
                </strong>
                <p>
                  {reportFilm.asset?.title ??
                    'Add a real video before charting.'}
                </p>
              </div>
            </article>
            <article>
              <span>2</span>
              <div>
                <strong>
                  {reportClips.length} clips for {reportUnit}
                </strong>
                <p>{complete} have down, distance, and result data.</p>
              </div>
            </article>
            <article>
              <span>3</span>
              <div>
                <strong>
                  {reportClips.filter((clip) => clip.playId).length} linked
                  plays
                </strong>
                <p>
                  Link clips to saved plays for stronger call-sheet context.
                </p>
              </div>
            </article>
            <Button
              className="w-full"
              disabled={!reportClips.length}
              onClick={() => onNavigate('Gameplanning')}
            >
              Use saved data in gameplan <ChevronRight />
            </Button>
          </section>
        </aside>
      </div>
    </section>
  );
}

const initialGameplanObjectives: {
  title: string;
  detail: string;
  target: string;
}[] = [];
const initialGameplanBuckets: { name: string; plays: string[] }[] = [];

function GameplanningView({
  onNavigate,
  onNotify,
}: {
  onNavigate: (view: string) => void;
  onNotify: Notify;
}) {
  const [unit, setUnit] = useState('Offence');
  const [included, setIncluded] = useState<string[]>([]);
  const [briefOpen, setBriefOpen] = useState(false);
  const [objectives, setObjectives] = useState(initialGameplanObjectives);
  const [callBuckets, setCallBuckets] = useState(initialGameplanBuckets);
  const [gameplanPlays, setGameplanPlays] = useState<StudioPlay[]>([]);
  const [gameplanFilm, setGameplanFilm] = useState<FilmClipRecord[]>([]);
  const [objectiveDialogOpen, setObjectiveDialogOpen] = useState(false);
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [installChoices, setInstallChoices] = useState<InstallPackage[]>([]);
  const [targetInstall, setTargetInstall] = useState('');
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [sendingInstall, setSendingInstall] = useState(false);
  const [planLoad, setPlanLoad] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [planRetry, setPlanRetry] = useState(0);
  const [savingPlan, setSavingPlan] = useState(false);
  const planSaveLock = useRef(false);
  const insights = gameplanFilm
    .filter((clip) => clip.note || clip.concept || clip.tags.length)
    .slice(0, 8)
    .map((clip) => ({
      id: clip.id,
      title: clipLabel(clip),
      detail:
        clip.note ||
        [clip.odk, clip.result].filter(Boolean).join(' · ') ||
        'Charted film clip',
      clips: 1,
    }));

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadGameplan(),
      loadPlaybookData(),
      fetch('/api/film', { cache: 'no-store' }).then(async (response) => {
        if (!response.ok) throw new Error('Unable to load film observations.');
        const data = (await response.json()) as FilmPayload;
        if (!Array.isArray(data.clips))
          throw new Error('The film response was incomplete.');
        return data;
      }),
    ])
      .then(([state, playbook, film]) => {
        if (cancelled) return;
        const saved = linkGameplanPlays(state, playbook.plays);
        setUnit(saved.unit);
        setIncluded(saved.included);
        setObjectives(saved.objectives);
        setCallBuckets(saved.callBuckets);
        setGameplanPlays(playbook.plays);
        setGameplanFilm(film.clips);
        setPlanLoad('ready');
      })
      .catch(() => {
        if (!cancelled) setPlanLoad('error');
      });
    return () => {
      cancelled = true;
    };
  }, [planRetry]);

  const saveGameplan = async (changes: {
    unit?: string;
    included?: string[];
    objectives?: typeof objectives;
    callBuckets?: typeof callBuckets;
  }) => {
    if (planSaveLock.current || planLoad !== 'ready') return false;
    planSaveLock.current = true;
    setSavingPlan(true);
    const next = {
      unit: changes.unit ?? unit,
      included: changes.included ?? included,
      objectives: changes.objectives ?? objectives,
      callBuckets: changes.callBuckets ?? callBuckets,
    };
    try {
      await saveWorkspaceState(GAMEPLAN_KEY, next);
      setUnit(next.unit);
      setIncluded(next.included);
      setObjectives(next.objectives);
      setCallBuckets(next.callBuckets);
      return true;
    } catch (error) {
      onNotify(
        error instanceof Error
          ? error.message
          : 'Unable to save the gameplan. Please retry.',
        'error',
      );
      return false;
    } finally {
      planSaveLock.current = false;
      setSavingPlan(false);
    }
  };

  const sendPlanToInstall = async () => {
    if (!targetInstall || sendingInstall) return;
    setSendingInstall(true);
    try {
      if (!(await saveGameplan({}))) return;
      const selectedNames = Array.from(
        new Set(callBuckets.flatMap((bucket) => bucket.plays)),
      );
      const selectedPlays = selectedNames
        .map((reference) => resolveGameplanPlay(reference, gameplanPlays))
        .filter((play): play is StudioPlay => Boolean(play));
      if (selectedPlays.length !== selectedNames.length)
        throw new Error(
          'Some selected plays are unavailable or have ambiguous legacy names. Remove and reselect them before sending.',
        );
      const response = await fetch('/api/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          packageId: targetInstall,
          playIds: selectedPlays.map((play) => play.id),
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || 'Unable to add plays to install.');
      }
      onNotify(
        `${selectedPlays.length} plays added to the selected draft install.`,
      );
      setInstallDialogOpen(false);
      onNavigate('Install');
    } finally {
      setSendingInstall(false);
    }
  };
  const addObjective = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const title = formText(fields, 'objectiveTitle').trim();
    if (!title) return;
    const next = [
      ...objectives,
      {
        title,
        detail: formText(fields, 'objectiveDetail').trim(),
        target: formText(fields, 'objectiveTarget').trim(),
      },
    ];
    if (!(await saveGameplan({ objectives: next }))) return;
    setObjectiveDialogOpen(false);
    onNotify('Objective added.');
  };
  const addCallSheetSection = async (
    event: SyntheticEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const name = formText(
      new FormData(event.currentTarget),
      'sectionName',
    ).trim();
    if (!name) return;
    const next = [...callBuckets, { name, plays: [] }];
    if (!(await saveGameplan({ callBuckets: next }))) return;
    setSectionDialogOpen(false);
  };
  if (planLoad !== 'ready')
    return (
      <section className="module-surface">
        <ModuleHeader
          eyebrow="Coordinator workspace"
          title="Gameplan"
          description="Your saved plan, plays, and film observations."
        />
        {planLoad === 'error' ? (
          <>
            <p role="alert">
              Your gameplan could not be loaded. Your saved plan has not been
              changed.
            </p>
            <Button
              onClick={() => {
                setPlanLoad('loading');
                setPlanRetry((value) => value + 1);
              }}
            >
              Retry gameplan
            </Button>
          </>
        ) : (
          <output>Loading your gameplan…</output>
        )}
      </section>
    );
  return (
    <section
      className="module-surface gameplan-surface"
      inert={savingPlan || sendingInstall}
    >
      <Dialog
        open={installDialogOpen}
        onOpenChange={(open) => {
          if (!sendingInstall) setInstallDialogOpen(open);
        }}
      >
        <DialogContent className="athlete-dialog">
          <DialogHeader>
            <DialogTitle>Add gameplan plays to an install</DialogTitle>
            <DialogDescription>
              Choose a draft package. Existing plays will not be duplicated.
            </DialogDescription>
          </DialogHeader>
          <NativeSelect
            aria-label="Destination install"
            onChange={(event) => setTargetInstall(event.target.value)}
            value={targetInstall}
          >
            <NativeSelectOption value="">Choose an install…</NativeSelectOption>
            {installChoices.map((pack) => (
              <NativeSelectOption key={pack.id} value={pack.id}>
                {pack.name} · {pack.unit}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <DialogFooter>
            <Button
              disabled={sendingInstall}
              onClick={() => onNavigate('Install')}
              variant="outline"
            >
              Manage installs
            </Button>
            <Button
              disabled={!targetInstall || sendingInstall}
              onClick={() =>
                void sendPlanToInstall().catch((error: unknown) =>
                  onNotify(
                    error instanceof Error
                      ? error.message
                      : 'Unable to add plays.',
                    'error',
                  ),
                )
              }
            >
              {sendingInstall ? 'Adding…' : 'Add plays'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ModuleHeader
        eyebrow="Coordinator workspace"
        title="Gameplan"
        description="Bridge scouting evidence to your call sheet, install, and practice script."
      >
        <Button
          className="module-secondary"
          onClick={() => onNavigate('Reports')}
          variant="outline"
        >
          <SlidersHorizontal /> Open reports
        </Button>
        <Button
          className="module-primary"
          disabled={
            savingPlan || !callBuckets.some((bucket) => bucket.plays.length)
          }
          onClick={() => {
            void fetch('/api/install')
              .then(async (response) => {
                if (!response.ok) throw new Error('Unable to load installs.');
                return (await response.json()) as {
                  packages: InstallPackage[];
                };
              })
              .then((data) => {
                setInstallChoices(
                  data.packages.filter((pack) => !pack.publishedAt),
                );
                setTargetInstall('');
                setInstallDialogOpen(true);
              })
              .catch((error: unknown) =>
                onNotify(
                  error instanceof Error
                    ? error.message
                    : 'Unable to load installs.',
                  'error',
                ),
              );
          }}
        >
          <ClipboardList /> Add to install
        </Button>
      </ModuleHeader>
      <div className="workflow-stepper">
        <button
          className={gameplanFilm.length ? 'complete' : ''}
          onClick={() => onNavigate('Film Room')}
          type="button"
        >
          <span>{gameplanFilm.length ? <Check /> : '1'}</span>
          <div>
            <strong>Film charted</strong>
            <small>{gameplanFilm.length} saved clips</small>
          </div>
        </button>
        <i />
        <button
          className={insights.length ? 'complete' : ''}
          onClick={() => onNavigate('Reports')}
          type="button"
        >
          <span>{insights.length ? <Check /> : '2'}</span>
          <div>
            <strong>Reports ready</strong>
            <small>{insights.length} usable observations</small>
          </div>
        </button>
        <i />
        <button
          className="active"
          onClick={() =>
            onNotify('You are editing the active gameplan.', 'info')
          }
          type="button"
        >
          <span>3</span>
          <div>
            <strong>Build gameplan</strong>
            <small>In progress</small>
          </div>
        </button>
        <i />
        <button onClick={() => onNavigate('Install')} type="button">
          <span>4</span>
          <div>
            <strong>Install</strong>
            <small>Publish to team</small>
          </div>
        </button>
      </div>
      <div className="planning-toolbar gameplan-toolbar">
        <div className="segmented-control">
          {['Offence', 'Defence', 'Special teams'].map((item) => (
            <button
              className={unit === item ? 'active' : ''}
              key={item}
              onClick={() => {
                void saveGameplan({ unit: item });
              }}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <span className="autosave-status">
          <CheckCircle2 />{' '}
          {savingPlan ? 'Saving…' : 'Changes save automatically'}
        </span>
        <Button onClick={() => setBriefOpen(true)} variant="outline">
          <Eye /> Preview staff brief
        </Button>
      </div>
      <div className="gameplan-layout">
        <aside className="insight-inbox">
          <div className="analytics-head">
            <div>
              <p className="eyebrow">From reports</p>
              <h3>Insight inbox</h3>
            </div>
            <Badge>{insights.length}</Badge>
          </div>
          <p className="panel-helper">
            Add film observations to your active plan.
          </p>
          {insights.map((item) => (
            <button
              className={included.includes(item.id) ? 'included' : ''}
              key={item.id}
              onClick={() => {
                const next = included.includes(item.id)
                  ? included.filter((id) => id !== item.id)
                  : [...included, item.id];
                void saveGameplan({ included: next });
              }}
              type="button"
            >
              <span className="insight-check">
                {included.includes(item.id) ? <Check /> : <Plus />}
              </span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                <small>
                  <Film /> {item.clips} linked clip
                </small>
              </div>
            </button>
          ))}
          {!insights.length ? (
            <div className="channel-empty">
              No film observations yet. Add notes or tags while charting clips.
            </div>
          ) : null}
        </aside>
        <div className="gameplan-board">
          <section className="gameplan-objectives">
            <div className="analytics-head">
              <div>
                <p className="eyebrow">Identity</p>
                <h3>Objectives</h3>
              </div>
              <Button
                onClick={() => setObjectiveDialogOpen(true)}
                size="sm"
                variant="ghost"
              >
                <Plus /> Add
              </Button>
            </div>
            <div className="objective-grid">
              {objectives.map((objective, index) => (
                <article key={`${objective.title}-${index}`}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{objective.title}</strong>
                    <p>{objective.detail || 'No detail added.'}</p>
                    <small>{objective.target || 'No target added.'}</small>
                  </div>
                  <Button
                    aria-label={`Remove ${objective.title}`}
                    onClick={() => {
                      const next = objectives.filter(
                        (_, itemIndex) => itemIndex !== index,
                      );
                      void saveGameplan({ objectives: next });
                    }}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </article>
              ))}
              {!objectives.length ? (
                <div className="channel-empty">No objectives yet.</div>
              ) : null}
            </div>
          </section>
          <section className="call-sheet-builder">
            <div className="analytics-head">
              <div>
                <p className="eyebrow">Call sheet builder</p>
                <h3>Plan by situation</h3>
              </div>
              <div>
                <span>
                  {callBuckets.reduce(
                    (sum, bucket) => sum + bucket.plays.length,
                    0,
                  )}{' '}
                  saved plays selected
                </span>
                <Button
                  onClick={() => setSectionDialogOpen(true)}
                  size="sm"
                  variant="ghost"
                >
                  <Plus /> Add section
                </Button>
              </div>
            </div>
            <div className="call-buckets">
              {callBuckets.map((bucket, bucketIndex) => (
                <article key={`${bucket.name}-${bucketIndex}`}>
                  <header>
                    <strong>{bucket.name}</strong>
                    <NativeSelect
                      aria-label={`Add saved play to ${bucket.name}`}
                      onChange={(event) => {
                        const play = event.target.value;
                        if (!play || bucket.plays.includes(play)) return;
                        const next = callBuckets.map((item, index) =>
                          index === bucketIndex
                            ? { ...item, plays: [...item.plays, play] }
                            : item,
                        );
                        void saveGameplan({ callBuckets: next });
                        event.target.value = '';
                      }}
                      value=""
                    >
                      <NativeSelectOption value="">
                        Add saved play…
                      </NativeSelectOption>
                      {gameplanPlays
                        .filter(
                          (play) =>
                            (play.unit ?? 'Offence') === unit &&
                            !bucket.plays.includes(play.id),
                        )
                        .map((play) => (
                          <NativeSelectOption key={play.id} value={play.id}>
                            {play.name}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  </header>
                  {bucket.plays.map((play, index) => {
                    const savedPlay = resolveGameplanPlay(play, gameplanPlays);
                    const linked = gameplanFilm.filter(
                      (clip) => clip.playId === savedPlay?.id,
                    ).length;
                    return (
                      <div key={`${play}-${index}`}>
                        <span>
                          <b>
                            {savedPlay?.name ?? `Unavailable play: ${play}`}
                          </b>
                          <small>
                            {index === 0 ? 'Primary' : 'Complement'}
                          </small>
                        </span>
                        <button
                          onClick={() =>
                            onNavigate(linked ? 'Film Room' : 'Playbook')
                          }
                          type="button"
                        >
                          {linked ? (
                            <>
                              <Film /> {linked}
                            </>
                          ) : (
                            <>
                              <BookOpen /> Open
                            </>
                          )}
                        </button>
                        <Button
                          aria-label={`Remove ${savedPlay?.name ?? play}`}
                          onClick={() => {
                            const next = callBuckets.map((item, itemIndex) =>
                              itemIndex === bucketIndex
                                ? {
                                    ...item,
                                    plays: item.plays.filter(
                                      (name) => name !== play,
                                    ),
                                  }
                                : item,
                            );
                            void saveGameplan({ callBuckets: next });
                          }}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <X />
                        </Button>
                      </div>
                    );
                  })}
                </article>
              ))}
              {!callBuckets.length ? (
                <div className="viewer-empty-state compact">
                  <ClipboardList />
                  <strong>No call-sheet sections yet</strong>
                  <span>
                    Add a situation, then choose from plays already saved in
                    Playbook.
                  </span>
                </div>
              ) : null}
            </div>
          </section>
        </div>
        <aside className="gameplan-rail">
          <section className="analytics-card">
            <div className="analytics-head">
              <div>
                <p className="eyebrow">Plan health</p>
                <h3>Ready to install</h3>
              </div>
              <strong className="health-score">
                {Math.min(
                  100,
                  (included.length ? 25 : 0) +
                    (objectives.length ? 25 : 0) +
                    (callBuckets.some((bucket) => bucket.plays.length)
                      ? 50
                      : 0),
                )}
                %
              </strong>
            </div>
            <div className="plan-checks">
              <span className={included.length ? '' : 'pending'}>
                {included.length ? <CheckCircle2 /> : <AlertCircle />}{' '}
                {included.length} film observations linked
              </span>
              <span
                className={
                  callBuckets.some((bucket) => bucket.plays.length)
                    ? ''
                    : 'pending'
                }
              >
                {callBuckets.some((bucket) => bucket.plays.length) ? (
                  <CheckCircle2 />
                ) : (
                  <AlertCircle />
                )}{' '}
                {callBuckets.reduce(
                  (sum, bucket) => sum + bucket.plays.length,
                  0,
                )}{' '}
                saved plays selected
              </span>
              <span className={objectives.length ? '' : 'pending'}>
                {objectives.length ? <CheckCircle2 /> : <AlertCircle />}{' '}
                {objectives.length} objectives defined
              </span>
            </div>
            <Button
              className="w-full"
              onClick={() => onNavigate('Practice Plans')}
              variant="outline"
            >
              Build practice plan
            </Button>
          </section>
        </aside>
      </div>
      <Dialog onOpenChange={setBriefOpen} open={briefOpen}>
        <DialogContent className="athlete-dialog sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>Staff brief</DialogTitle>
            <DialogDescription>
              {unit} · {included.length} report insights ·{' '}
              {callBuckets.reduce(
                (sum, bucket) => sum + bucket.plays.length,
                0,
              )}{' '}
              selected calls
            </DialogDescription>
          </DialogHeader>
          <div className="brief-preview">
            {objectives.map((objective, index) => (
              <div key={objective.title}>
                <Badge>{index + 1}</Badge>
                <span>
                  <strong>{objective.title}</strong>
                  <small>{objective.detail}</small>
                </span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                downloadText(
                  'staff-brief.txt',
                  objectives
                    .map(
                      (item, index) =>
                        `${index + 1}. ${item.title}\n${item.detail}`,
                    )
                    .join('\n\n'),
                );
                onNotify('Staff brief downloaded.');
              }}
            >
              Download brief <Download />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={(open) => {
          if (!savingPlan) setObjectiveDialogOpen(open);
        }}
        open={objectiveDialogOpen}
      >
        <DialogContent className="athlete-dialog sm:max-w-[560px]">
          <form
            inert={savingPlan}
            onSubmit={(event) => void addObjective(event)}
          >
            <DialogHeader>
              <DialogTitle>Add an objective</DialogTitle>
              <DialogDescription>
                Capture the coaching purpose and an optional measurable target.
              </DialogDescription>
            </DialogHeader>
            <div className="athlete-form-grid">
              <label className="full" htmlFor="objective-title">
                Objective
                <Input id="objective-title" name="objectiveTitle" required />
              </label>
              <label className="full" htmlFor="objective-detail">
                Coaching detail
                <Textarea id="objective-detail" name="objectiveDetail" />
              </label>
              <label className="full" htmlFor="objective-target">
                Measurable target
                <Input id="objective-target" name="objectiveTarget" />
              </label>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setObjectiveDialogOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button type="submit">
                {savingPlan ? 'Saving…' : 'Add objective'} <Plus />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={(open) => {
          if (!savingPlan) setSectionDialogOpen(open);
        }}
        open={sectionDialogOpen}
      >
        <DialogContent className="athlete-dialog sm:max-w-[460px]">
          <form
            inert={savingPlan}
            onSubmit={(event) => void addCallSheetSection(event)}
          >
            <DialogHeader>
              <DialogTitle>Add a call-sheet section</DialogTitle>
              <DialogDescription>
                Name the situation using your team’s terminology.
              </DialogDescription>
            </DialogHeader>
            <div className="athlete-form-grid">
              <label className="full" htmlFor="call-sheet-section">
                Section name
                <Input
                  id="call-sheet-section"
                  name="sectionName"
                  placeholder="Example: Backed up"
                  required
                />
              </label>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setSectionDialogOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button type="submit">
                {savingPlan ? 'Saving…' : 'Add section'} <Plus />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calendarWeekDates(offset = 0) {
  const today = new Date();
  const monday = new Date(today);
  monday.setHours(12, 0, 0, 0);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return localDateKey(day);
  });
}

function eventClock(iso: string) {
  return calendarClock(iso);
}

function eventPlacement(
  event: CalendarEventRecord,
  weekDates: string[],
  firstHour = 15,
  hourCount = 6,
) {
  const day = Math.max(0, weekDates.indexOf(calendarDate(event.startsAt)));
  const start = eventClock(event.startsAt);
  const startMinutes = start.hour * 60 + start.minute;
  const durationMinutes = Math.max(
    30,
    Math.round(
      (Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000,
    ),
  );
  return {
    day,
    start: Math.max(0, Math.floor((startMinutes - firstHour * 60) / 60)),
    span: Math.max(
      1,
      Math.min(
        hourCount - Math.floor((startMinutes - firstHour * 60) / 60),
        Math.ceil(durationMinutes / 60),
      ),
    ),
    meta: `${start.label} · ${event.location || 'Location TBD'}`,
    tone: event.eventType,
  };
}

function CalendarView({
  onEditingChange,
  onNavigate,
  onNotify,
  teamSettings,
}: {
  onEditingChange: (editing: boolean) => void;
  onNavigate: (view: string) => void;
  onNotify: Notify;
  teamSettings: TeamSettings;
}) {
  const [calendarView, setCalendarView] = useState('Week');
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventRecord[]>(
    [],
  );
  const [eventOpen, setEventOpen] = useState(false);
  const [eventEditor, setEventEditor] = useState<CalendarEventRecord | null>(
    null,
  );
  const [eventDirty, setEventDirty] = useState(false);
  const [eventLeaveOpen, setEventLeaveOpen] = useState(false);
  const [eventStartDate, setEventStartDate] = useState(
    localDateKey(new Date()),
  );
  const [eventEndDate, setEventEndDate] = useState(localDateKey(new Date()));
  const [selectedEvent, setSelectedEvent] =
    useState<CalendarEventRecord | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [eventSaving, setEventSaving] = useState(false);
  const [calendarEventError, setCalendarEventError] = useState('');
  const calendarWriteLock = useRef(false);
  const [calendarLoad, setCalendarLoad] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [calendarRetry, setCalendarRetry] = useState(0);
  const [calendarMessage, setCalendarMessage] = useState(
    'Loading saved schedule…',
  );
  const [calendarRoster, setCalendarRoster] =
    useState<AthleteMetrics>(fallbackMetrics);
  const [newEventLocation, setNewEventLocation] = useState('');
  useEffect(() => {
    onEditingChange(eventDirty || eventSaving);
    return () => onEditingChange(false);
  }, [eventDirty, eventSaving, onEditingChange]);
  useEffect(() => {
    if (!eventDirty && !eventSaving) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [eventDirty, eventSaving]);
  const weekDates = useMemo(() => calendarWeekDates(weekOffset), [weekOffset]);
  const weekEvents = useMemo(
    () =>
      calendarEvents.filter((event) =>
        weekDates.includes(calendarDate(event.startsAt)),
      ),
    [calendarEvents, weekDates],
  );
  const firstHour = Math.min(
    15,
    ...weekEvents.map((event) => calendarClock(event.startsAt).hour),
  );
  const lastHour = Math.max(
    21,
    ...weekEvents.map((event) =>
      calendarDate(event.startsAt) === calendarDate(event.endsAt)
        ? calendarClock(event.endsAt).hour +
          (calendarClock(event.endsAt).minute ? 1 : 0)
        : 24,
    ),
  );
  const calendarHours = Array.from(
    { length: lastHour - firstHour },
    (_, index) => firstHour + index,
  );
  const monthAnchor = useMemo(() => {
    const value = new Date();
    value.setDate(1);
    value.setMonth(value.getMonth() + monthOffset);
    value.setHours(12, 0, 0, 0);
    return value;
  }, [monthOffset]);
  const monthEvents = useMemo(
    () =>
      calendarEvents.filter((event) => {
        const value = new Date(event.startsAt);
        return (
          value.getFullYear() === monthAnchor.getFullYear() &&
          value.getMonth() === monthAnchor.getMonth()
        );
      }),
    [calendarEvents, monthAnchor],
  );
  const days = weekDates.map((date) => {
    const value = new Date(`${date}T12:00:00`);
    return `${value.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()} ${value.getDate()}`;
  });

  useEffect(() => {
    let active = true;
    fetch('/api/calendar-events', { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as {
          events?: CalendarEventRecord[];
          error?: string;
        };
        if (!response.ok || !Array.isArray(data.events))
          throw new Error(data.error ?? 'Unable to load calendar events.');
        return data.events;
      })
      .then((events) => {
        if (active) {
          setCalendarEvents(events);
          setCalendarMessage(
            'Saved schedule · times shown in this device’s time zone',
          );
          setCalendarLoad('ready');
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setCalendarLoad('error');
          setCalendarMessage(
            error instanceof Error
              ? error.message
              : 'Unable to load saved events.',
          );
        }
      });
    fetch('/api/athletes', { cache: 'no-store' })
      .then(
        async (response) =>
          (await response.json()) as { metrics?: AthleteMetrics },
      )
      .then((data) => {
        if (active && data.metrics) setCalendarRoster(data.metrics);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [calendarRetry]);

  const createCalendarEvent = async (
    event: SyntheticEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (calendarWriteLock.current) return;
    calendarWriteLock.current = true;
    setCalendarEventError('');
    setEventSaving(true);
    setCalendarMessage('Saving event…');
    const fields = new FormData(event.currentTarget);
    const value = (name: string) => {
      const field = fields.get(name);
      return typeof field === 'string' ? field : '';
    };
    const date = value('date');
    try {
      const response = await fetch('/api/calendar-events', {
        method: eventEditor ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(eventEditor ? { id: eventEditor.id } : {}),
          title: value('title'),
          eventType: value('eventType'),
          startsAt: calendarEditInstant(
            eventEditor?.startsAt,
            date,
            value('startTime'),
          ),
          endsAt: calendarEditInstant(
            eventEditor?.endsAt,
            value('endDate'),
            value('endTime'),
          ),
          location: value('location'),
          notes: value('notes'),
        }),
      });
      const data = (await response.json()) as {
        event?: CalendarEventRecord;
        error?: string;
      };
      if (!response.ok || !data.event)
        throw new Error(data.error ?? 'Unable to save the event.');
      setCalendarEvents((events) =>
        [
          ...events.filter((item) => item.id !== data.event!.id),
          data.event!,
        ].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
      );
      setCalendarMessage(`${data.event.title} saved to the shared schedule`);
      setEventOpen(false);
      setEventDirty(false);
      if (eventEditor) setSelectedEvent(data.event);
      setEventEditor(null);
      onNotify(
        `${data.event.title} ${eventEditor ? 'updated' : 'added to the calendar'}.`,
      );
    } catch (error) {
      setCalendarEventError(
        error instanceof Error ? error.message : 'Unable to save the event.',
      );
      setCalendarMessage(
        error instanceof Error ? error.message : 'Unable to save the event.',
      );
    } finally {
      calendarWriteLock.current = false;
      setEventSaving(false);
    }
  };

  const deleteCalendarEvent = async () => {
    if (!selectedEvent || calendarWriteLock.current) return;
    calendarWriteLock.current = true;
    setEventSaving(true);
    try {
      const response = await fetch(
        `/api/calendar-events?id=${encodeURIComponent(selectedEvent.id)}`,
        { method: 'DELETE' },
      );
      const data = (await response.json()) as {
        deleted?: string;
        error?: string;
      };
      if (!response.ok || !data.deleted)
        throw new Error(data.error ?? 'Unable to remove the event.');
      setCalendarEvents((events) =>
        events.filter((event) => event.id !== selectedEvent.id),
      );
      onNotify(`${selectedEvent.title} removed from the calendar.`, 'info');
      setSelectedEvent(null);
      setCalendarMessage(
        'Saved schedule · times shown in this device’s time zone',
      );
    } catch (error) {
      onNotify(
        error instanceof Error ? error.message : 'Unable to remove the event.',
        'error',
      );
    } finally {
      calendarWriteLock.current = false;
      setEventSaving(false);
    }
  };

  const subscribeCalendar = () => {
    downloadText(
      'chalktalk-calendar.ics',
      calendarExport(calendarEvents),
      'text/calendar;charset=utf-8',
    );
    onNotify(
      'Calendar export downloaded. Import it into your calendar app; it does not update automatically.',
    );
  };

  const periodLabel =
    calendarView === 'Month'
      ? monthAnchor.toLocaleDateString(undefined, {
          month: 'long',
          year: 'numeric',
        })
      : `${new Date(`${weekDates[0]}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}–${new Date(`${weekDates[6]}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`;
  const periodEvents = calendarView === 'Month' ? monthEvents : weekEvents;
  const moveCalendar = (direction: number) =>
    calendarView === 'Month'
      ? setMonthOffset((offset) => offset + direction)
      : setWeekOffset((offset) => offset + direction);
  const openNewEvent = () => {
    setEventEditor(null);
    setEventDirty(false);
    setEventStartDate(localDateKey(new Date()));
    setEventEndDate(localDateKey(new Date()));
    setCalendarEventError('');
    setNewEventLocation(
      teamSettings.practiceFacility ||
        teamSettings.homeField ||
        teamSettings.teamRoom ||
        '',
    );
    setEventOpen(true);
  };

  if (calendarLoad !== 'ready')
    return (
      <section className="module-surface calendar-surface">
        <ModuleHeader
          eyebrow="Shared schedule"
          title="Calendar"
          description="Your team’s saved events."
        />
        {calendarLoad === 'error' ? (
          <>
            <p role="alert">{calendarMessage}</p>
            <Button
              onClick={() => {
                setCalendarLoad('loading');
                setCalendarRetry((value) => value + 1);
              }}
            >
              Retry schedule
            </Button>
          </>
        ) : (
          <output>Loading your saved schedule…</output>
        )}
      </section>
    );
  return (
    <section className="module-surface calendar-surface">
      <ModuleHeader
        eyebrow="Team operations"
        title="Calendar"
        description="Keep film, install, practice, travel, and game-day work on one shared schedule."
      >
        <Button
          className="module-secondary"
          onClick={subscribeCalendar}
          variant="outline"
        >
          <Download /> Export calendar
        </Button>
        <Button className="module-primary" onClick={openNewEvent}>
          <Plus /> New event
        </Button>
      </ModuleHeader>
      <div className="local-data-status">
        <span className={eventSaving ? 'sync-dot working' : 'sync-dot'} />
        <strong>{calendarMessage}</strong>
        <small>{calendarEvents.length} events</small>
      </div>
      <div className="planning-toolbar">
        <div className="calendar-nav">
          <Button
            aria-label={`Previous ${calendarView.toLowerCase()}`}
            onClick={() => moveCalendar(-1)}
            size="icon"
            variant="outline"
          >
            <ArrowLeft />
          </Button>
          <div>
            <strong>{periodLabel}</strong>
            <small>
              {periodEvents.length} saved{' '}
              {periodEvents.length === 1 ? 'event' : 'events'}
            </small>
          </div>
          <Button
            aria-label={`Next ${calendarView.toLowerCase()}`}
            onClick={() => moveCalendar(1)}
            size="icon"
            variant="outline"
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="segmented-control">
          {['Week', 'Month', 'Agenda'].map((item) => (
            <button
              className={calendarView === item ? 'active' : ''}
              key={item}
              onClick={() => setCalendarView(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="calendar-layout">
        {calendarView === 'Week' ? (
          <div className="week-calendar">
            <div className="week-head">
              <span>TIME</span>
              {days.map((day, index) => (
                <div
                  className={
                    weekDates[index] === localDateKey(new Date()) ? 'today' : ''
                  }
                  key={day}
                >
                  <small>{day.split(' ')[0]}</small>
                  <strong>{day.split(' ')[1]}</strong>
                </div>
              ))}
            </div>
            <div
              className="week-body"
              style={{
                height: Math.max(610, calendarHours.length * 80),
                gridTemplateRows: `repeat(${calendarHours.length}, 1fr)`,
              }}
            >
              <div
                className="time-labels"
                style={{
                  gridTemplateRows: `repeat(${calendarHours.length}, 1fr)`,
                }}
              >
                {calendarHours.map((hour) => (
                  <span key={hour}>
                    {hour % 12 || 12} {hour < 12 ? 'AM' : 'PM'}
                  </span>
                ))}
              </div>
              <div
                className="calendar-grid-lines"
                style={{
                  gridTemplateRows: `repeat(${calendarHours.length}, 1fr)`,
                }}
              >
                {Array.from(
                  { length: calendarHours.length * 7 },
                  (_, index) => (
                    <i key={index} />
                  ),
                )}
              </div>
              {weekEvents.map((event) => {
                const placement = eventPlacement(
                  event,
                  weekDates,
                  firstHour,
                  calendarHours.length,
                );
                return (
                  <button
                    className={'calendar-event ' + placement.tone}
                    key={event.id}
                    onClick={() => setSelectedEvent(event)}
                    style={{
                      gridColumn: placement.day + 2,
                      gridRow:
                        placement.start + 1 + ' / span ' + placement.span,
                    }}
                    title={event.notes}
                    type="button"
                  >
                    <strong>{event.title}</strong>
                    <small>{placement.meta}</small>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className={`calendar-alternate ${calendarView.toLowerCase()}`}>
            <div className="analytics-head">
              <div>
                <p className="eyebrow">{calendarView} view</p>
                <h3>{periodLabel}</h3>
              </div>
              <Badge>{periodEvents.length} events</Badge>
            </div>
            {periodEvents.length ? (
              periodEvents.map((event) => (
                <button
                  key={event.id}
                  onClick={() => setSelectedEvent(event)}
                  type="button"
                >
                  <span className={`calendar-type-dot ${event.eventType}`} />
                  <span>
                    <strong>{event.title}</strong>
                    <small>
                      {calendarDate(event.startsAt)} ·{' '}
                      {eventClock(event.startsAt).label} ·{' '}
                      {event.location || 'Location TBD'}
                    </small>
                  </span>
                  <ChevronRight />
                </button>
              ))
            ) : (
              <div className="pb-empty">
                <CalendarDays />
                <strong>
                  No saved events in this {calendarView.toLowerCase()}
                </strong>
                <span>Use New event to add one.</span>
              </div>
            )}
          </div>
        )}
        <aside className="calendar-rail">
          <section className="analytics-card">
            <div className="analytics-head">
              <div>
                <p className="eyebrow">This week</p>
                <h3>Upcoming</h3>
              </div>
              <span className="calendar-date">{weekEvents.length}</span>
            </div>
            {weekEvents.length ? (
              <div className="day-agenda">
                {weekEvents.slice(0, 4).map((item) => (
                  <div key={item.id}>
                    <b>{eventClock(item.startsAt).label}</b>
                    <i />
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.location || 'Location TBD'}</small>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pb-empty">
                <CalendarDays />
                <strong>No events scheduled</strong>
                <span>Add the first real team event.</span>
              </div>
            )}
          </section>
          <section className="analytics-card">
            <div className="analytics-head">
              <div>
                <p className="eyebrow">Availability</p>
                <h3>Team status</h3>
              </div>
              <Users />
            </div>
            <div className="availability-metrics">
              <span>
                <strong>{calendarRoster.active}</strong>Available
              </span>
              <span>
                <strong>{calendarRoster.limited}</strong>Limited
              </span>
              <span>
                <strong>{calendarRoster.out}</strong>Out
              </span>
            </div>
            <Button
              className="w-full"
              onClick={() => onNavigate('Athletes')}
              variant="outline"
            >
              View roster availability
            </Button>
          </section>
        </aside>
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (eventSaving) return;
          if (!open && eventDirty) setEventLeaveOpen(true);
          else setEventOpen(open);
        }}
        open={eventOpen}
      >
        <DialogContent className="athlete-dialog sm:max-w-[620px]">
          <form
            key={eventEditor?.id ?? 'new-event'}
            inert={eventSaving}
            onChangeCapture={() => setEventDirty(true)}
            onSubmit={createCalendarEvent}
          >
            {calendarEventError ? (
              <p role="alert">{calendarEventError}</p>
            ) : null}
            <DialogHeader>
              <DialogTitle>
                {eventEditor ? 'Edit calendar event' : 'Add calendar event'}
              </DialogTitle>
              <DialogDescription>
                Times use this device’s time zone (
                {new Intl.DateTimeFormat().resolvedOptions().timeZone}). The
                event is saved to your team schedule.
              </DialogDescription>
            </DialogHeader>
            <div className="athlete-form-grid">
              <label className="full" htmlFor="calendar-event-title">
                <span>
                  Event title{' '}
                  <b className="field-required" aria-hidden="true">
                    *
                  </b>
                </span>
                <Input
                  id="calendar-event-title"
                  name="title"
                  required
                  maxLength={200}
                  defaultValue={eventEditor?.title ?? ''}
                />
              </label>
              <label htmlFor="calendar-event-type">
                Type
                <NativeSelect
                  defaultValue={eventEditor?.eventType ?? 'practice'}
                  id="calendar-event-type"
                  name="eventType"
                >
                  <NativeSelectOption value="practice">
                    Practice
                  </NativeSelectOption>
                  <NativeSelectOption value="film">Film</NativeSelectOption>
                  <NativeSelectOption value="install">
                    Install
                  </NativeSelectOption>
                  <NativeSelectOption value="game">Game</NativeSelectOption>
                  <NativeSelectOption value="staff">Staff</NativeSelectOption>
                  <NativeSelectOption value="meeting">
                    Meeting
                  </NativeSelectOption>
                  <NativeSelectOption value="travel">Travel</NativeSelectOption>
                </NativeSelect>
              </label>
              <label htmlFor="calendar-event-date">
                <span>
                  Date{' '}
                  <b className="field-required" aria-hidden="true">
                    *
                  </b>
                </span>
                <Input
                  value={eventStartDate}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (eventEndDate === eventStartDate) setEventEndDate(next);
                    setEventStartDate(next);
                  }}
                  id="calendar-event-date"
                  name="date"
                  required
                  type="date"
                />
              </label>
              <label htmlFor="calendar-event-start">
                <span>
                  Starts{' '}
                  <b className="field-required" aria-hidden="true">
                    *
                  </b>
                </span>
                <Input
                  defaultValue={
                    eventEditor
                      ? calendarTimeInput(eventEditor.startsAt)
                      : '16:00'
                  }
                  id="calendar-event-start"
                  name="startTime"
                  required
                  type="time"
                />
              </label>
              <label htmlFor="calendar-event-end-date">
                End date
                <Input
                  id="calendar-event-end-date"
                  name="endDate"
                  required
                  type="date"
                  value={eventEndDate}
                  onChange={(event) => setEventEndDate(event.target.value)}
                />
              </label>
              <label htmlFor="calendar-event-end">
                <span>
                  Ends{' '}
                  <b className="field-required" aria-hidden="true">
                    *
                  </b>
                </span>
                <Input
                  defaultValue={
                    eventEditor
                      ? calendarTimeInput(eventEditor.endsAt)
                      : '17:30'
                  }
                  id="calendar-event-end"
                  name="endTime"
                  required
                  type="time"
                />
              </label>
              <label className="full" htmlFor="calendar-event-location">
                Location
                <div className="saved-location-row">
                  <Input
                    id="calendar-event-location"
                    name="location"
                    onChange={(event) =>
                      setNewEventLocation(event.target.value)
                    }
                    placeholder="Choose a saved location or type one"
                    maxLength={500}
                    value={newEventLocation}
                  />
                  <NativeSelect
                    aria-label="Use a saved location"
                    onChange={(event) => {
                      if (event.target.value)
                        setNewEventLocation(event.target.value);
                    }}
                    value=""
                  >
                    <NativeSelectOption value="">
                      Saved locations…
                    </NativeSelectOption>
                    {[
                      teamSettings.practiceFacility,
                      teamSettings.homeField,
                      teamSettings.teamRoom,
                    ]
                      .filter(Boolean)
                      .map((location) => (
                        <NativeSelectOption key={location} value={location}>
                          {location}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </div>
              </label>
              <label className="full" htmlFor="calendar-event-notes">
                Notes
                <Textarea
                  id="calendar-event-notes"
                  name="notes"
                  defaultValue={eventEditor?.notes ?? ''}
                  maxLength={10000}
                  placeholder="Equipment, objectives, or arrival details…"
                />
              </label>
            </div>
            <DialogFooter>
              <Button disabled={eventSaving} type="submit">
                {eventSaving
                  ? 'Saving…'
                  : eventEditor
                    ? 'Save event'
                    : 'Add to calendar'}{' '}
                <CalendarDays />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={eventLeaveOpen} onOpenChange={setEventLeaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard event changes?</DialogTitle>
            <DialogDescription>
              Your saved schedule will stay as it was.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEventLeaveOpen(false)}>
              Keep editing
            </Button>
            <Button
              onClick={() => {
                setEventLeaveOpen(false);
                setEventOpen(false);
                setEventDirty(false);
                setEventEditor(null);
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={(open) => {
          if (!open && !eventSaving) setSelectedEvent(null);
        }}
        open={Boolean(selectedEvent)}
      >
        <DialogContent className="athlete-dialog sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{selectedEvent?.title}</DialogTitle>
            <DialogDescription>
              {selectedEvent
                ? `${calendarDate(selectedEvent.startsAt)} · ${eventClock(selectedEvent.startsAt).label} – ${calendarDate(selectedEvent.endsAt)} · ${eventClock(selectedEvent.endsAt).label} · ${selectedEvent.location}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="event-detail-copy">
            <Badge>{selectedEvent?.eventType}</Badge>
            <p>{selectedEvent?.notes || 'No additional notes.'}</p>
          </div>
          <DialogFooter>
            <Button
              disabled={eventSaving}
              onClick={() => {
                if (!selectedEvent) return;
                setEventEditor(selectedEvent);
                setNewEventLocation(selectedEvent.location);
                setEventStartDate(calendarDate(selectedEvent.startsAt));
                setEventEndDate(calendarDate(selectedEvent.endsAt));
                setCalendarEventError('');
                setEventDirty(false);
                setSelectedEvent(null);
                setEventOpen(true);
              }}
            >
              <Pencil /> Edit event
            </Button>
            <Button
              disabled={eventSaving}
              onClick={() => void deleteCalendarEvent()}
              variant="ghost"
            >
              <Trash2 /> Remove
            </Button>
            <Button
              disabled={eventSaving}
              onClick={() => setSelectedEvent(null)}
              variant="outline"
            >
              Close
            </Button>
            <Button
              onClick={() => {
                if (selectedEvent) {
                  downloadText(
                    `${selectedEvent.id}.txt`,
                    `${selectedEvent.title}\n${selectedEvent.startsAt} – ${selectedEvent.endsAt}\n${selectedEvent.location}\n\n${selectedEvent.notes}`,
                  );
                  onNotify('Event details downloaded.');
                }
              }}
            >
              Download <Download />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

type PracticePlanRecord = {
  id: string;
  gameId: string | null;
  title: string;
  practiceDate: string;
  durationMinutes: number;
  blocks: string[][];
  generated: boolean;
};
const initialPracticeBlocks: string[][] = [];

function PracticePlansView({
  onNavigate,
  onNotify,
}: {
  onNavigate: (view: string) => void;
  onNotify: Notify;
}) {
  const [generated, setGenerated] = useState(false);
  const [practiceBlocks, setPracticeBlocks] = useState<string[][]>(
    initialPracticeBlocks,
  );
  const [playerView, setPlayerView] = useState(false);
  const [practicePlans, setPracticePlans] = useState<PracticePlanRecord[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [newSegmentOpen, setNewSegmentOpen] = useState(false);
  const [practiceLoad, setPracticeLoad] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [practiceRetry, setPracticeRetry] = useState(0);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [replacePracticeOpen, setReplacePracticeOpen] = useState(false);
  const practiceLock = useRef(false);
  const mutatePractice = async (action: () => Promise<void>) => {
    if (practiceLock.current || practiceLoad !== 'ready') return;
    practiceLock.current = true;
    setPracticeBusy(true);
    try {
      await action();
    } finally {
      practiceLock.current = false;
      setPracticeBusy(false);
    }
  };
  const selectedPlan =
    practicePlans.find((plan) => plan.id === selectedPlanId) ?? null;
  const durationMinutes = practiceBlocks.reduce(
    (total, block) => total + (Number.parseInt(block[1], 10) || 0),
    0,
  );

  useEffect(() => {
    let cancelled = false;
    fetch('/api/practice-plans', { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as {
          plans?: PracticePlanRecord[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.error ?? 'Unable to load practice plans.');
        if (!Array.isArray(data.plans))
          throw new Error('The practice response was incomplete.');
        if (cancelled) return;
        const plans = data.plans;
        setPracticePlans(plans);
        const plan = plans[0];
        setSelectedPlanId(plan?.id ?? '');
        setGenerated(plan?.generated ?? false);
        setPracticeBlocks(plan?.blocks ?? []);
        setPracticeLoad('ready');
      })
      .catch(() => {
        if (!cancelled) setPracticeLoad('error');
      });
    return () => {
      cancelled = true;
    };
  }, [practiceRetry]);

  const savePractice = async (
    blocks = practiceBlocks,
    isGenerated = generated,
  ) => {
    const response = await fetch('/api/practice-plans', {
      method: selectedPlan ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        selectedPlan
          ? {
              id: selectedPlan.id,
              title: selectedPlan.title,
              practiceDate: selectedPlan.practiceDate,
              blocks,
              generated: isGenerated,
            }
          : {
              title: 'Practice plan',
              practiceDate: localDateKey(new Date()),
              blocks,
              generated: isGenerated,
            },
      ),
    });
    const data = (await response.json()) as {
      plans?: PracticePlanRecord[];
      savedPlanId?: string;
      error?: string;
    };
    if (!response.ok)
      throw new Error(data.error ?? 'Unable to save the practice plan.');
    const plans = data.plans;
    const saved = plans?.find((plan) => plan.id === data.savedPlanId);
    if (!saved || (selectedPlan && saved.id !== selectedPlan.id))
      throw new Error(
        'The saved practice plan could not be confirmed. Reload before retrying.',
      );
    setPracticePlans(plans!);
    setSelectedPlanId(saved.id);
    setPracticeBlocks(saved.blocks);
    setGenerated(saved.generated);
  };

  const createPractice = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const title = formText(fields, 'practiceTitle').trim();
    const practiceDate = formText(fields, 'practiceDate').trim();
    if (!title || !practiceDate) return;
    const response = await fetch('/api/practice-plans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title,
        practiceDate,
        blocks: [],
        generated: false,
      }),
    });
    const data = (await response.json()) as {
      plans?: PracticePlanRecord[];
      savedPlanId?: string;
      error?: string;
    };
    if (!response.ok)
      throw new Error(data.error ?? 'Unable to create the practice plan.');
    const plan = data.plans?.find((item) => item.id === data.savedPlanId);
    if (!plan)
      throw new Error(
        'The new practice plan could not be confirmed. Reload before retrying.',
      );
    setPracticePlans(data.plans!);
    setSelectedPlanId(plan.id);
    setPracticeBlocks(plan.blocks);
    setGenerated(false);
    setNewPlanOpen(false);
    onNotify(`${title} created.`);
  };

  const generatePractice = async () => {
    const gameplan = await loadGameplan();
    const generatedBlocks = [
      ...gameplan.objectives.map((objective) => [
        'TBD',
        '10 min',
        objective.title,
        objective.detail,
        'team',
      ]),
      ...gameplan.callBuckets
        .filter((bucket) => bucket.plays.length)
        .map((bucket) => [
          'TBD',
          '15 min',
          bucket.name,
          `${bucket.plays.length} saved plays`,
          gameplan.unit === 'Special teams'
            ? 'teams'
            : gameplan.unit.toLowerCase(),
        ]),
    ];
    if (!generatedBlocks.length) {
      onNotify(
        'Add gameplan objectives or saved plays before generating practice.',
        'info',
      );
      return;
    }
    await savePractice(generatedBlocks, true);
    onNotify('Practice plan generated from saved gameplan items.');
  };
  const addPracticeSegment = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const title = formText(fields, 'segmentTitle').trim();
    if (!title) return;
    const start = formText(fields, 'segmentStart').trim() || 'TBD';
    const minutes = Math.max(
      1,
      Number.parseInt(formText(fields, 'segmentMinutes', '10'), 10) || 10,
    );
    const focus = formText(fields, 'segmentFocus').trim();
    const group =
      formText(fields, 'segmentGroup', 'team').trim().toLowerCase() || 'team';
    const next = [
      ...practiceBlocks,
      [start, `${minutes} min`, title, focus, group],
    ];
    await savePractice(next);
    onNotify('Practice segment added.');
    setNewSegmentOpen(false);
  };
  const deletePractice = async () => {
    if (!selectedPlan) return;
    const response = await fetch(
      `/api/practice-plans?id=${encodeURIComponent(selectedPlan.id)}`,
      { method: 'DELETE' },
    );
    const data = (await response.json()) as {
      plans?: PracticePlanRecord[];
      error?: string;
    };
    if (!response.ok)
      throw new Error(data.error ?? 'Unable to delete the practice plan.');
    const plans = data.plans ?? [];
    const next = plans[0];
    setPracticePlans(plans);
    setSelectedPlanId(next?.id ?? '');
    setPracticeBlocks(next?.blocks ?? []);
    setGenerated(next?.generated ?? false);
    onNotify(`${selectedPlan.title} deleted.`);
  };
  if (practiceLoad !== 'ready')
    return (
      <section className="module-surface">
        <ModuleHeader
          eyebrow="Team preparation"
          title="Practice Plans"
          description="Your saved practice plans."
        />
        {practiceLoad === 'error' ? (
          <>
            <p role="alert">
              Your practice plans could not be loaded. Your saved plans have not
              been changed.
            </p>
            <Button
              onClick={() => {
                setPracticeLoad('loading');
                setPracticeRetry((value) => value + 1);
              }}
            >
              Retry practice plans
            </Button>
          </>
        ) : (
          <output>Loading your practice plans…</output>
        )}
      </section>
    );
  return (
    <section
      className={`module-surface practice-surface ${playerView ? 'player-preview' : ''}`}
      inert={practiceBusy}
    >
      <ModuleHeader
        eyebrow="Team preparation"
        title={selectedPlan?.title ?? 'Practice Plans'}
        description="Build a real minute-by-minute plan or generate segments from the gameplan you saved."
      >
        <Button
          className="module-secondary"
          onClick={() => onNavigate('Gameplanning')}
          variant="outline"
        >
          <Zap /> View gameplan
        </Button>
        <Button onClick={() => setNewPlanOpen(true)} variant="outline">
          <Plus /> New plan
        </Button>
        <Button
          className="module-primary"
          onClick={() => {
            if (practiceBlocks.length) {
              setReplacePracticeOpen(true);
              return;
            }
            void mutatePractice(generatePractice).catch((error: unknown) =>
              onNotify(
                error instanceof Error
                  ? error.message
                  : 'Unable to generate practice.',
                'error',
              ),
            );
          }}
        >
          <Sparkles /> {generated ? 'Refresh from plan' : 'Generate from plan'}
        </Button>
      </ModuleHeader>
      <div className="planning-toolbar">
        <NativeSelect
          aria-label="Choose practice plan"
          onChange={(event) => {
            const plan = practicePlans.find(
              (item) => item.id === event.target.value,
            );
            setSelectedPlanId(event.target.value);
            setPracticeBlocks(plan?.blocks ?? []);
            setGenerated(plan?.generated ?? false);
          }}
          value={selectedPlanId}
        >
          <NativeSelectOption value="">No saved plan</NativeSelectOption>
          {practicePlans.map((plan) => (
            <NativeSelectOption key={plan.id} value={plan.id}>
              {plan.practiceDate} · {plan.title}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button
          disabled={!selectedPlan}
          onClick={() =>
            void mutatePractice(deletePractice).catch((error: unknown) =>
              onNotify(
                error instanceof Error
                  ? error.message
                  : 'Unable to delete the plan.',
                'error',
              ),
            )
          }
          variant="ghost"
        >
          <Trash2 /> Delete plan
        </Button>
      </div>
      <div className="practice-overview">
        <div>
          <p className="eyebrow">
            {selectedPlan?.practiceDate ?? 'No date selected'}
          </p>
          <h2>{durationMinutes} minutes planned</h2>
          <span>
            {practiceBlocks.length} saved{' '}
            {practiceBlocks.length === 1 ? 'segment' : 'segments'}
          </span>
        </div>
        <div className="practice-load">
          <span>
            <b>
              {practiceBlocks.filter((block) => block[4] === 'offence').length}
            </b>
            Offence
          </span>
          <span>
            <b>
              {practiceBlocks.filter((block) => block[4] === 'defence').length}
            </b>
            Defence
          </span>
          <span>
            <b>
              {practiceBlocks.filter((block) => block[4] === 'teams').length}
            </b>
            Teams
          </span>
          <span>
            <b>
              {
                practiceBlocks.filter(
                  (block) =>
                    !['offence', 'defence', 'teams'].includes(block[4]),
                ).length
              }
            </b>
            Team / prep
          </span>
        </div>
        <Button
          disabled={!practiceBlocks.length}
          onClick={() => {
            setPlayerView((value) => !value);
            onNotify(
              playerView
                ? 'Coach practice view restored.'
                : 'Player practice view enabled.',
              'info',
            );
          }}
          variant="outline"
        >
          <Eye /> {playerView ? 'Coach view' : 'Player view'}
        </Button>
      </div>
      <div className="practice-layout">
        <div className="practice-builder">
          <div className="practice-builder-head">
            <div>
              <strong>Practice timeline</strong>
              <span>
                {selectedPlan ? 'Saved plan' : 'Create a plan to begin'} ·{' '}
                {practiceBlocks.length} segments
              </span>
            </div>
            <Button
              disabled={!selectedPlan}
              onClick={() => setNewSegmentOpen(true)}
              size="sm"
              variant="outline"
            >
              <Plus /> Add segment
            </Button>
          </div>
          <div className="practice-timeline">
            {practiceBlocks.map((block, index) => (
              <article
                className={'practice-block ' + block[4]}
                key={`${block[2]}-${index}`}
              >
                <div className="practice-time">
                  <strong>{block[0]}</strong>
                  <small>{block[1]}</small>
                </div>
                <span className="block-tone" />
                <div className="practice-copy">
                  <strong>{block[2]}</strong>
                  <p>{block[3] || 'No coaching focus added.'}</p>
                </div>
                <div className="practice-links">
                  <span>
                    <Users /> {block[4] || 'Team'}
                  </span>
                </div>
                <Button
                  aria-label={'Remove ' + block[2]}
                  onClick={() => {
                    const next = practiceBlocks.filter(
                      (_, itemIndex) => itemIndex !== index,
                    );
                    void mutatePractice(async () => {
                      await savePractice(next);
                      onNotify(`${block[2]} removed from practice.`);
                    }).catch((error: unknown) =>
                      onNotify(
                        error instanceof Error
                          ? error.message
                          : 'Unable to remove the segment.',
                        'error',
                      ),
                    );
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              </article>
            ))}
            {!practiceBlocks.length ? (
              <div className="viewer-empty-state compact">
                <ClipboardList />
                <strong>No practice segments yet</strong>
                <span>
                  Add a segment manually or generate one from saved gameplan
                  items.
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <aside className="practice-rail">
          <section className="analytics-card">
            <div className="analytics-head">
              <div>
                <p className="eyebrow">Plan summary</p>
                <h3>{selectedPlan?.title ?? 'No plan selected'}</h3>
              </div>
              <strong className="health-score">{durationMinutes}</strong>
            </div>
            <div className="plan-checks">
              <span className={practiceBlocks.length ? '' : 'pending'}>
                {practiceBlocks.length ? <CheckCircle2 /> : <AlertCircle />}{' '}
                {practiceBlocks.length} timeline segments
              </span>
              <span className={generated ? '' : 'pending'}>
                {generated ? <CheckCircle2 /> : <AlertCircle />}{' '}
                {generated ? 'Generated from saved gameplan' : 'Manual plan'}
              </span>
              <span className={durationMinutes ? '' : 'pending'}>
                {durationMinutes ? <CheckCircle2 /> : <AlertCircle />}{' '}
                {durationMinutes} total minutes
              </span>
            </div>
            <Button
              className="w-full"
              onClick={() => onNavigate('Install')}
              variant="outline"
            >
              Review install load
            </Button>
          </section>
          <section
            className={
              generated ? 'generation-note visible' : 'generation-note'
            }
          >
            <Sparkles />
            <div>
              <strong>Generated from real plan data</strong>
              <p>Only saved objectives and call-sheet sections were used.</p>
            </div>
          </section>
        </aside>
      </div>
      <Dialog
        open={replacePracticeOpen}
        onOpenChange={(open) => {
          if (!practiceBusy) setReplacePracticeOpen(open);
        }}
      >
        <DialogContent className="athlete-dialog">
          <DialogHeader>
            <DialogTitle>Replace the existing practice segments?</DialogTitle>
            <DialogDescription>
              This will replace all {practiceBlocks.length} segments in{' '}
              {selectedPlan?.title ?? 'this plan'}, including manually added
              segments, with the current saved gameplan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={practiceBusy}
              variant="outline"
              onClick={() => setReplacePracticeOpen(false)}
            >
              Keep current segments
            </Button>
            <Button
              disabled={practiceBusy}
              onClick={() =>
                void mutatePractice(async () => {
                  await generatePractice();
                  setReplacePracticeOpen(false);
                }).catch((error: unknown) =>
                  onNotify(
                    error instanceof Error
                      ? error.message
                      : 'Unable to generate practice.',
                    'error',
                  ),
                )
              }
            >
              {practiceBusy ? 'Saving…' : 'Replace segments'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={(open) => {
          if (!practiceBusy) setNewPlanOpen(open);
        }}
        open={newPlanOpen}
      >
        <DialogContent className="athlete-dialog sm:max-w-[500px]">
          <form
            inert={practiceBusy}
            onSubmit={(event) => {
              event.preventDefault();
              void mutatePractice(() => createPractice(event)).catch(
                (error: unknown) =>
                  onNotify(
                    error instanceof Error
                      ? error.message
                      : 'Unable to create a plan.',
                    'error',
                  ),
              );
            }}
          >
            <DialogHeader>
              <DialogTitle>New practice plan</DialogTitle>
              <DialogDescription>
                Name the plan and choose its real practice date.
              </DialogDescription>
            </DialogHeader>
            <div className="athlete-form-grid">
              <label htmlFor="practice-plan-title">
                Plan name
                <Input
                  id="practice-plan-title"
                  name="practiceTitle"
                  placeholder="Example: Tuesday team practice"
                  required
                />
              </label>
              <label htmlFor="practice-plan-date">
                Practice date
                <Input
                  defaultValue={localDateKey(new Date())}
                  id="practice-plan-date"
                  name="practiceDate"
                  required
                  type="date"
                />
              </label>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setNewPlanOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button type="submit">
                {practiceBusy ? 'Saving…' : 'Create plan'} <Plus />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={(open) => {
          if (!practiceBusy) setNewSegmentOpen(open);
        }}
        open={newSegmentOpen}
      >
        <DialogContent className="athlete-dialog sm:max-w-[560px]">
          <form
            inert={practiceBusy}
            onSubmit={(event) => {
              event.preventDefault();
              void mutatePractice(() => addPracticeSegment(event)).catch(
                (error: unknown) =>
                  onNotify(
                    error instanceof Error
                      ? error.message
                      : 'Unable to add a segment.',
                    'error',
                  ),
              );
            }}
          >
            <DialogHeader>
              <DialogTitle>Add practice segment</DialogTitle>
              <DialogDescription>
                Add a real block to {selectedPlan?.title ?? 'this plan'}.
              </DialogDescription>
            </DialogHeader>
            <div className="athlete-form-grid">
              <label htmlFor="practice-segment-title">
                Segment name
                <Input
                  id="practice-segment-title"
                  name="segmentTitle"
                  required
                />
              </label>
              <label htmlFor="practice-segment-start">
                Start time
                <Input
                  id="practice-segment-start"
                  name="segmentStart"
                  type="time"
                />
              </label>
              <label htmlFor="practice-segment-minutes">
                Minutes
                <Input
                  defaultValue="10"
                  id="practice-segment-minutes"
                  min="1"
                  name="segmentMinutes"
                  type="number"
                />
              </label>
              <label htmlFor="practice-segment-group">
                Group
                <NativeSelect
                  defaultValue="team"
                  id="practice-segment-group"
                  name="segmentGroup"
                >
                  <NativeSelectOption value="team">Team</NativeSelectOption>
                  <NativeSelectOption value="offence">
                    Offence
                  </NativeSelectOption>
                  <NativeSelectOption value="defence">
                    Defence
                  </NativeSelectOption>
                  <NativeSelectOption value="teams">
                    Special teams
                  </NativeSelectOption>
                </NativeSelect>
              </label>
              <label className="full" htmlFor="practice-segment-focus">
                Coaching focus
                <Textarea id="practice-segment-focus" name="segmentFocus" />
              </label>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setNewSegmentOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button type="submit">
                {practiceBusy ? 'Saving…' : 'Add segment'} <Plus />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SettingsView({
  assetRevision,
  onAssetsChanged,
  onNavigate,
  onNotify,
  teamSettings,
  onTeamSettingsChange,
}: {
  assetRevision: number;
  onAssetsChanged: () => void;
  onNavigate: (view: string) => void;
  onNotify: Notify;
  teamSettings: TeamSettings;
  onTeamSettingsChange: (settings: TeamSettings) => void;
}) {
  const session = useWorkspaceSession();
  const prototype = session.mode === 'prototype';
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('Team profile');

  const saveSettings = async () => {
    try {
      await saveWorkspaceState('team-settings', teamSettings);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
      onNotify(`${activeTab} saved.`);
      return true;
    } catch {
      onNotify('Workspace settings could not be saved.', 'error');
      return false;
    }
  };
  const updateSettings = (changes: Partial<TeamSettings>) => {
    const next = { ...teamSettings, ...changes };
    onTeamSettingsChange(next);
    setSaved(false);
  };
  const tabs = [
    'Team profile',
    'Season & schedule',
    'Staff & permissions',
    'Notifications',
    'Data & privacy',
  ];
  return (
    <section className="module-surface settings-surface">
      <ModuleHeader
        eyebrow="Workspace"
        title="Settings"
        description="Manage your team profile, season, account, and saved data."
      />
      <div className="settings-layout">
        <aside className="settings-nav">
          {tabs.map((item, index) => (
            <button
              className={activeTab === item ? 'active' : ''}
              key={item}
              onClick={() => setActiveTab(item)}
              type="button"
            >
              {index === 0 ? (
                <Shield />
              ) : index === 1 ? (
                <CalendarDays />
              ) : index === 2 ? (
                <Users />
              ) : index === 3 ? (
                <Bell />
              ) : (
                <CloudOff />
              )}
              {item}
              <ChevronRight />
            </button>
          ))}
        </aside>
        {activeTab === 'Team profile' ? (
          <div className="settings-card">
            <div className="settings-section-head">
              <div>
                <h2>Team profile</h2>
                <p>This information appears throughout ChalkTalk.</p>
              </div>
              <MediaAvatar
                assetKey="team-logo"
                className="large-crest home-crest"
                fallback={initialsFor(teamSettings.teamName)}
                label={`${teamSettings.teamName || 'Team'} logo`}
                revision={assetRevision}
              />
            </div>
            <div className="asset-manager-grid">
              {[
                {
                  key: 'team-logo',
                  label: 'Team logo',
                  fallback: initialsFor(teamSettings.teamName),
                  className: 'large-crest home-crest',
                },
                {
                  key: 'opponent-logo',
                  label: 'Opponent logo',
                  fallback: 'OP',
                  className: 'large-crest away-crest',
                },
                {
                  key: 'coach-profile',
                  label: 'Coach photo',
                  fallback: initialsFor(session.user.name),
                  className: 'detail-avatar',
                },
                {
                  key: 'player-profile',
                  label: 'Player photo',
                  fallback: 'PL',
                  className: 'detail-avatar',
                },
              ].map((asset) => (
                <article key={asset.key}>
                  <MediaAvatar
                    assetKey={asset.key}
                    className={asset.className}
                    fallback={asset.fallback}
                    label={asset.label}
                    revision={assetRevision}
                  />
                  <div>
                    <strong>{asset.label}</strong>
                    <span>Uploaded file or initials fallback</span>
                    <div>
                      <MediaUploadControl
                        assetKey={asset.key}
                        label="Choose image"
                        onNotify={onNotify}
                        onUploaded={onAssetsChanged}
                      />
                      <Button
                        onClick={async () => {
                          try {
                            await deleteMedia(asset.key);
                            onAssetsChanged();
                            onNotify(`${asset.label} removed.`, 'info');
                          } catch {
                            onNotify(
                              `${asset.label} could not be removed.`,
                              'error',
                            );
                          }
                        }}
                        size="xs"
                        variant="ghost"
                      >
                        <Trash2 /> Remove
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="settings-form">
              <label htmlFor="team-name">
                Team name
                <Input
                  id="team-name"
                  onChange={(event) =>
                    updateSettings({ teamName: event.target.value })
                  }
                  value={teamSettings.teamName}
                />
              </label>
              <label htmlFor="program-level">
                Program level
                <NativeSelect
                  className="w-full"
                  id="program-level"
                  onChange={(event) =>
                    updateSettings({ level: event.target.value })
                  }
                  value={teamSettings.level}
                >
                  <NativeSelectOption value="varsity">
                    Varsity
                  </NativeSelectOption>
                  <NativeSelectOption value="junior">
                    Junior varsity
                  </NativeSelectOption>
                  <NativeSelectOption value="club">Club</NativeSelectOption>
                </NativeSelect>
              </label>
              <label htmlFor="team-city">
                City
                <Input
                  id="team-city"
                  onChange={(event) =>
                    updateSettings({ city: event.target.value })
                  }
                  value={teamSettings.city}
                />
              </label>
              <label htmlFor="team-province">
                Province
                <NativeSelect
                  className="w-full"
                  id="team-province"
                  onChange={(event) =>
                    updateSettings({ province: event.target.value })
                  }
                  value={teamSettings.province}
                >
                  <NativeSelectOption value="ns">
                    Nova Scotia
                  </NativeSelectOption>
                  <NativeSelectOption value="nb">
                    New Brunswick
                  </NativeSelectOption>
                  <NativeSelectOption value="on">Ontario</NativeSelectOption>
                </NativeSelect>
              </label>
            </div>
            <div className="property-divider" />
            <div className="settings-section-head compact">
              <div>
                <h2>Team colours</h2>
                <p>Used for crests, charts, and sideline labels.</p>
              </div>
            </div>
            <div className="colour-row">
              {['navy', 'red', 'gold', 'green', 'teal'].map((colour) => (
                <button
                  aria-label={`Use ${colour} team colour`}
                  aria-pressed={teamSettings.colour === colour}
                  className={`colour-chip ${colour} ${teamSettings.colour === colour ? 'active' : ''}`}
                  key={colour}
                  onClick={() => updateSettings({ colour })}
                  type="button"
                >
                  {teamSettings.colour === colour ? <Check /> : null}
                </button>
              ))}
            </div>
            <div className="property-divider" />
            <div className="local-data-note">
              <CloudOff />
              <div>
                <strong>
                  {prototype ? 'Local prototype' : 'Private cloud workspace'}
                </strong>
                <p>
                  {prototype
                    ? 'This development workspace is stored on this computer, separate from your private pilot.'
                    : 'Your team’s records and uploaded files are stored securely online and available when you sign in on another device.'}
                </p>
              </div>
              <Button onClick={() => onNavigate('Home')} variant="outline">
                Back home
              </Button>
            </div>
            <div className="settings-section-save">
              <span>
                Save team identity, media choices, and colours together.
              </span>
              <Button onClick={() => void saveSettings()}>
                {saved ? <Check /> : null}
                {saved ? 'Team profile saved' : 'Save team profile'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="settings-card settings-secondary-card">
            <div className="settings-section-head">
              <div>
                <h2>{activeTab}</h2>
                <p>
                  {activeTab === 'Season & schedule'
                    ? 'Set the active season used across schedules and game-week tools.'
                    : activeTab === 'Staff & permissions'
                      ? 'Review who can access this private workspace.'
                      : activeTab === 'Notifications'
                        ? 'Review how team updates are delivered.'
                        : 'Review storage and export your team settings.'}
                </p>
              </div>
              {activeTab === 'Season & schedule' ? (
                <CalendarDays />
              ) : activeTab === 'Staff & permissions' ? (
                <Users />
              ) : activeTab === 'Notifications' ? (
                <Bell />
              ) : (
                <CloudOff />
              )}
            </div>
            {activeTab === 'Season & schedule' ? (
              <div className="settings-form">
                <label htmlFor="season-year">
                  Active season
                  <Input
                    id="season-year"
                    onChange={(event) =>
                      updateSettings({ season: event.target.value })
                    }
                    value={teamSettings.season}
                  />
                </label>
                <label htmlFor="practice-facility">
                  Practice facility
                  <Input
                    id="practice-facility"
                    onChange={(event) =>
                      updateSettings({ practiceFacility: event.target.value })
                    }
                    placeholder="Practice field or facility"
                    value={teamSettings.practiceFacility}
                  />
                </label>
                <label htmlFor="home-field">
                  Home field
                  <Input
                    id="home-field"
                    onChange={(event) =>
                      updateSettings({ homeField: event.target.value })
                    }
                    placeholder="Home game venue"
                    value={teamSettings.homeField}
                  />
                </label>
                <label htmlFor="team-room">
                  Team room
                  <Input
                    id="team-room"
                    onChange={(event) =>
                      updateSettings({ teamRoom: event.target.value })
                    }
                    placeholder="Meeting or film room"
                    value={teamSettings.teamRoom}
                  />
                </label>
                <Button
                  onClick={() =>
                    void saveSettings().then((didSave) => {
                      if (didSave) onNavigate('Calendar');
                    })
                  }
                  variant="outline"
                >
                  <CalendarDays /> Save &amp; open calendar
                </Button>
              </div>
            ) : null}
            {activeTab === 'Staff & permissions' ? (
              <div className="settings-owner-card">
                <MediaAvatar
                  assetKey="coach-profile"
                  className="profile-avatar"
                  fallback={initialsFor(session.user.name)}
                  label="Your profile photo"
                  revision={assetRevision}
                />
                <div>
                  <strong>{session.user.name}</strong>
                  <small>
                    {session.user.email || 'Development account'} · Workspace
                    owner
                  </small>
                </div>
                <p>
                  {prototype
                    ? 'Role previews are available in the development profile menu.'
                    : 'This pilot is private to your account. Staff and player invitations are not enabled.'}
                </p>
              </div>
            ) : null}
            {activeTab === 'Notifications' ? (
              <div className="settings-owner-card">
                <p>
                  ChalkTalk does not currently send email or push notifications.
                  View saved schedules and install progress in your workspace.
                </p>
              </div>
            ) : null}
            {activeTab === 'Data & privacy' ? (
              <>
                <div className="local-data-note">
                  <CloudOff />
                  <div>
                    <strong>
                      {prototype
                        ? 'Stored on this computer'
                        : 'Stored in your private workspace'}
                    </strong>
                    <p>
                      {prototype
                        ? 'Development records stay on this computer. They are not copied into your hosted pilot.'
                        : 'Your account owns this team. Signing out does not delete its records. The settings export below contains team settings only, not a complete backup of plays, roster, or files.'}
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      downloadText(
                        'chalktalk-settings.json',
                        JSON.stringify(teamSettings, null, 2),
                        'application/json',
                      );
                      onNotify('Team settings exported.');
                    }}
                    variant="outline"
                  >
                    <Download /> Export settings
                  </Button>
                </div>
                <BackupControls />
              </>
            ) : null}
            {activeTab === 'Season & schedule' ? (
              <div className="settings-section-save">
                <span>Save your season and venue changes.</span>
                <Button onClick={() => void saveSettings()}>
                  {saved ? 'Season saved' : 'Save season'}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

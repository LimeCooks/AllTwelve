'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type SyntheticEvent } from 'react';
import NextImage from 'next/image';
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BookOpen,
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
  Info,
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
  MousePointer2,
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
  Redo2,
  Undo2,
  Upload,
  UserPlus,
  Users,
  Volume2,
  X,
  Zap,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { InstallWorkspace, type InstallPackage } from '@/components/install-workspace';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Toaster, toast } from '@/components/ui/toast';
import type { AthleteMetrics, AthleteRecord, AthleteStatus, AthleteUnit, CalendarEventRecord, DepthChartPayload } from '@/types/domain';

const primaryNavigation = [
  { label: 'Home', icon: LayoutDashboard },
  { label: 'Film Room', icon: Film },
  { label: 'Playbook', icon: BookOpen },
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
  { label: 'Install', icon: ClipboardList, badge: undefined },
  { label: 'Settings', icon: Settings, badge: undefined },
];

const focusableTools = new Set(['Film Room', 'Sideline', 'Playbook']);
const playerAllowedViews = new Set(['Home', 'Messages', 'Install']);

type NoticeTone = 'success' | 'info' | 'warning' | 'error';
type Notify = (message: string, tone?: NoticeTone) => void;
type TeamSettings = { teamName: string; level: string; city: string; province: string; colour: string; season: string; notifications: boolean; practiceFacility: string; homeField: string; teamRoom: string };

const initialTeamSettings: TeamSettings = { teamName: 'North Shore Wolves', level: 'varsity', city: 'Halifax', province: 'ns', colour: 'navy', season: '2026', notifications: true, practiceFacility: '', homeField: '', teamRoom: '' };

function formText(fields: FormData, name: string, fallback = '') {
  const value = fields.get(name);
  return typeof value === 'string' ? value : fallback;
}

function initialsFor(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'TM';
}

async function loadWorkspaceState<T>(key: string, fallback: T): Promise<T> {
  const response = await fetch(`/api/workspace-state?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
  const body = await response.json() as { value?: T | null; error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Unable to load saved data.');
  return body.value ?? fallback;
}

async function saveWorkspaceState(key: string, value: unknown) {
  const response = await fetch('/api/workspace-state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
  const body = await response.json() as { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Unable to save changes.');
}

function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function quoteCsv(value: unknown) {
  const rendered = value == null ? '' : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' ? String(value) : JSON.stringify(value);
  return `"${rendered.replaceAll('"', '""')}"`;
}

function mediaUrl(key: string, revision = 0) {
  return `/api/media?key=${encodeURIComponent(key)}&v=${revision}`;
}

async function uploadMedia(key: string, file: File) {
  const data = new FormData();
  data.set('file', file);
  const response = await fetch(`/api/media?key=${encodeURIComponent(key)}`, { method: 'POST', body: data });
  const body = await response.json() as { error?: string; key?: string; contentType?: string; size?: number; uploadedAt?: string };
  if (!response.ok) throw new Error(body.error ?? 'Unable to upload media.');
  return body;
}

async function deleteMedia(key: string) {
  const response = await fetch(`/api/media?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Unable to remove media.');
}

function MediaAvatar({ assetKey, revision, fallback, className, label }: { assetKey: string; revision: number; fallback: ReactNode; className: string; label: string }) {
  const url = mediaUrl(assetKey, revision);
  const [failedUrl, setFailedUrl] = useState('');
  const failed = failedUrl === url;
  return <span className={`${className} media-avatar`} title={failed ? `${label} has no uploaded image` : label}>{failed ? fallback : <NextImage alt={label} fill onError={() => setFailedUrl(url)} sizes="64px" src={url} unoptimized />}</span>;
}

function MediaUploadControl({ assetKey, accept = 'image/*', label, onUploaded, onNotify }: { assetKey: string; accept?: string; label: string; onUploaded: (file?: File) => void; onNotify: Notify }) {
  const [busy, setBusy] = useState(false);
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try { await uploadMedia(assetKey, file); onUploaded(file); onNotify(`${label} uploaded.`); }
    catch (error) { onNotify(error instanceof Error ? error.message : `${label} could not be uploaded.`, 'error'); }
    finally { setBusy(false); }
  };
  return <label className={`media-upload-control${busy ? ' busy' : ''}`}><Upload /> <span>{busy ? 'Uploading…' : label}</span><input accept={accept} disabled={busy} onChange={upload} type="file" /></label>;
}

export default function Home() {
  const [activeView, setActiveViewUnsafe] = useState('Home');
  const [pendingView, setPendingView] = useState('');
  const editingPlayRef = useRef(false);
  const onPlayEditingChange = useCallback((editing: boolean) => { editingPlayRef.current = editing; }, []);
  const setActiveView = useCallback((view: string) => {
    if (editingPlayRef.current) setPendingView(view);
    else setActiveViewUnsafe(view);
  }, []);
  const [isDark, setIsDark] = useState(true);
  const [userRole, setUserRole] = useState<'Coach' | 'Player'>('Coach');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [assetRevision, setAssetRevision] = useState(0);
  const [dashboardEvents, setDashboardEvents] = useState<CalendarEventRecord[]>([]);
  const [dashboardInstall, setDashboardInstall] = useState<{ items: InstallItemRecord[]; reviews: InstallReview[] }>({ items: [], reviews: [] });
  const [teamSettings, setTeamSettings] = useState<TeamSettings>(initialTeamSettings);
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
    const storedTheme = window.localStorage.getItem('chalktalk-theme') !== 'light';
    const frame = window.requestAnimationFrame(() => setIsDark(storedTheme));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const trackedFetch: typeof window.fetch = async (...args) => {
      pendingRequestCount.current += 1;
      if (pendingRequestCount.current === 1) {
        loadingThreshold.current = window.setTimeout(() => setLoadingVisible(true), 400);
      }
      try {
        return await originalFetch(...args);
      } finally {
        pendingRequestCount.current = Math.max(0, pendingRequestCount.current - 1);
        if (pendingRequestCount.current === 0) {
          if (loadingThreshold.current !== null) window.clearTimeout(loadingThreshold.current);
          loadingThreshold.current = null;
          setLoadingVisible(false);
        }
      }
    };
    window.fetch = trackedFetch;
    return () => {
      window.fetch = originalFetch;
      if (loadingThreshold.current !== null) window.clearTimeout(loadingThreshold.current);
    };
  }, []);

  useEffect(() => {
    if (!profileMenuOpen && !teamMenuOpen) return;
    const closeOnOutsideClick = (event: globalThis.PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false);
      if (!teamMenuRef.current?.contains(event.target as Node)) setTeamMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setProfileMenuOpen(false); setTeamMenuOpen(false); }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [profileMenuOpen, teamMenuOpen]);

  useEffect(() => {
    fetch('/api/calendar-events').then(async (response) => await response.json() as { events?: CalendarEventRecord[] }).then((data) => setDashboardEvents(data.events ?? [])).catch(() => setDashboardEvents([]));
    fetch('/api/install').then(async (response) => await response.json() as { items?: InstallItemRecord[]; reviews?: InstallReview[] }).then((data) => setDashboardInstall({ items: data.items ?? [], reviews: data.reviews ?? [] })).catch(() => setDashboardInstall({ items: [], reviews: [] }));
    loadWorkspaceState('team-settings', initialTeamSettings).then((saved) => setTeamSettings({ ...initialTeamSettings, ...saved })).catch(() => setTeamSettings(initialTeamSettings));
  }, []);

  const nextGameEvent = dashboardEvents.find((event) => event.eventType === 'game');
  const agendaEvents = dashboardEvents.filter((event) => event.eventType !== 'game').slice(0, 3);
  const installReadiness = dashboardInstall.items.length ? Math.round(dashboardInstall.items.reduce((total, item) => total + item.complete, 0) / dashboardInstall.items.length) : 0;
  const completedInstallReviews = dashboardInstall.reviews.filter((review) => review.acknowledged).length;

  const toggleTheme = () => {
    setIsDark((current) => {
      window.localStorage.setItem('chalktalk-theme', current ? 'light' : 'dark');
      return !current;
    });
  };

  const changeRole = (role: 'Coach' | 'Player') => {
    if (editingPlayRef.current) { setProfileMenuOpen(false); notify('Save or cancel the current play before switching roles.', 'info'); return; }
    setUserRole(role);
    setActiveView('Home');
    setProfileMenuOpen(false);
  };

  const openGlobalSearchResult = () => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return;
    const destination = query.includes('athlete') || query.includes('player') ? 'Athletes'
      : query.includes('film') || query.includes('clip') || query.includes('hamilton') ? 'Film Room'
        : query.includes('play') || query.includes('red 24') || query.includes('mesh') ? 'Playbook'
          : query.includes('message') || query.includes('coach') ? 'Messages'
            : query.includes('practice') ? 'Practice Plans'
              : query.includes('calendar') || query.includes('event') ? 'Calendar'
                : 'Home';
    const permittedDestination = userRole === 'Player' && !playerAllowedViews.has(destination) ? 'Home' : destination;
    setActiveView(permittedDestination);
    notify(permittedDestination === 'Home' ? `No available player result for “${searchQuery}”.` : `Showing ${permittedDestination} results for “${searchQuery}”.`, permittedDestination === 'Home' ? 'info' : 'success');
  };

  const runGlobalSearch = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    openGlobalSearchResult();
  };

  const accountName = userRole === 'Coach' ? 'Coach Martin' : 'Player account';
  const accountInitials = userRole === 'Coach' ? 'CM' : 'PL';
  const teamShortName = teamSettings.teamName.trim().replace(/\s+(wolves|tigers|eagles|bears|lions)$/i, '') || teamSettings.teamName;
  const teamInitials = initialsFor(teamSettings.teamName);
  const programLabel = teamSettings.level === 'junior' ? 'Junior varsity' : teamSettings.level === 'club' ? 'Club' : 'Varsity';
  const currentHour = new Date().getHours();
  const coachGreeting = currentHour < 12 ? 'Good morning, Coach.' : currentHour < 17 ? 'Good afternoon, Coach.' : 'Good evening, Coach.';

  return (
    <main className={`${isDark ? 'app-shell dark' : 'app-shell'}${sidebarCollapsed ? ' sidebar-collapsed' : ''}${toolFocus && focusableTools.has(activeView) ? ' tool-focus' : ''}`} data-team-colour={teamSettings.colour}>
      <aside className="sidebar">
        <button aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'} className="sidebar-collapse-toggle" onClick={() => setSidebarCollapsed((collapsed) => !collapsed)} title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'} type="button">{sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</button>
        <div className="brand-lockup">
          <span className="brand-mark brand-mark-v2"><span>CT</span></span>
          <span className="brand-name"><strong>chalk<span>talk</span></strong><small>FOOTBALL OS</small></span>
        </div>

        <div className="team-menu-wrap" ref={teamMenuRef}>
          <button aria-expanded={teamMenuOpen} aria-haspopup="menu" className="team-switcher" onClick={() => setTeamMenuOpen((open) => !open)} type="button">
            <MediaAvatar assetKey="team-logo" className="team-crest" fallback={teamInitials} label={`${teamSettings.teamName} logo`} revision={assetRevision} />
            <span className="min-w-0 flex-1 text-left">
              <strong>{teamShortName}</strong>
              <small>{programLabel} · {teamSettings.season}</small>
            </span>
            <ChevronDown className={teamMenuOpen ? 'rotated' : ''} size={15} />
          </button>
          {teamMenuOpen ? <div className="team-switcher-menu" role="menu"><div><MediaAvatar assetKey="team-logo" className="team-crest" fallback={teamInitials} label={`${teamSettings.teamName} logo`} revision={assetRevision} /><span><strong>{teamSettings.teamName}</strong><small>Active team workspace</small></span><Check /></div>{userRole === 'Coach' ? <button onClick={() => { setActiveView('Settings'); setTeamMenuOpen(false); }} role="menuitem" type="button"><Settings /><span><strong>Team settings</strong><small>Identity, season, staff, and defaults</small></span></button> : <p><Lock /> Team settings are managed by coaches.</p>}</div> : null}
        </div>

        <nav aria-label="Main navigation" className="nav-stack">
          <p className="nav-label">Team</p>
          {primaryNavigation.filter((item) => userRole === 'Coach' || item.label === 'Home').map((item) => (
            <button className={activeView === item.label ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView(item.label)} title={item.label} type="button" key={item.label}>
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          ))}
          {userRole === 'Coach' ? <p className="nav-label mt-7">Plan</p> : null}
          {planningNavigation.filter(() => userRole === 'Coach').map((item) => (
            <button className={activeView === item.label ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView(item.label)} title={item.label} type="button" key={item.label}>
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          ))}
          <p className="nav-label mt-7">Workspace</p>
          {workspaceNavigation.filter((item) => userRole === 'Coach' || ['Messages', 'Install'].includes(item.label)).map((item) => (
            <button className={activeView === item.label ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView(item.label)} title={item.label} type="button" key={item.label}>
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
            </button>
          ))}
        </nav>

        <div className="season-card">
          <div className="flex items-center justify-between">
            <span className="eyebrow text-white/50">Season</span>
            <Sparkles size={15} className="text-[#ff8a72]" />
          </div>
          <strong>{teamSettings.season}</strong>
          <span>{nextGameEvent ? `Next: ${new Date(nextGameEvent.startsAt).toLocaleDateString([], { weekday: 'short' })} · ${new Date(nextGameEvent.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'No game scheduled'}</span>
          <small>{teamShortName} · {programLabel}</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark brand-mark-v2"><span>CT</span></span>
            <strong>chalk<span>talk</span></strong>
          </div>
          <form className="search-wrap global-search" onSubmit={runGlobalSearch}>
            <span className="search-symbol"><Search size={18} /></span>
            <Input aria-label="Search ChalkTalk" className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); openGlobalSearchResult(); } }} placeholder="Search ChalkTalk…" value={searchQuery} />
            <span className="search-context">Film · Plays · People</span>
          </form>
          <div className="top-actions">
            <Button aria-label="Notifications" className="rounded-full" onClick={() => setActiveView('Messages')} size="icon-lg" variant="ghost"><Bell /></Button>
            <div className="profile-menu-wrap" ref={profileMenuRef}>
              <button aria-expanded={profileMenuOpen} aria-haspopup="menu" className="profile-trigger" onClick={() => setProfileMenuOpen((open) => !open)} type="button">
                <MediaAvatar assetKey={userRole === 'Coach' ? 'coach-profile' : 'player-profile'} className="profile-avatar" fallback={accountInitials} label={`${accountName} profile photo`} revision={assetRevision} />
                <span className="profile-name">{accountName} <ChevronDown size={14} /></span>
              </button>
              {profileMenuOpen ? <div aria-label="Account menu" className="profile-menu" role="menu">
                <div className="profile-menu-head"><MediaAvatar assetKey={userRole === 'Coach' ? 'coach-profile' : 'player-profile'} className="profile-avatar" fallback={accountInitials} label={`${accountName} profile photo`} revision={assetRevision} /><span><strong>{accountName}</strong><small>{userRole} workspace</small></span></div>
                {userRole === 'Coach' ? <button onClick={() => { setActiveView('Settings'); setProfileMenuOpen(false); }} role="menuitem" type="button"><Settings /><span><strong>Profile &amp; team settings</strong><small>Account media, identity, and workspace defaults</small></span></button> : <button onClick={() => { setActiveView('Home'); setProfileMenuOpen(false); }} role="menuitem" type="button"><Users /><span><strong>Player workspace</strong><small>Assignments and team messages</small></span></button>}
                <button onClick={() => changeRole('Coach')} role="menuitem" type="button"><Shield /><span><strong>Coach view</strong><small>{userRole === 'Coach' ? 'Currently active' : 'Open the staff workspace'}</small></span></button>
                <button onClick={() => changeRole('Player')} role="menuitem" type="button"><Users /><span><strong>Player view</strong><small>{userRole === 'Player' ? 'Currently active' : 'Preview a connected player account'}</small></span></button>
                <button onClick={() => { toggleTheme(); setProfileMenuOpen(false); }} role="menuitem" type="button">{isDark ? <Sun /> : <Moon />}<span><strong>Use {isDark ? 'light' : 'dark'} theme</strong><small>Change this device only</small></span></button>
              </div> : null}
            </div>
          </div>
        </header>

        <div className={activeView === 'Home' ? `content-grid home-clean${userRole === 'Player' ? ' player-home-grid' : ''}` : 'content-grid module-grid'}>
          {activeView === 'Home' ? (
          userRole === 'Coach' ? (<>
          <div className="main-column">
            <section className="welcome-row">
              <div>
                <p className="eyebrow">Team overview</p>
                <h1>{coachGreeting}</h1>
                <p>Everything your team needs for the next kickoff, in one place.</p>
              </div>
              <div className="flex gap-2">
                <Button className="h-10 rounded-xl bg-[#101d2e] px-4 text-white hover:bg-[#20344f]" onClick={() => setActiveView('Film Room')}>
                  <Play data-icon="inline-start" fill="currentColor" /> Start film session
                </Button>
              </div>
            </section>

            <section className="game-card">
              <div className="game-card-top">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-[#e4472e] text-white">NEXT GAME</Badge>
                    <span className="text-xs font-medium text-slate-500">Saved schedule</span>
                  </div>
                  <p className="game-kicker">{nextGameEvent ? `${new Date(nextGameEvent.startsAt).toLocaleDateString([], { weekday: 'long' })} · ${new Date(nextGameEvent.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${nextGameEvent.location}` : 'Add the next game in Calendar'}</p>
                </div>
                <Button aria-label="Game options" onClick={() => setActiveView('Gameplanning')} size="icon" variant="ghost"><MoreHorizontal /></Button>
              </div>

              <div className="matchup">
                <div className="team-panel">
                  <MediaAvatar assetKey="team-logo" className="large-crest home-crest" fallback={teamInitials} label={`${teamSettings.teamName} logo`} revision={assetRevision} />
                  <div><strong>{teamShortName}</strong><small>{programLabel} · {teamSettings.season}</small></div>
                </div>
                <div className="versus"><span>VS</span><small>{nextGameEvent ? 'Scheduled' : 'Open'}</small></div>
                <div className="team-panel away">
                  <div><strong>{nextGameEvent ? nextGameEvent.title.split(' at ')[0] : 'Opponent not scheduled'}</strong><small>{nextGameEvent ? 'Scheduled game' : 'Open Calendar to add one'}</small></div>
                  <MediaAvatar assetKey="opponent-logo" className="large-crest away-crest" fallback="OP" label="Opponent logo" revision={assetRevision} />
                </div>
              </div>

              <div className="readiness">
                <div className="readiness-heading">
                  <strong>Game-day readiness</strong>
                  <span>{installReadiness}%</span>
                </div>
                <div className="readiness-track"><span style={{ width: `${installReadiness}%` }} /></div>
                <div className="readiness-items">
                  <span><i className={dashboardEvents.length ? 'done' : ''} /> {dashboardEvents.length} calendar {dashboardEvents.length === 1 ? 'event' : 'events'} scheduled</span>
                  <span><i className={dashboardInstall.items.length ? 'done' : ''} /> {dashboardInstall.items.length} install {dashboardInstall.items.length === 1 ? 'item' : 'items'}</span>
                  <span><i /> Install at {installReadiness}%</span>
                  <span><i /> {dashboardInstall.reviews.length - completedInstallReviews} athlete reviews open</span>
                </div>
              </div>
            </section>

            <div className="section-heading">
              <div><p className="eyebrow">Pick up where you left off</p><h2>Recent work</h2></div>
              <button onClick={() => setActiveView('Reports')} type="button">View all</button>
            </div>

            <section className="recent-grid">
              <article className="film-card">
                <HomeFilmPreview onOpen={() => setActiveView('Film Room')} revision={assetRevision} />
                <div className="card-copy">
                  <div><span className="content-type">FILM</span><strong>Team film library</strong></div>
                  <p>Uploaded footage appears here—no sample film is substituted.</p>
                </div>
              </article>

              <article className="play-card">
                <HomePlayPreview onOpen={() => setActiveView('Playbook')} />
                <div className="card-copy">
                  <div><span className="content-type playbook-type">PLAYBOOK</span><strong>Team play library</strong></div>
                  <p>Saved diagrams appear here—no sample plays are substituted.</p>
                </div>
              </article>
            </section>

            <div className="section-heading week-heading">
              <div><p className="eyebrow">Stay ahead</p><h2>Game week command board</h2></div>
              <Badge className="live-plan-badge"><span /> Live plan</Badge>
            </div>

            <section className="command-board">
              <article className="command-card agenda-card">
                <div className="command-card-head"><span className="command-icon blue"><CalendarDays /></span><div><strong>Upcoming agenda</strong><small>{agendaEvents.length} saved {agendaEvents.length === 1 ? 'event' : 'events'}</small></div><ChevronRight /></div>
                <div className="agenda-list">
                  {agendaEvents.map((event, index) => <div key={event.id}><b>{new Date(event.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b><span><strong>{event.title}</strong><small>{event.location || 'Location not set'}</small></span><i className={index === 0 ? 'blue' : index === 1 ? 'teal' : 'violet'} /></div>)}
                  {agendaEvents.length === 0 ? <div className="dashboard-empty-row"><CalendarDays /><span><strong>No upcoming events</strong><small>Add one in Calendar.</small></span></div> : null}
                </div>
              </article>

              <article className="command-card install-pulse-card">
                <div className="command-card-head"><span className="command-icon teal"><ClipboardList /></span><div><strong>Install pulse</strong><small>{completedInstallReviews} of {dashboardInstall.reviews.length} reviews complete</small></div><button onClick={() => setActiveView('Install')} type="button">Open</button></div>
                <div className="pulse-number"><strong>{installReadiness}%</strong><span>Team completion</span></div>
                <div className="readiness-track pulse"><span style={{ width: `${installReadiness}%` }} /></div>
                <div className="unit-progress"><span>Assignments <b>{dashboardInstall.items.length}</b></span><span>Complete <b>{completedInstallReviews}</b></span><span>Open <b>{dashboardInstall.reviews.length - completedInstallReviews}</b></span></div>
              </article>

              <article className="command-card staff-focus-card">
                <div className="command-card-head"><span className="command-icon violet"><Zap /></span><div><strong>Next actions</strong><small>Based on saved workspace data</small></div></div>
                <button onClick={() => setActiveView('Install')} type="button"><span className="focus-status urgent">{dashboardInstall.reviews.length - completedInstallReviews}</span><div><strong>Open athlete reviews</strong><small>Install · incomplete acknowledgements</small></div><ChevronRight /></button>
                <button onClick={() => setActiveView('Calendar')} type="button"><span className="focus-status">{agendaEvents.length}</span><div><strong>Upcoming calendar</strong><small>{agendaEvents.length ? agendaEvents[0].title : 'Add the first team event'}</small></div><ChevronRight /></button>
              </article>
            </section>
          </div>

          <aside className="right-rail">
            <section className="rail-card chat-card">
              <div className="rail-heading"><div><p className="eyebrow">Team chat</p><h3>Messages</h3></div></div>
              <div className="rail-empty-state"><MessageSquareText /><strong>No recent messages</strong><span>New team conversations will appear here.</span></div>
              <Button className="mt-2 h-9 w-full rounded-xl" onClick={() => setActiveView('Messages')} variant="outline"><MessageSquareText /> Open team chat</Button>
            </section>

            <section className="rail-card">
              <div className="rail-heading"><div><p className="eyebrow">Updates</p><h3>Team activity</h3></div></div>
              <div className="rail-empty-state"><Clock3 /><strong>No recorded activity yet</strong><span>Saved changes and completed reviews will populate this feed once activity logging is connected.</span></div>
            </section>

            <section className="rail-card quick-card">
              <div className="rail-heading"><div><p className="eyebrow">Quick access</p><h3>Build your week</h3></div></div>
              <div className="quick-grid">
                <button onClick={() => setActiveView('Playbook')} type="button"><BookOpen /><span><strong>New play</strong><small>Draw & install</small></span></button>
                <button onClick={() => setActiveView('Film Room')} type="button"><Film /><span><strong>Upload film</strong><small>Add game tape</small></span></button>
                <button onClick={() => setActiveView('Depth Charts')} type="button"><Shield /><span><strong>Depth chart</strong><small>Set starters</small></span></button>
                <button onClick={() => setActiveView('Sideline')} type="button"><Radio /><span><strong>Sideline</strong><small>Start replay</small></span></button>
              </div>
            </section>
          </aside>
          </>) : (<PlayerDashboard assetRevision={assetRevision} onNavigate={setActiveView} />)
          ) : (
            <ModuleView onPlayEditingChange={onPlayEditingChange} assetRevision={assetRevision} focusMode={toolFocus && focusableTools.has(activeView)} onAssetsChanged={() => setAssetRevision(Date.now())} onNavigate={setActiveView} onNotify={notify} onTeamSettingsChange={setTeamSettings} onToggleFocus={() => setToolFocus((focused) => !focused)} teamSettings={teamSettings} userRole={userRole} view={activeView} />
          )}
        </div>
      </section>
      <nav aria-label="Mobile navigation" className="mobile-dock">
        {primaryNavigation.filter((item) => userRole === 'Coach' || item.label === 'Home').slice(0, 5).map((item) => (
          <button className={activeView === item.label ? 'active' : ''} key={item.label} onClick={() => setActiveView(item.label)} type="button">
            <item.icon /><span>{item.label === 'Film Room' ? 'Film' : item.label}</span>
          </button>
        ))}
      </nav>
      {loadingVisible ? <div aria-live="polite" className="app-loading-overlay">
        <div className="app-loading-card"><LoaderCircle aria-hidden="true" /><span><strong>Loading saved data</strong><small>Waiting for the local workspace to respond…</small></span></div>
      </div> : null}
      <Toaster />
      <Dialog open={Boolean(pendingView)} onOpenChange={(open) => { if (!open) setPendingView(''); }}><DialogContent className="athlete-dialog"><DialogHeader><DialogTitle>Leave the play editor?</DialogTitle><DialogDescription>Your unsaved changes will be discarded. Save the play first to keep them.</DialogDescription></DialogHeader><DialogFooter><Button onClick={() => setPendingView('')} variant="outline">Keep editing</Button><Button onClick={() => { editingPlayRef.current = false; setActiveViewUnsafe(pendingView); setPendingView(''); }} variant="destructive">Discard and leave</Button></DialogFooter></DialogContent></Dialog>
    </main>
  );
}

function HomeFilmPreview({ onOpen, revision }: { onOpen: () => void; revision: number }) {
  const source = mediaUrl('film-hamilton-week-5', revision);
  const [readySource, setReadySource] = useState('');
  const available = readySource === source;
  return <div className={`film-preview real-media-preview${available ? ' available' : ''}`}>
    <video aria-label="Uploaded team film" muted onCanPlay={() => setReadySource(source)} onError={() => setReadySource('')} preload="metadata" src={source} />
    {available ? <button aria-label="Open team film" className="play-button" onClick={onOpen} type="button"><Play fill="currentColor" /></button> : <button className="real-media-empty" onClick={onOpen} type="button"><Film /><strong>No film uploaded</strong><span>Add real game footage in Film Room</span></button>}
  </div>;
}

function HomePlayPreview({ onOpen }: { onOpen: () => void }) {
  const [play, setPlay] = useState<StudioPlay | null>(null);
  useEffect(() => {
    let active = true;
    loadPlaybookData()
      .then((saved) => { if (active) setPlay(saved.plays[0] ?? null); })
      .catch(() => { if (active) setPlay(null); });
    return () => { active = false; };
  }, []);
  return <button aria-label="Open saved playbooks" className="play-preview real-play-preview" onClick={onOpen} type="button">{play && ((play.routes?.length ?? 0) + (play.zones?.length ?? 0) + (play.labels?.length ?? 0) > 0) ? <StudioPlayDiagram label={false} play={play} /> : <span className="real-media-empty"><BookOpen /><strong>No diagram saved</strong><span>Open Playbook to create the first real play</span></span>}</button>;
}

function PlayerDashboard({ assetRevision, onNavigate }: { assetRevision: number; onNavigate: (view: string) => void }) {
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
        <header className="player-home-profile"><MediaAvatar assetKey="player-profile" className="detail-avatar" fallback="PL" label="Player account profile photo" revision={assetRevision} /><div><Badge variant="outline">Setup needed</Badge><h2>Player account is not connected yet</h2><p>A coach must link this login to a roster athlete before private assignments or feedback can appear.</p></div><Lock /></header>
        <div className="player-home-actions">
          <article><span className="command-icon violet"><ClipboardList /></span><div><strong>Assigned learning</strong><p>Install reviews will appear here once the account is linked.</p></div><Button onClick={() => onNavigate('Install')} variant="outline">Open install <ChevronRight /></Button></article>
          <article><span className="command-icon blue"><MessageSquareText /></span><div><strong>Team communication</strong><p>Use the player-safe workspace to read and send team messages.</p></div><Button onClick={() => onNavigate('Messages')} variant="outline">Open messages <ChevronRight /></Button></article>
        </div>
        <div className="player-access-note"><Shield /><span><strong>Player permissions are active</strong><small>Team settings, roster management, planning tools, and coach-only workspaces are hidden.</small></span></div>
      </section>
    </div>
  );
}

type ModuleProps = {
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

function ModuleView({ view, userRole, focusMode, onToggleFocus, onNavigate, onNotify, assetRevision, onAssetsChanged, teamSettings, onTeamSettingsChange, onPlayEditingChange }: ModuleProps) {
  if (userRole === 'Player' && !playerAllowedViews.has(view)) return <PlayerDashboard assetRevision={assetRevision} onNavigate={onNavigate} />;
  if (view === 'Film Room') return <FilmRoomView assetRevision={assetRevision} focusMode={focusMode} onAssetsChanged={onAssetsChanged} onNavigate={onNavigate} onNotify={onNotify} onToggleFocus={onToggleFocus} />;
  if (view === 'Playbook') return <PlaybookView onEditingChange={onPlayEditingChange} focusMode={focusMode} onNavigate={onNavigate} onNotify={onNotify} onToggleFocus={onToggleFocus} />;
  if (view === 'Sideline') return <SidelineView assetRevision={assetRevision} focusMode={focusMode} onNavigate={onNavigate} onNotify={onNotify} onToggleFocus={onToggleFocus} teamSettings={teamSettings} />;
  if (view === 'Athletes') return <AthletesView assetRevision={assetRevision} onAssetsChanged={onAssetsChanged} onNotify={onNotify} />;
  if (view === 'Depth Charts') return <DepthChartsView onNotify={onNotify} />;
  if (view === 'Messages') return <MessagesView onNavigate={onNavigate} onNotify={onNotify} teamSettings={teamSettings} />;
  if (view === 'Install') return <InstallWorkspace<StudioPlay> onNavigate={onNavigate} playerView={userRole === 'Player'} renderDiagram={(play) => <StudioPlayDiagram play={play} />} />;
  if (view === 'Reports') return <ReportsView onNavigate={onNavigate} onNotify={onNotify} />;
  if (view === 'Gameplanning') return <GameplanningView onNavigate={onNavigate} onNotify={onNotify} />;
  if (view === 'Calendar') return <CalendarView onNavigate={onNavigate} onNotify={onNotify} teamSettings={teamSettings} />;
  if (view === 'Practice Plans') return <PracticePlansView onNavigate={onNavigate} onNotify={onNotify} />;
  return <SettingsView assetRevision={assetRevision} onAssetsChanged={onAssetsChanged} onNavigate={onNavigate} onNotify={onNotify} onTeamSettingsChange={onTeamSettingsChange} teamSettings={teamSettings} />;
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

function FocusModeButton({ focused, onToggle }: { focused: boolean; onToggle: () => void }) {
  return <Button aria-pressed={focused} className="focus-mode-button" onClick={onToggle} variant="outline">{focused ? <PanelLeftOpen /> : <Maximize2 />}{focused ? 'Exit focus' : 'Focus mode'}</Button>;
}

type FilmAssetRecord = { id: string; gameId: string | null; opponent: string | null; title: string; storageKey: string | null; durationSeconds: number; status: string; createdAt: string };
type FilmClipRecord = { id: string; assetId: string; playId: string | null; playName: string | null; clipNumber: number; startSeconds: number; endSeconds: number; odk: string; down: number | null; distance: number | null; yardLine: string; result: string; tags: string[]; note: string; concept: string; quarter: string; clock: string };
type FilmPayload = { assets: FilmAssetRecord[]; asset: FilmAssetRecord | null; clips: FilmClipRecord[]; error?: string };

function clipLabel(clip: FilmClipRecord) {
  return clip.playName || clip.concept || `Clip ${clip.clipNumber}`;
}

function FilmRoomView({ assetRevision, focusMode, onAssetsChanged, onNavigate, onNotify, onToggleFocus }: { assetRevision: number; focusMode: boolean; onAssetsChanged: () => void; onNavigate: (view: string) => void; onNotify: Notify; onToggleFocus: () => void }) {
  const [filmAsset, setFilmAsset] = useState<FilmAssetRecord | null>(null);
  const [filmAssets, setFilmAssets] = useState<FilmAssetRecord[]>([]);
  const [filmClips, setFilmClips] = useState<FilmClipRecord[]>([]);
  const [selectedClip, setSelectedClip] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [note, setNote] = useState('');
  const [filmSearch, setFilmSearch] = useState('');
  const [libraryTab, setLibraryTab] = useState<'Games' | 'Clips'>('Games');
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [readyFilmSource, setReadyFilmSource] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeClip = filmClips.find((clip) => clip.clipNumber === selectedClip) ?? filmClips[0] ?? null;
  const visibleClips = filmClips.filter((clip) => `${clipLabel(clip)} ${clip.odk} ${clip.quarter} ${clip.tags.join(' ')}`.toLowerCase().includes(filmSearch.toLowerCase()));
  const filmSource = filmAsset?.storageKey ? mediaUrl(filmAsset.storageKey, assetRevision) : '';
  const filmAvailable = Boolean(filmSource && readyFilmSource === filmSource);

  useEffect(() => {
    fetch('/api/film', { cache: 'no-store' }).then(async (response) => {
      const data = await response.json() as FilmPayload;
      if (!response.ok) throw new Error(data.error ?? 'Unable to load film.');
      setFilmAsset(data.asset); setFilmAssets(data.assets); setFilmClips(data.clips); setSelectedClip((current) => data.clips.some((clip) => clip.clipNumber === current) ? current : data.clips[0]?.clipNumber ?? 0);
      setNote(data.clips[0]?.note ?? '');
    }).catch(() => onNotify('Saved film data could not be loaded.', 'warning'));
  }, [onNotify]);

  const chooseClip = (clipId: number) => {
    setSelectedClip(clipId);
    const clip = filmClips.find((item) => item.clipNumber === clipId);
    setNote(clip?.note ?? '');
    if (clip && videoRef.current) videoRef.current.currentTime = clip.startSeconds;
  };

  const moveClip = (direction: number) => {
    if (!filmClips.length) return;
    const index = Math.max(0, filmClips.findIndex((clip) => clip.clipNumber === selectedClip));
    chooseClip(filmClips[(index + direction + filmClips.length) % filmClips.length].clipNumber);
  };

  const saveBreakdown = async (advance = false) => {
    if (!filmAsset) { onNotify('Upload film before charting clips.', 'info'); return; }
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
    try {
      const response = await fetch('/api/film', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'upsertClip', assetId: filmAsset.id, id: activeClip?.id, clipNumber: activeClip?.clipNumber ?? filmClips.length + 1, startSeconds: value('film-start'), endSeconds: value('film-end'), odk: value('film-unit'), down: value('film-down'), distance: value('film-distance'), yardLine: value('film-yardline'), playId: value('film-play'), concept: value('film-concept'), result: value('film-result'), quarter: value('film-quarter'), clock: value('film-clock'), tags: value('film-tags').split(',').map((tag) => tag.trim()).filter(Boolean), note: value('film-note') }) });
      const data = await response.json() as FilmPayload;
      if (!response.ok) throw new Error(data.error ?? 'Unable to save the clip.');
      setFilmAsset(data.asset); setFilmAssets(data.assets); setFilmClips(data.clips); const saved = activeClip ? data.clips.find((clip) => clip.id === activeClip.id) : data.clips.at(-1); if (saved) { setSelectedClip(saved.clipNumber); setNote(saved.note); } onNotify(`Clip ${saved?.clipNumber ?? filmClips.length + 1} saved.`); if (advance) { setSelectedClip(0); setNote(''); }
    } catch (error) { onNotify(error instanceof Error ? error.message : 'The clip breakdown could not be saved.', 'error'); }
  };

  const registerFilm = async (file?: File) => {
    try {
      const response = await fetch('/api/film', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'register', storageKey: 'film-hamilton-week-5', title: file?.name || 'Uploaded game film' }) });
      const data = await response.json() as FilmPayload;
      if (!response.ok) throw new Error(data.error ?? 'Unable to register the uploaded film.');
      setFilmAsset(data.asset); setFilmAssets(data.assets); setFilmClips(data.clips); onAssetsChanged();
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Unable to register the uploaded film.', 'error'); }
  };

  const deleteChartedClip = async () => {
    if (!activeClip) return;
    try {
      const response = await fetch(`/api/film?clipId=${encodeURIComponent(activeClip.id)}`, { method: 'DELETE' });
      const data = await response.json() as FilmPayload;
      if (!response.ok) throw new Error(data.error ?? 'Unable to remove the clip.');
      setFilmAsset(data.asset); setFilmAssets(data.assets); setFilmClips(data.clips); setSelectedClip(data.clips[0]?.clipNumber ?? 0); setNote(data.clips[0]?.note ?? ''); onNotify(`Clip ${activeClip.clipNumber} removed.`);
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Unable to remove the clip.', 'error'); }
  };

  const toggleFilm = async () => {
    const video = videoRef.current;
    if (!video || !filmAvailable) { onNotify('Upload game film before using playback controls.', 'info'); return; }
    if (video.paused) { await video.play(); setIsPlaying(true); }
    else { video.pause(); setIsPlaying(false); }
  };

  return (
    <section className="module-surface film-room-surface film-review-tool">
      <ModuleHeader
        eyebrow={filmAsset ? `${filmAsset.opponent || 'Team film'} · ${filmClips.length} saved ${filmClips.length === 1 ? 'clip' : 'clips'}` : 'Team film library'}
        title={filmAsset?.title ?? 'Film Room'}
        description="Review film, chart every snap, and keep teaching notes beside the video."
      >
        <FocusModeButton focused={focusMode} onToggle={onToggleFocus} />
        <MediaUploadControl accept="video/*" assetKey="film-hamilton-week-5" label={filmAsset ? 'Replace film' : 'Upload film'} onNotify={onNotify} onUploaded={(file) => void registerFilm(file)} />
        <Button className="module-primary" disabled={!filmAsset} onClick={() => { setSelectedClip(0); setNote(''); }}><Plus /> New clip</Button>
      </ModuleHeader>

      <div className={filmAsset ? 'local-data-status' : 'local-data-status status-warning'}><span className="sync-dot" /><strong>{filmAsset ? 'Film saved locally' : 'No film uploaded'}</strong><small>{filmClips.length} charted {filmClips.length === 1 ? 'clip' : 'clips'}</small></div>

      <div className="toolbar-row">
        <div className="toolbar-search"><Search /><Input aria-label="Search game film" onChange={(event) => setFilmSearch(event.target.value)} placeholder="Search snaps, formations, concepts, athletes…" value={filmSearch} /></div>
        <Button disabled={!activeClip} onClick={async () => { if (!activeClip) return; const cutups = await loadWorkspaceState<{ name: string; clips: string[]; updatedAt: string }[]>('film-cutups', []); await saveWorkspaceState('film-cutups', [...cutups, { name: clipLabel(activeClip), clips: [activeClip.id], updatedAt: new Date().toISOString() }]); onNotify('Cut-up saved from the selected clip.'); }} variant="outline"><Plus /> Add to cut-up</Button>
        <Button onClick={() => onNavigate('Reports')} variant="outline"><SlidersHorizontal /> Reports</Button>
      </div>

      <div className={libraryCollapsed ? 'film-workspace library-collapsed' : 'film-workspace'}>
        <aside className={libraryCollapsed ? 'clip-panel film-library-panel collapsed' : 'clip-panel film-library-panel'}>
          {libraryCollapsed ? <button aria-expanded="false" aria-label="Expand film library" className="film-library-expand" onClick={() => setLibraryCollapsed(false)} type="button"><ChevronLeft /><span>Film library</span></button> : <>
          <div className="panel-title film-library-title">
            <div><strong>Film library</strong><span>{filmAssets.length} saved {filmAssets.length === 1 ? 'film' : 'films'} · {filmClips.length} clips</span></div>
            <div><Button aria-label="Add clip" disabled={!filmAsset} onClick={() => { setSelectedClip(0); setNote(''); }} size="icon-sm" variant="ghost"><Plus /></Button><Button aria-label="Collapse film library" onClick={() => setLibraryCollapsed(true)} size="icon-sm" variant="ghost"><ChevronRight /></Button></div>
          </div>
          <div className="film-library-tabs"><button className={libraryTab === 'Games' ? 'active' : ''} onClick={() => setLibraryTab('Games')} type="button"><Film /> Games</button><button className={libraryTab === 'Clips' ? 'active' : ''} onClick={() => setLibraryTab('Clips')} type="button"><ListFilter /> Clips</button></div>
          {libraryTab === 'Games' ? <div className="film-assets-list">{filmAssets.map((asset) => <button className={filmAsset?.id === asset.id ? 'active' : ''} key={asset.id} onClick={() => onNotify(asset.id === filmAsset?.id ? `${asset.title} is open.` : 'Open this film from its saved session.', 'info')} type="button"><span><Film /></span><div><strong>{asset.title}</strong><small>{asset.opponent || 'Team film'} · {asset.status}</small></div><b>{filmAsset?.id === asset.id ? 'OPEN' : ''}</b></button>)}{!filmAssets.length ? <div className="film-library-empty"><Film /><strong>No saved film</strong><span>Upload a video to create the first review session.</span></div> : null}</div> : null}
          {libraryTab === 'Clips' ? <><div className="clip-library-heading"><span>Charted clips</span><b>{visibleClips.length}</b></div>
          <div className="clip-list">
            {visibleClips.map((clip) => (
              <button className={selectedClip === clip.clipNumber ? 'clip-row active' : 'clip-row'} key={clip.id} onClick={() => chooseClip(clip.clipNumber)} type="button">
                <span className="clip-index">{String(clip.clipNumber).padStart(2, '0')}</span>
                <span className="clip-thumb"><Film /></span>
                <span className="clip-main"><strong>{clipLabel(clip)}</strong><small>{clip.odk || 'Unit unassigned'}{clip.down ? ` · ${clip.down} & ${clip.distance ?? '—'}` : ''}</small></span>
                <span className="clip-result">{clip.result || '—'}</span>
              </button>
            ))}
            {!visibleClips.length ? <div className="channel-empty">{filmAsset ? 'No clips charted yet.' : 'Upload film to begin.'}</div> : null}
          </div>
          <button className="add-clips" disabled={!filmAsset} onClick={() => { setSelectedClip(0); setNote(''); }} type="button"><Plus /> Chart another clip</button></> : null}</>}
        </aside>

        <div className="film-stage">
          <div className="viewer">
            <div className="viewer-field">
              {filmSource ? <video aria-label="Uploaded game film" className={filmAvailable ? 'film-video available' : 'film-video'} onCanPlay={() => setReadyFilmSource(filmSource)} onEnded={() => setIsPlaying(false)} onError={() => setReadyFilmSource('')} onPause={() => setIsPlaying(false)} onPlay={() => setIsPlaying(true)} playsInline preload="metadata" ref={videoRef} src={filmSource}><track kind="captions" label="No captions uploaded" src="/empty.vtt" srcLang="en" /></video> : null}
              {filmAvailable ? <><button aria-label={isPlaying ? 'Pause film' : 'Play film'} className="viewer-play" onClick={() => void toggleFilm()} type="button">{isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>{activeClip ? <span className="viewer-tag"><Tag /> {clipLabel(activeClip)}</span> : null}</> : <div className="viewer-empty-state"><Film /><strong>No game film uploaded</strong><span>Add footage from this computer. ChalkTalk will never invent a preview.</span><MediaUploadControl accept="video/*" assetKey="film-hamilton-week-5" label="Choose video" onNotify={onNotify} onUploaded={(file) => void registerFilm(file)} /></div>}
            </div>
            <div className="player-controls">
              <Button aria-label="Previous clip" onClick={() => moveClip(-1)} size="icon-sm" variant="ghost"><SkipBack /></Button>
              <Button aria-label={isPlaying ? 'Pause' : 'Play'} className="control-play" disabled={!filmAvailable} size="icon" onClick={() => void toggleFilm()}><>{isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</></Button>
              <Button aria-label="Next clip" onClick={() => moveClip(1)} size="icon-sm" variant="ghost"><SkipForward /></Button>
              <span className="timecode">{activeClip ? `${activeClip.startSeconds}s – ${activeClip.endSeconds}s` : 'No clip selected'}</span>
              <Slider aria-label="Film timeline" className="film-slider" disabled={!filmAvailable} value={[activeClip && filmAsset?.durationSeconds ? activeClip.startSeconds / filmAsset.durationSeconds * 100 : 0]} max={100} />
              <Button aria-label="Volume" disabled={!filmAvailable} onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; }} size="icon-sm" variant="ghost"><Volume2 /></Button>
              <Button aria-label="Fullscreen" onClick={() => document.querySelector('.viewer')?.requestFullscreen?.()} size="icon-sm" variant="ghost"><Maximize2 /></Button>
            </div>
          </div>

          <div className="film-lower">
            <div className="timeline-card">
              <div className="timeline-head">
                <div>
                  <Badge variant="outline">{activeClip?.quarter || 'Unscheduled'}{activeClip?.clock ? ` · ${activeClip.clock}` : ''}</Badge>
                  <strong>{activeClip ? clipLabel(activeClip) : 'No clip selected'}</strong>
                </div>
                <div className="timeline-tools">
                  <Button onClick={() => onNotify('Telestration layer enabled.', 'info')} size="sm" variant="ghost"><Pencil /> Telestrate</Button>
                  <Button disabled={!activeClip} onClick={() => document.getElementById('film-tags')?.focus()} size="sm" variant="ghost"><Tag /> Edit tags</Button>
                  <Button onClick={() => onNavigate('Install')} size="sm" variant="ghost"><Users /> Assign</Button>
                </div>
              </div>
              <div className="mini-timeline">
                <span className="timeline-playhead" />
                {filmClips.map((clip) => <button aria-label={`Clip ${clip.clipNumber}`} className={selectedClip === clip.clipNumber ? 'active' : ''} key={clip.id} onClick={() => chooseClip(clip.clipNumber)} type="button" />)}
              </div>
              <div className="tag-strip">
                <span><b>Unit</b> {activeClip?.odk || '—'}</span><span><b>Down</b> {activeClip?.down ?? '—'}</span><span><b>Concept</b> {activeClip?.concept || '—'}</span><span><b>Result</b> {activeClip?.result || '—'}</span><button onClick={() => document.getElementById('film-tags')?.focus()} type="button"><Plus /> Add tag</button>
              </div>
            </div>
            <aside className="notes-card">
              <div className="panel-title"><div><strong>Teaching notes</strong><span>Visible to offence</span></div><Eye /></div>
              <Textarea aria-label="Teaching note" id="film-note" onChange={(event) => setNote(event.target.value)} placeholder="Add a coaching point for this clip…" value={note} />
              <div className="notes-actions"><span>{note.length}/280</span><Button disabled={!filmAsset} onClick={() => void saveBreakdown(false)} size="sm">Save with clip</Button></div>
            </aside>
          </div>

          <section className="film-stat-sheet" aria-label="Film stat entry">
            <header className="film-sheet-toolbar"><div><p className="eyebrow">Stat entry</p><h3>{activeClip ? `Editing clip ${activeClip.clipNumber}` : `Chart clip ${filmClips.length + 1}`}</h3></div><span>{filmClips.length} saved · spreadsheet entry stays beside the video</span></header>
            <div className="film-sheet-scroll">
              <div className="film-sheet-grid film-sheet-head"><span>Clip</span><span>Unit</span><span>Down</span><span>Dist</span><span>Yard line</span><span>Play / concept</span><span>Qtr</span><span>Clock</span><span>Result</span><span>Tags</span><span>Start / end</span><span>Actions</span></div>
              <div className="film-sheet-grid film-sheet-editor" key={activeClip?.id ?? `new-${filmClips.length}`}>
                <strong>{activeClip ? String(activeClip.clipNumber).padStart(2, '0') : `+${filmClips.length + 1}`}</strong>
                <NativeSelect aria-label="Unit" defaultValue={activeClip?.odk || 'Offence'} id="film-unit"><NativeSelectOption value="Offence">Offence</NativeSelectOption><NativeSelectOption value="Defence">Defence</NativeSelectOption><NativeSelectOption value="Special teams">Special teams</NativeSelectOption></NativeSelect>
                <Input aria-label="Down" defaultValue={activeClip?.down ?? ''} id="film-down" inputMode="numeric" placeholder="1" />
                <Input aria-label="Distance" defaultValue={activeClip?.distance ?? ''} id="film-distance" inputMode="numeric" placeholder="10" />
                <Input aria-label="Yard line" defaultValue={activeClip?.yardLine ?? ''} id="film-yardline" placeholder="H 47" />
                <Input aria-label="Play or concept" defaultValue={activeClip ? clipLabel(activeClip) : ''} id="film-concept" placeholder="Play / concept" />
                <Input aria-label="Quarter" defaultValue={activeClip?.quarter ?? ''} id="film-quarter" placeholder="Q1" />
                <Input aria-label="Clock" defaultValue={activeClip?.clock ?? ''} id="film-clock" placeholder="12:46" />
                <Input aria-label="Result" defaultValue={activeClip?.result ?? ''} id="film-result" placeholder="+6" />
                <Input aria-label="Tags" defaultValue={activeClip?.tags.join(', ') ?? ''} id="film-tags" placeholder="pressure" />
                <div className="film-sheet-time"><Input aria-label="Start seconds" defaultValue={activeClip?.startSeconds ?? 0} id="film-start" inputMode="decimal" /><Input aria-label="End seconds" defaultValue={activeClip?.endSeconds ?? 0} id="film-end" inputMode="decimal" /></div>
                <div className="film-sheet-actions"><Button aria-label="Save clip" disabled={!filmAsset} onClick={() => void saveBreakdown(false)} size="icon-sm"><Check /></Button><Button aria-label="Save and start a new clip" disabled={!filmAsset} onClick={() => void saveBreakdown(true)} size="icon-sm" variant="outline"><Plus /></Button>{activeClip ? <Button aria-label="Delete clip" onClick={() => void deleteChartedClip()} size="icon-sm" variant="ghost"><Trash2 /></Button> : null}</div>
                <input id="film-play" type="hidden" value={activeClip?.playId ?? ''} readOnly />
              </div>
              <div className="film-sheet-saved">{visibleClips.map((clip) => <button className={selectedClip === clip.clipNumber ? 'film-sheet-grid film-sheet-row active' : 'film-sheet-grid film-sheet-row'} key={clip.id} onClick={() => chooseClip(clip.clipNumber)} type="button"><strong>{String(clip.clipNumber).padStart(2, '0')}</strong><span>{clip.odk || '—'}</span><span>{clip.down ?? '—'}</span><span>{clip.distance ?? '—'}</span><span>{clip.yardLine || '—'}</span><span>{clipLabel(clip)}</span><span>{clip.quarter || '—'}</span><span>{clip.clock || '—'}</span><span>{clip.result || '—'}</span><span>{clip.tags.join(', ') || '—'}</span><span>{clip.startSeconds}s / {clip.endSeconds}s</span><span>Open</span></button>)}{!visibleClips.length ? <div className="film-sheet-empty">Enter the first snap in the highlighted row above.</div> : null}</div>
            </div>
          </section>
        </div>
      </div>
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
  family: 'Unassigned' | 'Run' | 'Pass' | 'RPO' | 'Screen';
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

type DiagramSnapshot = {
  routes: DiagramRoute[];
  players: DiagramPlayer[];
  zones: DiagramZone[];
  labels: DiagramLabel[];
  fieldPosition: number;
  showOpponent: boolean;
};

type PlayAssignment = {
  id: string;
  position: string;
  title: string;
  detail: string;
  sortOrder?: number;
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

const CANADIAN_FIELD_TOP = 45;
const CANADIAN_FIELD_BOTTOM = 555;
const CANADIAN_YARD_STEP = (CANADIAN_FIELD_BOTTOM - CANADIAN_FIELD_TOP) / 110;
const yardToDiagramY = (yard: number) => CANADIAN_FIELD_TOP + Math.min(110, Math.max(0, yard)) * CANADIAN_YARD_STEP;
const snapDiagramY = (y: number) => yardToDiagramY(Math.round((y - CANADIAN_FIELD_TOP) / CANADIAN_YARD_STEP));
const canadianFieldLabel = (yard: number) => yard === 55 ? 'C' : yard < 55 ? `Own ${yard}` : `Opp ${110 - yard}`;
const canadianFieldPositions = Array.from({ length: 109 }, (_, index) => index + 1).map((yard) => ({ yard, label: canadianFieldLabel(yard) }));

const defaultDiagramPlayers: DiagramPlayer[] = [
  ...['LT', 'LG', 'C', 'RG', 'RT'].map((label, index) => ({ id: `line-${label}`, label, x: 270 + index * 35, y: yardToDiagramY(57), kind: 'line' as const, colour: '#f3f7fb' })),
  { id: 'skill-x', label: 'X', x: 75, y: yardToDiagramY(57), kind: 'skill', colour: '#30d5c8' },
  { id: 'skill-a', label: 'A', x: 165, y: yardToDiagramY(57), kind: 'skill', colour: '#30d5c8' },
  { id: 'skill-y', label: 'Y', x: 510, y: yardToDiagramY(57), kind: 'skill', colour: '#30d5c8' },
  { id: 'skill-z', label: 'Z', x: 645, y: yardToDiagramY(57), kind: 'skill', colour: '#30d5c8' },
  { id: 'skill-b', label: 'B', x: 575, y: yardToDiagramY(62), kind: 'skill', colour: '#30d5c8' },
  { id: 'quarterback', label: 'Q', x: 340, y: yardToDiagramY(64), kind: 'qb', colour: '#f25f50' },
  { id: 'running-back', label: 'R', x: 380, y: yardToDiagramY(70), kind: 'back', colour: '#ffca45' },
];

async function loadPlaybookData(): Promise<PlaybookPayload> {
  const response = await fetch('/api/playbooks');
  const data = await response.json() as PlaybookPayload & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Unable to load playbooks.');
  return data;
}

const initialStudioBooks: StudioBook[] = [];
const studioFormations: StudioFormation[] = [];
const studioPlays: StudioPlay[] = [];

function StudioPlayDiagram({ play, label = true }: { play: StudioPlay; label?: boolean }) {
  const fieldPosition = play.fieldPosition ?? 55;
  const lineOfScrimmageY = yardToDiagramY(fieldPosition);
  const yardMarks = Array.from({ length: 111 }, (_, yard) => ({ yard, y: yardToDiagramY(yard) }));
  const opponentPlayers: DiagramPlayer[] = play.unit === 'Defence'
    ? defaultDiagramPlayers.map((player) => ({ ...player, id: `opponent-${player.id}`, y: player.y + lineOfScrimmageY - yardToDiagramY(55), colour: '#f4a261' }))
    : [
        ...[80, 145, 210, 275, 345, 415, 480, 545, 610].map((x, index) => ({ id: `opponent-front-${index}`, label: `D${index + 1}`, x, y: snapDiagramY(lineOfScrimmageY - 14), kind: 'line' as const, colour: '#f4a261' })),
        ...[190, 360, 530].map((x, index) => ({ id: `opponent-back-${index}`, label: `D${index + 10}`, x, y: snapDiagramY(lineOfScrimmageY - 56), kind: 'skill' as const, colour: '#f4a261' })),
      ];
  return (
    <svg aria-label={`${play.name} Canadian football diagram`} className="pb-diagram" preserveAspectRatio="xMidYMid meet" viewBox="0 0 720 600">
      <title>{play.name}</title>
      <defs>{(play.routes ?? []).map((route) => <marker id={`route-arrow-${route.id}`} key={route.id} markerHeight="8" markerUnits="userSpaceOnUse" markerWidth="8" orient="auto" refX="7" refY="4" viewBox="0 0 8 8"><path d="M0 0 L0 8 L8 4 z" fill={route.colour} /></marker>)}</defs>
      <rect className="pb-field-base" height="600" width="720" />
      <rect className="pb-field-endzone" height={CANADIAN_FIELD_TOP} width="650" x="35" />
      <rect className="pb-field-endzone bottom" height={600 - CANADIAN_FIELD_BOTTOM} width="650" x="35" y={CANADIAN_FIELD_BOTTOM} />
      <line className="pb-sideline" x1="35" x2="35" y1="1" y2="599" /><line className="pb-sideline" x1="685" x2="685" y1="1" y2="599" /><line className="pb-sideline" x1="35" x2="685" y1="1" y2="1" /><line className="pb-sideline" x1="35" x2="685" y1="599" y2="599" />
      <text className="pb-endzone-name" x="360" y="29">ENDZONE</text><text className="pb-endzone-name bottom" x="360" y="584">ENDZONE</text>
      {yardMarks.map(({ yard, y }) => {
        const major = yard % 10 === 0 || yard === 55;
        const line = yard % 5 === 0;
        const number = yard === 55 ? 'C' : yard % 10 === 0 && yard > 0 && yard < 110 ? String(yard < 55 ? yard : 110 - yard) : '';
        return <g key={yard}>{line ? <line className={`pb-yard-line ${major ? 'major' : 'minor'}`} x1="35" x2="685" y1={y} y2={y} /> : null}<line className="pb-hash" x1="278" x2="286" y1={y} y2={y} /><line className="pb-hash" x1="434" x2="442" y1={y} y2={y} /><line className="pb-yard-tick" x1="35" x2="42" y1={y} y2={y} /><line className="pb-yard-tick" x1="678" x2="685" y1={y} y2={y} />{number ? <><text className="pb-yard-number" x="48" y={y - 4}>{number}</text><text className="pb-yard-number right" x="672" y={y - 4}>{number}</text></> : null}</g>;
      })}
      {(play.zones ?? []).map((zone) => <rect fill={zone.colour} fillOpacity="0.2" height={zone.height} key={zone.id} rx="12" stroke={zone.colour} strokeOpacity="0.8" strokeWidth="2" width={zone.width} x={zone.x} y={zone.y} />)}
      <line className="pb-los" x1="35" x2="685" y1={lineOfScrimmageY} y2={lineOfScrimmageY} />
      {label ? <text className="pb-los-label" x="18" y={lineOfScrimmageY + 3}>{fieldPosition === 55 ? 'C' : 'LOS'}</text> : null}
      {play.showOpponent ? opponentPlayers.map((player) => <g className={`pb-opponent pb-player-${player.kind}`} key={player.id}><circle cx={player.x} cy={player.y} r={player.kind === 'line' || player.kind === 'back' ? 7.5 : 8.5} style={{ fill: player.colour }} /><text x={player.x} y={player.y + 2}>{player.label}</text></g>) : null}
      {(play.players ?? []).map((player) => <g className={`pb-player-${player.kind}`} key={player.id}><circle cx={player.x} cy={player.y} r={player.kind === 'line' || player.kind === 'back' ? 7.5 : 8.5} style={{ fill: player.colour }} /><text x={player.x} y={player.y + 2}>{player.label}</text></g>)}
      {(play.routes ?? []).map((route) => {
        const points = route.points?.length ? route.points : [{ x: route.startX, y: route.startY }, { x: route.endX, y: route.endY }];
        const path = route.lineStyle === 'curve'
          ? `M${points[0].x} ${points[0].y} ${points.slice(1).map((point, index) => { const previous = points[index]; return `Q${(previous.x + point.x) / 2} ${Math.min(previous.y, point.y) - 16} ${point.x} ${point.y}`; }).join(' ')}`
          : `M${points.map((point) => `${point.x} ${point.y}`).join(' L')}`;
        const dash = route.lineStyle === 'dashed' ? '14 9' : route.lineStyle === 'dotted' ? '3 8' : undefined;
        return <path d={path} fill="none" key={route.id} markerEnd={`url(#route-arrow-${route.id})`} stroke={route.colour} strokeDasharray={dash} strokeLinecap="round" strokeWidth="4" />;
      })}
      {(play.labels ?? []).map((item) => <text fill={item.colour} fontSize="14" fontWeight="700" key={item.id} textAnchor="middle" x={item.x} y={item.y}>{item.text}</text>)}
    </svg>
  );
}

function PlayAssignmentsEditor({ assignments, editing, onChange }: { assignments: PlayAssignment[]; editing: boolean; onChange: (assignments: PlayAssignment[]) => void }) {
  const addAssignment = () => onChange([...assignments, { id: crypto.randomUUID(), position: `P${assignments.length + 1}`, title: 'New assignment', detail: '' }]);
  return <>
    <div className="property-title"><strong>Assignments</strong>{editing ? <Button onClick={addAssignment} size="xs" variant="ghost"><Plus /> Add</Button> : null}</div>
    <div className="assignment-list">
      {assignments.map((assignment, index) => editing ? <div className="assignment-edit-row" key={assignment.id}>
        <Input aria-label={`Assignment ${index + 1} position`} onChange={(event) => onChange(assignments.map((item) => item.id === assignment.id ? { ...item, position: event.target.value.toUpperCase() } : item))} value={assignment.position} />
        <Input aria-label={`Assignment ${index + 1} title`} onChange={(event) => onChange(assignments.map((item) => item.id === assignment.id ? { ...item, title: event.target.value } : item))} value={assignment.title} />
        <Input aria-label={`Assignment ${index + 1} detail`} onChange={(event) => onChange(assignments.map((item) => item.id === assignment.id ? { ...item, detail: event.target.value } : item))} value={assignment.detail} />
        <Button aria-label={`Remove ${assignment.position} assignment`} onClick={() => onChange(assignments.filter((item) => item.id !== assignment.id))} size="icon-xs" variant="ghost"><Trash2 /></Button>
      </div> : <button key={assignment.id} type="button"><span className="position-pill">{assignment.position}</span><div><strong>{assignment.title}</strong><small>{assignment.detail || 'No detail yet'}</small></div><ChevronRight /></button>)}
      {assignments.length === 0 ? <div className="viewer-empty-state compact"><ClipboardList /><strong>No assignments yet</strong><span>{editing ? 'Add the first position assignment.' : 'Edit this play to add assignments.'}</span></div> : null}
    </div>
  </>;
}

function PlaybookView({ focusMode, onNavigate, onNotify, onToggleFocus, onEditingChange }: { focusMode: boolean; onNavigate: (view: string) => void; onNotify: Notify; onToggleFocus: () => void; onEditingChange: (editing: boolean) => void }) {
  const [screen, setScreen] = useState<'library' | 'browser' | 'formations' | 'viewer' | 'editor'>('library');
  const [books, setBooks] = useState<StudioBook[]>(initialStudioBooks);
  const [formations, setFormations] = useState<StudioFormation[]>(studioFormations);
  const [plays, setPlays] = useState<StudioPlay[]>(studioPlays);
  const [playbookLoading, setPlaybookLoading] = useState(true);
  const [playbookError, setPlaybookError] = useState('');
  const [bookTab, setBookTab] = useState<'Active' | 'Archived'>('Active');
  const [activeBookId, setActiveBookId] = useState('');
  const [navMode, setNavMode] = useState<'Formations' | 'Categories'>('Formations');
  const [selectedFormation, setSelectedFormation] = useState('All formations');
  const [selectedCategory, setSelectedCategory] = useState('All plays');
  const [selectedPlayId, setSelectedPlayId] = useState('');
  const [query, setQuery] = useState('');
  const [tool, setTool] = useState('Select');
  const [draftRoutes, setDraftRoutes] = useState<DiagramRoute[]>([]);
  const [draftPlayers, setDraftPlayers] = useState<DiagramPlayer[]>(defaultDiagramPlayers);
  const [draftZones, setDraftZones] = useState<DiagramZone[]>([]);
  const [draftLabels, setDraftLabels] = useState<DiagramLabel[]>([]);
  const [draftAssignments, setDraftAssignments] = useState<PlayAssignment[]>([]);
  const [selectedElement, setSelectedElement] = useState('');
  const [undoStack, setUndoStack] = useState<DiagramSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<DiagramSnapshot[]>([]);
  const dragElementRef = useRef<{ kind: 'player' | 'zone' | 'label' | 'route'; id: string } | null>(null);
  const suppressCanvasClickRef = useRef(false);
  const [saved, setSaved] = useState(false);
  const [playSaving, setPlaySaving] = useState(false);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const [deleteAction, setDeleteAction] = useState<'play' | 'book' | 'formation' | null>(null);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const [createBookOpen, setCreateBookOpen] = useState(false);
  const [bookSettingsOpen, setBookSettingsOpen] = useState(false);
  const [formationDialogOpen, setFormationDialogOpen] = useState(false);
  const [editingFormation, setEditingFormation] = useState<StudioFormation | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [draftName, setDraftName] = useState('');
  const [draftFormation, setDraftFormation] = useState('');
  const [draftFamily, setDraftFamily] = useState<StudioPlay['family']>('Unassigned');
  const [draftConcept, setDraftConcept] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftFieldPosition, setDraftFieldPosition] = useState(55);
  const [draftShowOpponent, setDraftShowOpponent] = useState(false);
  const [paletteColour, setPaletteColour] = useState('#f25f50');
  const [lineStyle, setLineStyle] = useState<DiagramRoute['lineStyle']>('solid');
  const [activeRouteId, setActiveRouteId] = useState('');
  const [routeAnchorPlayerId, setRouteAnchorPlayerId] = useState('');
  const [installPackages, setInstallPackages] = useState<InstallPackage[]>([]);
  const [installPackageId, setInstallPackageId] = useState('');
  const [installedPlayIds, setInstalledPlayIds] = useState<string[]>([]);
  const activeBook = books.find((book) => book.id === activeBookId) ?? books[0];
  const currentPlay = plays.find((play) => play.id === selectedPlayId) ?? plays[0];
  const [selectedKind, selectedId] = selectedElement.split(':');
  const selectedPlayer = selectedKind === 'player' ? draftPlayers.find((item) => item.id === selectedId) : undefined;
  const selectedZone = selectedKind === 'zone' ? draftZones.find((item) => item.id === selectedId) : undefined;
  const selectedLabel = selectedKind === 'label' ? draftLabels.find((item) => item.id === selectedId) : undefined;
  const selectedRoute = selectedKind === 'route' ? draftRoutes.find((item) => item.id === selectedId) : undefined;
  const filteredPlays = plays.filter((play) => {
    const matchesQuery = `${play.name} ${play.formation} ${play.family} ${play.concept}`.toLowerCase().includes(query.toLowerCase());
    const matchesBook = (play.playbookId ?? '') === activeBookId;
    const matchesFormation = navMode !== 'Formations' || selectedFormation === 'All formations' || play.formation === selectedFormation;
    const matchesCategory = navMode !== 'Categories' || selectedCategory === 'All plays' || play.category === selectedCategory;
    return matchesBook && matchesQuery && matchesFormation && matchesCategory;
  });
  const studioCategories = [{ name: 'All plays', count: plays.length }, ...Array.from(new Set(plays.map((play) => play.category).filter(Boolean))).map((name) => ({ name, count: plays.filter((play) => play.category === name).length }))];

  useEffect(() => {
    loadPlaybookData()
      .then((saved) => { setBooks(saved.books); setFormations(saved.formations); setPlays(saved.plays); })
      .catch(() => setPlaybookError('Saved playbooks could not be loaded. Reopen Playbook to retry.'))
      .finally(() => setPlaybookLoading(false));
    fetch('/api/install').then(async (response) => { if (!response.ok) throw new Error('Unable to load installs.'); return await response.json() as { packages: InstallPackage[] }; }).then((data) => setInstallPackages(data.packages)).catch(() => onNotify('Install choices could not be loaded. Open Installs to retry.', 'warning'));
  }, [onNotify]);

  useEffect(() => {
    if (!installPackageId) return;
    let active = true;
    fetch(`/api/install?packageId=${encodeURIComponent(installPackageId)}`).then(async (response) => { if (!response.ok) throw new Error('Unable to load install.'); return await response.json() as { items: { playId: string | null }[] }; }).then((data) => { if (active) setInstalledPlayIds(data.items.flatMap((item) => item.playId ? [item.playId] : [])); }).catch(() => { if (active) { setInstalledPlayIds([]); onNotify('This install could not be loaded.', 'warning'); } });
    return () => { active = false; };
  }, [installPackageId, onNotify]);

  const prepareDraft = (play: StudioPlay) => {
    setDraftName(play.name);
    setDraftFormation(play.formation);
    setDraftFamily(play.family);
    setDraftConcept(play.concept);
    setDraftNotes(play.notes ?? '');
    setDraftFieldPosition(play.fieldPosition ?? 55);
    setDraftShowOpponent(Boolean(play.showOpponent));
    setDraftRoutes(play.routes ?? []);
    setDraftPlayers(play.players?.length ? play.players : defaultDiagramPlayers.map((player) => ({ ...player })));
    setDraftZones(play.zones ?? []);
    setDraftLabels(play.labels ?? []);
    setDraftAssignments(play.assignments ?? []);
    setSelectedElement('');
    setActiveRouteId('');
    setRouteAnchorPlayerId('');
    setUndoStack([]);
    setRedoStack([]);
  };

  const openBook = (book: StudioBook) => {
    setActiveBookId(book.id);
    setNavMode('Formations');
    setSelectedFormation('All formations');
    setScreen('browser');
  };

  const openPlay = (play: StudioPlay) => {
    setSelectedPlayId(play.id);
    prepareDraft(play);
    setScreen('viewer');
  };

  const savePlay = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const cancelEditing = () => {
    setDiscardAction(() => () => { prepareDraft(currentPlay); setTool('Select'); setScreen('viewer'); });
  };

  useEffect(() => {
    onEditingChange(screen === 'editor');
    return () => onEditingChange(false);
  }, [screen, onEditingChange]);

  useEffect(() => {
    if (screen !== 'editor') return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [screen]);

  const duplicatePlay = async () => {
    if (playSaving) return;
    setPlaySaving(true);
    try {
      const response = await fetch('/api/playbooks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'duplicate', id: currentPlay.id }) });
      const data = await response.json() as PlaybookPayload & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Unable to duplicate play.');
      const copy = data.plays.find((play) => play.id === data.createdId);
      if (!copy) throw new Error('The copy could not be opened.');
      setBooks(data.books); setFormations(data.formations); setPlays(data.plays); setSelectedPlayId(copy.id); prepareDraft(copy); setScreen('editor');
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Unable to duplicate play.', 'error'); }
    finally { setPlaySaving(false); }
  };

  const saveAndCloseEditing = async () => {
    if (playSaving) return;
    setPlaySaving(true);
    try {
      if (!draftName.trim() || !draftConcept.trim()) throw new Error('Enter a play name and concept before saving.');
      const formation = formations.find((item) => item.name === draftFormation);
      const response = await fetch('/api/playbooks', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        ...currentPlay, name: draftName.trim() || currentPlay.name, formationId: formation?.id ?? null,
        formation: draftFormation, family: draftFamily, concept: draftConcept.trim() || currentPlay.concept, notes: draftNotes,
        routes: draftRoutes, players: draftPlayers, zones: draftZones, labels: draftLabels, assignments: draftAssignments,
        fieldPosition: draftFieldPosition, showOpponent: draftShowOpponent,
      }) });
      const data = await response.json() as PlaybookPayload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Unable to save play.');
      setBooks(data.books); setFormations(data.formations); setPlays(data.plays);
      savePlay(); setTool('Select'); setScreen('viewer');
      onNotify(`${draftName.trim() || currentPlay.name} saved.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to save play.', 'warning');
    } finally { setPlaySaving(false); }
  };

  const createPlaybook = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = fields.get('playbookName');
    const side = fields.get('playbookSide');
    if (typeof name !== 'string' || !name.trim()) return;
    try {
      const response = await fetch('/api/playbooks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'book', name: name.trim(), side }) });
      const data = await response.json() as PlaybookPayload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Unable to create playbook.');
      setBooks(data.books); setFormations(data.formations); setPlays(data.plays); setCreateBookOpen(false);
      const newBook = data.books.find((book) => book.name === name.trim()) ?? data.books[0];
      if (!newBook) throw new Error('The new playbook could not be opened.');
      openBook(newBook); onNotify(`${newBook.name} created.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to create playbook.', 'warning');
    }
  };

  const saveBookSettings = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/playbooks', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        kind: 'book', id: activeBook.id, name: fields.get('bookName'), side: fields.get('bookSide'), archived: fields.get('bookArchived') === 'on',
      }) });
      const data = await response.json() as PlaybookPayload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Unable to update playbook.');
      setBooks(data.books); setFormations(data.formations); setPlays(data.plays); setBookSettingsOpen(false); setScreen('library');
      onNotify(`${activeBook.name} updated.`);
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Unable to update playbook.', 'warning'); }
  };

  const saveFormation = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const formationName = fields.get('formationName');
    try {
      const response = await fetch('/api/playbooks', { method: editingFormation ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        kind: 'formation', id: editingFormation?.id, name: fields.get('formationName'), personnel: fields.get('formationPersonnel'),
        unit: activeBook.side === 'Scout' ? 'Scout' : activeBook.side, players: editingFormation?.players?.length ? editingFormation.players : defaultDiagramPlayers,
      }) });
      const data = await response.json() as PlaybookPayload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Unable to save formation.');
      setBooks(data.books); setFormations(data.formations); setPlays(data.plays); setFormationDialogOpen(false); setEditingFormation(null);
      onNotify(`${typeof formationName === 'string' ? formationName : 'Formation'} saved.`);
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Unable to save formation.', 'warning'); }
  };

  const deleteFormation = async () => {
    if (!editingFormation) return;
    try {
      const response = await fetch('/api/playbooks', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'formation', id: editingFormation.id }) });
      const data = await response.json() as PlaybookPayload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Unable to delete formation.');
      setBooks(data.books); setFormations(data.formations); setPlays(data.plays); setFormationDialogOpen(false); setEditingFormation(null);
      setDeleteAction(null); onNotify(`${editingFormation.name} deleted.`, 'info');
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Unable to delete formation.', 'warning'); }
  };

  const deleteBook = async () => {
    try {
      const response = await fetch('/api/playbooks', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'book', id: activeBook.id }) });
      const data = await response.json() as PlaybookPayload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Unable to delete playbook.');
      setBooks(data.books); setFormations(data.formations); setPlays(data.plays); setBookSettingsOpen(false); setActiveBookId(data.books[0]?.id ?? 'offence'); setScreen('library');
      setDeleteAction(null); onNotify(`${activeBook.name} deleted.`, 'info');
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Unable to delete playbook.', 'warning'); }
  };

  const deleteCurrentPlay = async () => {
    try {
      const response = await fetch('/api/playbooks', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'play', id: currentPlay.id }) });
      const data = await response.json() as PlaybookPayload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Unable to delete play.');
      setBooks(data.books); setFormations(data.formations); setPlays(data.plays); setSelectedPlayId(data.plays[0]?.id ?? ''); setScreen('browser');
      setDeleteAction(null); onNotify(`${currentPlay.name} deleted.`, 'info');
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Unable to delete play.', 'warning'); }
  };

  const beginNewPlay = async () => {
    const formationName = selectedFormation === 'All formations' ? formations[0]?.name ?? '' : selectedFormation;
    const formation = formations.find((item) => item.name === formationName);
    try {
      const response = await fetch('/api/playbooks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        kind: 'play', playbookId: activeBookId, name: 'Untitled play', formationId: formation?.id,
        category: selectedCategory === 'All plays' ? 'Uncategorized' : selectedCategory, family: 'Unassigned', concept: 'New concept',
      }) });
      const data = await response.json() as PlaybookPayload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Unable to create play.');
      setBooks(data.books); setFormations(data.formations); setPlays(data.plays);
      const play = data.plays.find((item) => item.id === data.createdId) ?? data.plays.at(-1);
      if (!play) throw new Error('The new play could not be opened.');
      setSelectedPlayId(play.id); prepareDraft(play); setScreen('editor');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to create play.', 'warning');
    }
  };

  const nextPlay = (direction: number) => {
    const bookPlays = plays.filter((play) => play.playbookId === activeBookId);
    if (!bookPlays.length) return;
    const currentIndex = bookPlays.findIndex((play) => play.id === currentPlay.id);
    const nextIndex = (currentIndex + direction + bookPlays.length) % bookPlays.length;
    const next = bookPlays[nextIndex];
    setSelectedPlayId(next.id);
    prepareDraft(next);
  };

  const diagramSnapshot = (): DiagramSnapshot => ({ routes: draftRoutes, players: draftPlayers, zones: draftZones, labels: draftLabels, fieldPosition: draftFieldPosition, showOpponent: draftShowOpponent });
  const restoreSnapshot = (snapshot: ReturnType<typeof diagramSnapshot>) => {
    setDraftRoutes(snapshot.routes); setDraftPlayers(snapshot.players); setDraftZones(snapshot.zones); setDraftLabels(snapshot.labels); setDraftFieldPosition(snapshot.fieldPosition); setDraftShowOpponent(snapshot.showOpponent);
  };
  const rememberDiagram = () => { setUndoStack((items) => [...items.slice(-24), diagramSnapshot()]); setRedoStack([]); };
  const undoDiagram = () => {
    const previous = undoStack.at(-1); if (!previous) return;
    setRedoStack((items) => [...items, diagramSnapshot()]); restoreSnapshot(previous); setUndoStack((items) => items.slice(0, -1));
  };
  const redoDiagram = () => {
    const next = redoStack.at(-1); if (!next) return;
    setUndoStack((items) => [...items, diagramSnapshot()]); restoreSnapshot(next); setRedoStack((items) => items.slice(0, -1));
  };
  const deleteSelected = () => {
    if (!selectedElement && !draftRoutes.length) return;
    rememberDiagram();
    const [kind, id] = selectedElement.split(':');
    if (kind === 'player') setDraftPlayers((items) => items.filter((item) => item.id !== id));
    else if (kind === 'zone') setDraftZones((items) => items.filter((item) => item.id !== id));
    else if (kind === 'label') setDraftLabels((items) => items.filter((item) => item.id !== id));
    else if (kind === 'route') { setDraftRoutes((items) => items.filter((item) => item.id !== id)); if (activeRouteId === id) setActiveRouteId(''); }
    else setDraftRoutes((items) => items.slice(0, -1));
    setSelectedElement('');
  };

  const activateDiagramTool = (nextTool: string) => {
    if (nextTool === 'Route') {
      const anchorId = selectedPlayer?.id ?? (selectedRoute?.playerId || routeAnchorPlayerId);
      if (!anchorId) {
        setTool('Select');
        onNotify('Select a player first, then choose Route.', 'info');
        return;
      }
      setRouteAnchorPlayerId(anchorId);
      setActiveRouteId('');
    } else if (nextTool !== 'Select') {
      setActiveRouteId('');
      setRouteAnchorPlayerId('');
    }
    setTool(nextTool);
  };

  const finishActiveRoute = () => {
    setActiveRouteId('');
    setRouteAnchorPlayerId('');
    setTool('Select');
  };

  const duplicateSelected = () => {
    if (!selectedElement) return;
    rememberDiagram();
    const id = crypto.randomUUID();
    if (selectedPlayer) {
      const copy = { ...selectedPlayer, id, x: Math.min(675, selectedPlayer.x + 18), y: snapDiagramY(Math.min(CANADIAN_FIELD_BOTTOM, selectedPlayer.y + CANADIAN_YARD_STEP * 2)) };
      setDraftPlayers((items) => [...items, copy]); setSelectedElement(`player:${id}`);
    } else if (selectedRoute) {
      const points = (selectedRoute.points?.length ? selectedRoute.points : [{ x: selectedRoute.startX, y: selectedRoute.startY }, { x: selectedRoute.endX, y: selectedRoute.endY }]).map((point) => ({ x: Math.min(675, point.x + 14), y: snapDiagramY(point.y + CANADIAN_YARD_STEP * 2) }));
      setDraftRoutes((items) => [...items, { ...selectedRoute, id, playerId: undefined, points, startX: points[0].x, startY: points[0].y, endX: points.at(-1)!.x, endY: points.at(-1)!.y }]); setSelectedElement(`route:${id}`);
    } else if (selectedZone) {
      setDraftZones((items) => [...items, { ...selectedZone, id, x: Math.min(675 - selectedZone.width, selectedZone.x + 16), y: Math.min(CANADIAN_FIELD_BOTTOM - selectedZone.height, selectedZone.y + 16) }]); setSelectedElement(`zone:${id}`);
    } else if (selectedLabel) {
      setDraftLabels((items) => [...items, { ...selectedLabel, id, x: Math.min(675, selectedLabel.x + 16), y: Math.min(CANADIAN_FIELD_BOTTOM, selectedLabel.y + 16) }]); setSelectedElement(`label:${id}`);
    }
  };

  const changeFieldPosition = (nextPosition: number) => {
    if (nextPosition === draftFieldPosition) return;
    rememberDiagram();
    const deltaY = yardToDiagramY(nextPosition) - yardToDiagramY(draftFieldPosition);
    const shiftY = (y: number) => snapDiagramY(Math.min(CANADIAN_FIELD_BOTTOM, Math.max(CANADIAN_FIELD_TOP, y + deltaY)));
    setDraftPlayers((items) => items.map((item) => ({ ...item, y: shiftY(item.y) })));
    setDraftRoutes((items) => items.map((item) => { const points = (item.points?.length ? item.points : [{ x: item.startX, y: item.startY }, { x: item.endX, y: item.endY }]).map((point) => ({ ...point, y: shiftY(point.y) })); return { ...item, points, startY: points[0].y, endY: points.at(-1)!.y }; }));
    setDraftZones((items) => items.map((item) => ({ ...item, y: Math.min(CANADIAN_FIELD_BOTTOM - item.height, Math.max(CANADIAN_FIELD_TOP, item.y + deltaY)) })));
    setDraftLabels((items) => items.map((item) => ({ ...item, y: Math.min(CANADIAN_FIELD_BOTTOM, Math.max(CANADIAN_FIELD_TOP, item.y + deltaY)) })));
    setDraftFieldPosition(nextPosition);
  };

  const addCurrentPlayToInstall = async () => {
    try {
      const response = await fetch('/api/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playId: currentPlay.id, packageId: installPackageId }) });
      const data = await response.json() as { package?: { name?: string } | null; items?: { playId?: string | null }[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Unable to add this play to install.');
      setInstalledPlayIds((data.items ?? []).flatMap((item) => item.playId ? [item.playId] : []));
      onNotify(`${currentPlay.name} added to ${data.package?.name ?? 'the current install'}.`);
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Unable to add this play to install.', 'warning'); }
  };

  const handleCanvas = (event: MouseEvent<HTMLButtonElement>) => {
    if (screen !== 'editor') return;
    if (suppressCanvasClickRef.current) { suppressCanvasClickRef.current = false; return; }
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY);
    if (!point) return;
    const x = point.x;
    const y = snapDiagramY(point.y);
    if (tool === 'Route') {
      const clickedPlayer = draftPlayers.find((player) => Math.hypot(player.x - x, player.y - y) < 22);
      if (!activeRouteId && clickedPlayer) { setRouteAnchorPlayerId(clickedPlayer.id); setSelectedElement(`player:${clickedPlayer.id}`); return; }
      const anchor = draftPlayers.find((player) => player.id === routeAnchorPlayerId);
      if (!activeRouteId && !anchor) { onNotify('Select a player to anchor this route.', 'info'); setTool('Select'); return; }
      rememberDiagram();
      if (activeRouteId) {
        setDraftRoutes((routes) => routes.map((route) => { if (route.id !== activeRouteId) return route; const points = route.points?.length ? route.points : [{ x: route.startX, y: route.startY }, { x: route.endX, y: route.endY }]; const nextPoints = [...points, { x, y }]; return { ...route, points: nextPoints, endX: x, endY: y }; }));
        setSelectedElement(`route:${activeRouteId}`);
      } else if (anchor) {
        const id = crypto.randomUUID();
        setDraftRoutes((routes) => [...routes, { id, playerId: anchor.id, startX: anchor.x, startY: anchor.y, endX: x, endY: y, points: [{ x: anchor.x, y: anchor.y }, { x, y }], colour: anchor.colour ?? paletteColour, lineStyle }]);
        setActiveRouteId(id); setSelectedElement(`route:${id}`);
      }
    } else if (tool === 'Player') {
      rememberDiagram(); const id = crypto.randomUUID();
      setDraftPlayers((items) => [...items, { id, label: `P${items.length + 1}`, x, y, kind: 'skill', colour: paletteColour }]); setSelectedElement(`player:${id}`);
    } else if (tool === 'Zone') {
      rememberDiagram(); const id = crypto.randomUUID();
      setDraftZones((items) => [...items, { id, x: Math.max(35, x - 55), y: Math.max(105, y - 35), width: 110, height: 70, colour: paletteColour }]); setSelectedElement(`zone:${id}`);
    } else if (tool === 'Label') {
      rememberDiagram(); const id = crypto.randomUUID();
      setDraftLabels((items) => [...items, { id, x, y, text: `Label ${items.length + 1}`, colour: paletteColour }]); setSelectedElement(`label:${id}`);
    }
  };

  const canvasPoint = (element: HTMLButtonElement, clientX: number, clientY: number) => {
    const diagram = element.querySelector<SVGSVGElement>('.pb-diagram');
    if (!diagram) return null;
    const matrix = diagram.getScreenCTM();
    if (!matrix) return null;
    const svgPoint = diagram.createSVGPoint();
    svgPoint.x = clientX; svgPoint.y = clientY;
    const local = svgPoint.matrixTransform(matrix.inverse());
    return {
      x: Math.max(35, Math.min(685, local.x)),
      y: Math.max(CANADIAN_FIELD_TOP, Math.min(CANADIAN_FIELD_BOTTOM, local.y)),
    };
  };

  const startDiagramDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (screen !== 'editor' || tool !== 'Select') return;
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY); if (!point) return;
    const route = draftRoutes.find((item) => Math.hypot(item.endX - point.x, item.endY - point.y) < 24);
    const player = draftPlayers.find((item) => Math.hypot(item.x - point.x, item.y - point.y) < 22);
    const label = draftLabels.find((item) => Math.hypot(item.x - point.x, item.y - point.y) < 32);
    const zone = [...draftZones].reverse().find((item) => point.x >= item.x && point.x <= item.x + item.width && point.y >= item.y && point.y <= item.y + item.height);
    const target = player ? { kind: 'player' as const, id: player.id } : route ? { kind: 'route' as const, id: route.id } : label ? { kind: 'label' as const, id: label.id } : zone ? { kind: 'zone' as const, id: zone.id } : null;
    setSelectedElement(target ? `${target.kind}:${target.id}` : '');
    if (route) { setPaletteColour(route.colour); setLineStyle(route.lineStyle); }
    else if (player?.colour) setPaletteColour(player.colour);
    suppressCanvasClickRef.current = true;
    if (!target) return;
    rememberDiagram(); dragElementRef.current = target; event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDiagramItem = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const target = dragElementRef.current; if (!target) return;
    const point = canvasPoint(event.currentTarget, event.clientX, event.clientY); if (!point) return;
    if (target.kind === 'player') {
      const snappedPoint = { x: point.x, y: snapDiagramY(point.y) };
      setDraftPlayers((items) => items.map((item) => item.id === target.id ? { ...item, ...snappedPoint } : item));
      setDraftRoutes((items) => items.map((item) => { if (item.playerId !== target.id) return item; const points = item.points?.length ? [...item.points] : [{ x: item.startX, y: item.startY }, { x: item.endX, y: item.endY }]; points[0] = snappedPoint; return { ...item, points, startX: snappedPoint.x, startY: snappedPoint.y }; }));
    }
    if (target.kind === 'label') setDraftLabels((items) => items.map((item) => item.id === target.id ? { ...item, ...point } : item));
    if (target.kind === 'route') setDraftRoutes((items) => items.map((item) => { if (item.id !== target.id) return item; const snappedPoint = { x: point.x, y: snapDiagramY(point.y) }; const points = item.points?.length ? [...item.points] : [{ x: item.startX, y: item.startY }, { x: item.endX, y: item.endY }]; points[points.length - 1] = snappedPoint; return { ...item, points, endX: snappedPoint.x, endY: snappedPoint.y }; }));
    if (target.kind === 'zone') setDraftZones((items) => items.map((item) => item.id === target.id ? { ...item, x: point.x - item.width / 2, y: point.y - item.height / 2 } : item));
  };

  const endDiagramDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragElementRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragElementRef.current = null;
  };

  const chooseDiagramColour = (colour: string) => {
    setPaletteColour(colour);
    if (!selectedElement) return;
    rememberDiagram();
    if (selectedRoute) setDraftRoutes((items) => items.map((item) => item.id === selectedRoute.id ? { ...item, colour } : item));
    if (selectedPlayer) setDraftPlayers((items) => items.map((item) => item.id === selectedPlayer.id ? { ...item, colour } : item));
    if (selectedZone) setDraftZones((items) => items.map((item) => item.id === selectedZone.id ? { ...item, colour } : item));
    if (selectedLabel) setDraftLabels((items) => items.map((item) => item.id === selectedLabel.id ? { ...item, colour } : item));
  };
  const chooseDiagramLineStyle = (style: DiagramRoute['lineStyle']) => {
    setLineStyle(style);
    if (!selectedRoute) return;
    rememberDiagram(); setDraftRoutes((items) => items.map((item) => item.id === selectedRoute.id ? { ...item, lineStyle: style } : item));
  };

  if (screen === 'library') {
    const visibleBooks = books.filter((book) => book.archived === (bookTab === 'Archived'));
    return (
      <section className="module-surface playbook-surface pb-redesign">
        <Dialog open={deleteAction !== null} onOpenChange={(open) => { if (!open) setDeleteAction(null); }}><DialogContent className="athlete-dialog"><DialogHeader><DialogTitle>Delete {deleteAction}?</DialogTitle><DialogDescription>This permanently removes the selected record. Plays used in installs cannot be deleted.</DialogDescription></DialogHeader><DialogFooter><Button onClick={() => setDeleteAction(null)} variant="outline">Cancel</Button><Button variant="destructive" onClick={() => void (deleteAction === 'book' ? deleteBook() : deleteAction === 'formation' ? deleteFormation() : deleteCurrentPlay())}>Delete</Button></DialogFooter></DialogContent></Dialog>
        <div className="pb-hub">
          {playbookLoading ? <p className="channel-empty">Loading playbooks…</p> : null}
          {playbookError ? <p className="install-feedback error" role="alert">{playbookError}</p> : null}
          <header className="pb-hub-header"><div><h1>Playbooks</h1><span>Team systems and scout collections.</span></div><div className="pb-header-actions"><FocusModeButton focused={focusMode} onToggle={onToggleFocus} /><Button onClick={() => setCreateBookOpen(true)}><Plus /> New playbook</Button></div></header>
          <div className="pb-book-tabs"><button className={bookTab === 'Active' ? 'active' : ''} onClick={() => setBookTab('Active')} type="button">Team &amp; scout <span>{books.filter((book) => !book.archived).length}</span></button><button className={bookTab === 'Archived' ? 'active' : ''} onClick={() => setBookTab('Archived')} type="button">Archived <span>{books.filter((book) => book.archived).length}</span></button></div>
          <div className="pb-book-list">
            {visibleBooks.map((book, index) => <button className="pb-book-row" key={book.id} onClick={() => openBook(book)} type="button"><span className={`pb-book-index side-${book.side.toLowerCase().replace(' ','-')}`}>{book.side === 'Scout' ? 'SC' : String(index + 1).padStart(2, '0')}</span><span className="pb-book-copy"><strong>{book.name}</strong><small>{book.side === 'Scout' ? 'Opponent library' : 'Team system'} · {book.plays} plays · {book.formations} formations</small></span><span className="pb-book-updated">{new Date(book.updated).toLocaleDateString()}</span><span className="pb-book-actions"><ChevronRight /></span></button>)}
            {visibleBooks.length === 0 ? <div className="pb-empty"><BookOpen /><strong>{bookTab === 'Archived' ? 'No archived playbooks' : 'No playbooks yet'}</strong><span>{bookTab === 'Archived' ? 'Archived collections will stay available here.' : 'Create the first real team or scout playbook.'}</span>{bookTab === 'Active' ? <Button onClick={() => setCreateBookOpen(true)}><Plus /> New playbook</Button> : null}</div> : null}
          </div>
        </div>
        <Dialog onOpenChange={setCreateBookOpen} open={createBookOpen}><DialogContent className="athlete-dialog sm:max-w-[520px]"><form onSubmit={createPlaybook}><DialogHeader><DialogTitle>New playbook</DialogTitle><DialogDescription>Create a clean collection for a system, season, or opponent.</DialogDescription></DialogHeader><div className="athlete-form-grid"><label className="full" htmlFor="new-playbook-name">Name<Input id="new-playbook-name" name="playbookName" placeholder="2026 Weekly Offence" required /></label><label className="full" htmlFor="new-playbook-side">System<NativeSelect defaultValue="Offence" id="new-playbook-side" name="playbookSide"><NativeSelectOption value="Offence">Offence</NativeSelectOption><NativeSelectOption value="Defence">Defence</NativeSelectOption><NativeSelectOption value="Special teams">Special teams</NativeSelectOption><NativeSelectOption value="Scout">Scout plays</NativeSelectOption></NativeSelect></label></div><DialogFooter><Button type="submit">Create playbook <ChevronRight /></Button></DialogFooter></form></DialogContent></Dialog>
      </section>
    );
  }

  if (screen === 'browser' || screen === 'formations') {
    return (
      <section className="module-surface playbook-surface pb-redesign">
        <div className="pb-browser-shell">
        <Dialog open={deleteAction !== null} onOpenChange={(open) => { if (!open) setDeleteAction(null); }}><DialogContent className="athlete-dialog"><DialogHeader><DialogTitle>Delete {deleteAction}?</DialogTitle><DialogDescription>This permanently removes the selected record. Plays used in installs cannot be deleted.</DialogDescription></DialogHeader><DialogFooter><Button onClick={() => setDeleteAction(null)} variant="outline">Cancel</Button><Button variant="destructive" onClick={() => void (deleteAction === 'book' ? deleteBook() : deleteAction === 'formation' ? deleteFormation() : deleteCurrentPlay())}>Delete</Button></DialogFooter></DialogContent></Dialog>
          <header className="pb-context-bar"><button className="pb-back" onClick={() => setScreen(screen === 'formations' ? 'browser' : 'library')} type="button"><ArrowLeft /></button><div><span>{activeBook.side} playbook</span><strong>{screen === 'formations' ? 'Formations' : activeBook.name}</strong></div><div className="pb-context-actions"><FocusModeButton focused={focusMode} onToggle={onToggleFocus} /><button onClick={() => setBookSettingsOpen(true)} title="Playbook settings" type="button"><Settings /></button><button onClick={() => { downloadText(`${activeBook.id}-playbook.json`, JSON.stringify({ book: activeBook, plays: plays.filter((play) => (play.playbookId ?? activeBook.id) === activeBook.id) }, null, 2), 'application/json'); onNotify('Playbook backup downloaded.'); }} title="Download playbook" type="button"><Download /></button><Button size="sm" onClick={beginNewPlay}><Plus /> New play</Button></div></header>
          {screen === 'formations' ? <main className="pb-formations-main"><div className="pb-section-heading"><div><p className="eyebrow">Formation library</p><h2>Every alignment at a glance</h2><span>Create and edit saved Canadian-football alignments.</span></div><div className="toolbar-search"><Search /><Input aria-label="Search formations" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search formations…" /></div></div><div className="pb-formation-grid"><button className="pb-new-tile" onClick={() => { setEditingFormation(null); setFormationDialogOpen(true); }} type="button"><Plus /><strong>New formation</strong><span>Start with your team’s alignment</span></button>{formations.filter((item) => `${item.name} ${item.personnel}`.toLowerCase().includes(query.toLowerCase())).map((item) => { const sample = plays.find((play) => play.formation === item.name) ?? { id: `formation-preview-${item.id}`, name: item.name, formation: item.name, category: 'Formation', family: 'Pass' as const, concept: item.personnel, variant: item.variant ?? 0, players: item.players }; return <button className="pb-formation-card" key={item.name} onClick={() => { setEditingFormation(item); setFormationDialogOpen(true); }} type="button"><span className="pb-card-number">{String(formations.indexOf(item) + 1).padStart(2, '0')}</span><span className="pb-card-menu"><Pencil /></span><div className="pb-card-diagram"><StudioPlayDiagram label={false} play={sample} /></div><footer><strong>{item.name}</strong><span>{item.personnel} · {item.count} plays</span></footer></button>; })}</div></main> : <div className="pb-browser-body">
            <aside className="pb-filter-rail"><div className="pb-active-book-summary"><span className={`pb-book-index side-${activeBook.side.toLowerCase().replace(' ','-')}`}>{activeBook.side === 'Scout' ? 'SC' : activeBook.side.slice(0,1)}</span><div><strong>{activeBook.name}</strong><small>{activeBook.side === 'Scout' ? 'Opponent library' : 'Team system'}</small></div></div><div className="pb-filter-tabs"><button className={navMode === 'Formations' ? 'active' : ''} onClick={() => setNavMode('Formations')} type="button">Formations</button><button className={navMode === 'Categories' ? 'active' : ''} onClick={() => setNavMode('Categories')} type="button">Categories</button></div><div className="pb-filter-list">{navMode === 'Formations' ? <><button className={selectedFormation === 'All formations' ? 'active' : ''} onClick={() => setSelectedFormation('All formations')} type="button"><span>All formations</span><b>{filteredPlays.length}</b></button>{formations.map((item) => <button className={selectedFormation === item.name ? 'active' : ''} key={item.name} onClick={() => setSelectedFormation(item.name)} type="button"><span>{item.name}</span><b>{item.count}</b></button>)}</> : studioCategories.map((item) => <button className={selectedCategory === item.name ? 'active' : ''} key={item.name} onClick={() => setSelectedCategory(item.name)} type="button"><span>{item.name}</span><b>{item.count}</b></button>)}</div><button className="pb-manage-filter" onClick={() => setScreen('formations')} type="button"><Pencil /> Manage formations</button></aside>
            <main className="pb-play-browser"><div className="pb-browser-toolbar"><div><p className="eyebrow">{navMode === 'Formations' ? selectedFormation : selectedCategory}</p><h2>{filteredPlays.length} plays</h2></div><div className="toolbar-search"><Search /><Input aria-label="Search this playbook" onChange={(event) => setQuery(event.target.value)} placeholder="Search plays, concepts…" value={query} /></div><div className="pb-view-buttons"><button className={viewMode === 'grid' ? 'active' : ''} aria-label="Grid view" onClick={() => setViewMode('grid')} type="button"><LayoutDashboard /></button><button className={viewMode === 'list' ? 'active' : ''} aria-label="List view" onClick={() => setViewMode('list')} type="button"><ListFilter /></button></div></div><div className={`pb-play-grid ${viewMode === 'list' ? 'list-view' : ''}`}><button className="pb-new-tile" onClick={beginNewPlay} type="button"><Plus /><strong>New {activeBook.side.toLowerCase()} play</strong><span>{navMode === 'Formations' && selectedFormation !== 'All formations' ? selectedFormation : 'Choose formation in editor'}</span></button>{filteredPlays.map((play, index) => <button className="pb-play-card" key={play.id} onClick={() => openPlay(play)} type="button"><span className="pb-card-number">{String(index + 1).padStart(2, '0')}</span><span className="pb-card-menu"><MoreHorizontal /></span><div className="pb-card-diagram"><StudioPlayDiagram label={false} play={play} /></div><footer><span>{play.formation} · {play.family}</span><strong>{play.name}</strong><small>{play.concept}</small></footer></button>)}</div>{filteredPlays.length === 0 ? <div className="pb-empty"><Search /><strong>No plays match this view</strong><span>Try another formation, category, or search.</span></div> : null}</main>
          </div>}
        </div>
        <Dialog onOpenChange={setBookSettingsOpen} open={bookSettingsOpen}><DialogContent className="athlete-dialog sm:max-w-[520px]"><form onSubmit={saveBookSettings}><DialogHeader><DialogTitle>Playbook settings</DialogTitle><DialogDescription>Rename this collection, change its system, or move it to the archive.</DialogDescription></DialogHeader><div className="athlete-form-grid"><label className="full" htmlFor="edit-playbook-name">Name<Input defaultValue={activeBook.name} id="edit-playbook-name" name="bookName" required /></label><label className="full" htmlFor="edit-playbook-side">System<NativeSelect defaultValue={activeBook.side} id="edit-playbook-side" name="bookSide"><NativeSelectOption value="Offence">Offence</NativeSelectOption><NativeSelectOption value="Defence">Defence</NativeSelectOption><NativeSelectOption value="Special teams">Special teams</NativeSelectOption><NativeSelectOption value="Scout">Scout plays</NativeSelectOption></NativeSelect></label><label className="full form-checkbox" htmlFor="edit-playbook-archived"><input defaultChecked={activeBook.archived} id="edit-playbook-archived" name="bookArchived" type="checkbox" /> Archive this playbook</label></div><DialogFooter><Button onClick={() => setDeleteAction('book')} type="button" variant="destructive"><Trash2 /> Delete</Button><Button type="submit">Save settings <Check /></Button></DialogFooter></form></DialogContent></Dialog>
        <Dialog onOpenChange={(open) => { setFormationDialogOpen(open); if (!open) setEditingFormation(null); }} open={formationDialogOpen}><DialogContent className="athlete-dialog sm:max-w-[520px]"><form onSubmit={saveFormation}><DialogHeader><DialogTitle>{editingFormation ? 'Edit formation' : 'New formation'}</DialogTitle><DialogDescription>Formation records are shared by the playbook editor and depth-chart tools.</DialogDescription></DialogHeader><div className="athlete-form-grid"><label className="full" htmlFor="formation-name">Name<Input defaultValue={editingFormation?.name ?? ''} id="formation-name" name="formationName" placeholder="Doubles" required /></label><label className="full" htmlFor="formation-personnel">Personnel<Input defaultValue={editingFormation?.personnel ?? ''} id="formation-personnel" name="formationPersonnel" placeholder="10 personnel" required /></label></div><DialogFooter>{editingFormation ? <Button onClick={() => setDeleteAction('formation')} type="button" variant="destructive"><Trash2 /> Delete</Button> : null}<Button type="submit">{editingFormation ? 'Save formation' : 'Create formation'} <Check /></Button></DialogFooter></form></DialogContent></Dialog>
      </section>
    );
  }

  return (
    <section className="module-surface playbook-surface pb-redesign">
        <Dialog open={deleteAction !== null} onOpenChange={(open) => { if (!open) setDeleteAction(null); }}><DialogContent className="athlete-dialog"><DialogHeader><DialogTitle>Delete {deleteAction}?</DialogTitle><DialogDescription>This permanently removes the selected record. Plays used in installs cannot be deleted.</DialogDescription></DialogHeader><DialogFooter><Button onClick={() => setDeleteAction(null)} variant="outline">Cancel</Button><Button variant="destructive" onClick={() => void (deleteAction === 'book' ? deleteBook() : deleteAction === 'formation' ? deleteFormation() : deleteCurrentPlay())}>Delete</Button></DialogFooter></DialogContent></Dialog>
      <div className={`pb-play-shell ${screen === 'editor' ? 'editing' : 'viewing'}`}>
        <Dialog open={discardAction !== null} onOpenChange={(open) => { if (!open) setDiscardAction(null); }}><DialogContent className="athlete-dialog"><DialogHeader><DialogTitle>Discard unsaved play changes?</DialogTitle><DialogDescription>Your last saved version will be kept.</DialogDescription></DialogHeader><DialogFooter><Button onClick={() => setDiscardAction(null)} variant="outline">Keep editing</Button><Button onClick={() => { discardAction?.(); setDiscardAction(null); }} variant="destructive">Discard changes</Button></DialogFooter></DialogContent></Dialog>
        <header className="pb-context-bar">
          <button className="pb-back" onClick={() => { if (screen === 'editor') setDiscardAction(() => () => setScreen('browser')); else setScreen('browser'); }} type="button"><ArrowLeft /></button>
          <div><span>{screen === 'editor' ? draftFormation || 'Unassigned' : currentPlay.formation} · {screen === 'editor' ? draftFamily : currentPlay.family}</span><strong>{screen === 'editor' ? draftName || 'Untitled play' : currentPlay.name}</strong></div>
          <div className="pb-header-play-nav"><button aria-label="Previous play" disabled={screen === 'editor'} onClick={() => nextPlay(-1)} title="Previous play" type="button"><ChevronLeft /></button><button aria-label="Next play" disabled={screen === 'editor'} onClick={() => nextPlay(1)} title="Next play" type="button"><ChevronRight /></button></div>
          <div className="pb-context-actions">
            <span className={saved ? 'save-state visible' : 'save-state'}><Check /> Saved</span>
            <FocusModeButton focused={focusMode} onToggle={onToggleFocus} />
            <button aria-label={detailsCollapsed ? 'Show play details' : 'Hide play details'} aria-pressed={!detailsCollapsed} className={detailsCollapsed ? 'pb-details-toggle' : 'pb-details-toggle active'} onClick={() => setDetailsCollapsed((collapsed) => !collapsed)} title={detailsCollapsed ? 'Show play details' : 'Hide play details'} type="button"><Info /><span>Details</span></button>
            {screen === 'viewer' ? <><Button disabled={playSaving} onClick={() => void duplicatePlay()} size="sm" variant="outline">Duplicate</Button><Button disabled={Boolean(currentPlay.locked)} aria-label="Delete play" onClick={() => setDeleteAction('play')} size="icon-sm" title="Delete play" variant="ghost"><Trash2 /></Button><Button disabled={Boolean(currentPlay.locked)} size="sm" onClick={() => { prepareDraft(currentPlay); setScreen('editor'); }}><Pencil /> Edit play</Button></> : <><Button disabled={playSaving} className="pb-cancel-edit" size="sm" variant="outline" onClick={cancelEditing}><X /> Cancel</Button><Button disabled={playSaving} size="sm" onClick={saveAndCloseEditing}><Check /> {playSaving ? 'Saving…' : 'Save changes'}</Button></>}
          </div>
        </header>
        <div className={detailsCollapsed ? 'pb-play-layout details-collapsed' : 'pb-play-layout'}>
          <main className="pb-play-stage">
            {currentPlay.locked ? <p className="pb-lock-notice"><Lock /> Used in a published install. Duplicate this play to revise it.</p> : null}
            {screen === 'editor' ? <div className="pb-editor-tools" aria-label="Play drawing tools">{[{ name: 'Select', icon: MousePointer2 },{ name: 'Route', icon: Pencil },{ name: 'Player', icon: CircleDot },{ name: 'Zone', icon: Shield },{ name: 'Label', icon: Tag }].map((item) => <button aria-label={item.name} className={tool === item.name ? 'active' : ''} key={item.name} onClick={() => activateDiagramTool(item.name)} title={item.name} type="button"><item.icon /><span>{item.name}</span></button>)}<i /><button aria-label="Toggle opponent" className={draftShowOpponent ? 'active utility-active' : ''} onClick={() => { rememberDiagram(); setDraftShowOpponent((visible) => !visible); }} title="Show or hide opponent"><Users /><span>Opponent</span></button><button aria-label="Duplicate selected item" disabled={!selectedElement} onClick={duplicateSelected} title="Duplicate selected item"><Plus /><span>Duplicate</span></button>{activeRouteId ? <button className="route-finish" onClick={finishActiveRoute} type="button"><Check /><span>Finish route</span></button> : null}<i /><button aria-label="Undo diagram change" disabled={undoStack.length === 0} onClick={undoDiagram} title="Undo" type="button"><Undo2 /></button><button aria-label="Redo diagram change" disabled={redoStack.length === 0} onClick={redoDiagram} title="Redo" type="button"><Redo2 /></button><button aria-label="Delete selected diagram item" disabled={!selectedElement && draftRoutes.length === 0} onClick={deleteSelected} title="Delete selected item" type="button"><Trash2 /></button></div> : null}
            <button className="pb-full-field" onClick={handleCanvas} onPointerDown={startDiagramDrag} onPointerMove={moveDiagramItem} onPointerUp={endDiagramDrag} type="button"><StudioPlayDiagram play={screen === 'editor' ? { ...currentPlay, family: draftFamily, fieldPosition: draftFieldPosition, showOpponent: draftShowOpponent, routes: draftRoutes, players: draftPlayers, zones: draftZones, labels: draftLabels } : currentPlay} />{screen === 'editor' && tool !== 'Select' ? <span className="pb-canvas-hint"><Plus /> {tool === 'Route' ? activeRouteId ? 'Click to extend this route; Finish route when done' : 'Click the field to start from the selected player' : `Click the field to add a ${tool.toLowerCase()}`}</span> : null}</button>
            {screen === 'editor' ? <div className="pb-edit-palette">
              <header><span><SlidersHorizontal /> {activeRouteId ? 'Building route' : selectedElement ? `Selected ${selectedKind}` : 'Drawing tools'}</span><strong>{activeRouteId ? `${selectedRoute?.points?.length ?? 2} points · click field to extend` : selectedPlayer ? `${selectedPlayer.label} · drag snaps one yard at a time` : `${draftRoutes.length} routes · one-yard snap on`}</strong><button aria-label={activeRouteId ? 'Finish route' : 'Clear selection'} onClick={activeRouteId ? finishActiveRoute : () => setSelectedElement('')} type="button"><Check /></button></header>
              <div className="pb-palette-body expanded"><span className="pb-palette-label">Colour</span><div className="pb-colour-swatches">{['#f25f50','#ffca45','#30d5c8','#5f8eff','#f3f7fb','#19283b'].map((colour, index) => <button aria-label={`Use colour ${index + 1}`} className={paletteColour === colour ? 'active' : ''} key={colour} onClick={() => chooseDiagramColour(colour)} style={{ background: colour }} type="button" />)}</div><span className="pb-palette-label">Line</span><div className="pb-line-options">{([['solid',''],['dashed','dashed'],['dotted','dotted'],['curve','curve']] as [DiagramRoute['lineStyle'], string][]).map(([name, className]) => <button aria-label={`Use ${name} line`} className={lineStyle === name ? 'active' : ''} key={name} onClick={() => chooseDiagramLineStyle(name)} type="button"><i className={className} /></button>)}</div><span className="pb-snap-status"><CircleDot /> 1 yd snap</span><button className={draftShowOpponent ? 'pb-palette-action active' : 'pb-palette-action'} onClick={() => { rememberDiagram(); setDraftShowOpponent((visible) => !visible); }} type="button"><Users /> Opponent</button><button className="pb-palette-action" disabled={!selectedElement} onClick={duplicateSelected} type="button"><Plus /> Duplicate</button>{activeRouteId ? <button className="pb-palette-action finish" onClick={finishActiveRoute} type="button"><Check /> Finish route</button> : null}</div>
              {selectedPlayer ? <div className="pb-selection-properties"><label htmlFor="selected-player-label">Player label<Input id="selected-player-label" maxLength={4} onChange={(event) => setDraftPlayers((items) => items.map((item) => item.id === selectedPlayer.id ? { ...item, label: event.target.value.toUpperCase() } : item))} value={selectedPlayer.label} /></label><label htmlFor="selected-player-symbol">Symbol<NativeSelect id="selected-player-symbol" onChange={(event) => setDraftPlayers((items) => items.map((item) => item.id === selectedPlayer.id ? { ...item, kind: event.target.value as DiagramPlayer['kind'] } : item))} value={selectedPlayer.kind}><NativeSelectOption value="skill">Skill</NativeSelectOption><NativeSelectOption value="line">Line</NativeSelectOption><NativeSelectOption value="qb">Quarterback</NativeSelectOption><NativeSelectOption value="back">Back</NativeSelectOption></NativeSelect></label><Button onClick={() => { setRouteAnchorPlayerId(selectedPlayer.id); setActiveRouteId(''); setTool('Route'); }} size="sm" variant="outline"><Pencil /> Draw route from {selectedPlayer.label}</Button></div> : selectedRoute ? <div className="pb-selection-properties route-properties"><span>{Math.max(1, (selectedRoute.points?.length ?? 2) - 1)} straight {Math.max(1, (selectedRoute.points?.length ?? 2) - 1) === 1 ? 'segment' : 'segments'} · {selectedRoute.lineStyle}</span><Button onClick={() => { setRouteAnchorPlayerId(selectedRoute.playerId ?? ''); setActiveRouteId(selectedRoute.id); setTool('Route'); }} size="sm" variant="outline">Continue route</Button></div> : selectedLabel ? <div className="pb-selection-properties"><label htmlFor="selected-label-text">Label text<Input id="selected-label-text" onChange={(event) => setDraftLabels((items) => items.map((item) => item.id === selectedLabel.id ? { ...item, text: event.target.value } : item))} value={selectedLabel.text} /></label></div> : selectedZone ? <div className="pb-selection-properties"><label htmlFor="selected-zone-width">Width<Input id="selected-zone-width" max="400" min="30" onChange={(event) => setDraftZones((items) => items.map((item) => item.id === selectedZone.id ? { ...item, width: Number(event.target.value) } : item))} type="number" value={selectedZone.width} /></label><label htmlFor="selected-zone-height">Height<Input id="selected-zone-height" max="300" min="20" onChange={(event) => setDraftZones((items) => items.map((item) => item.id === selectedZone.id ? { ...item, height: Number(event.target.value) } : item))} type="number" value={selectedZone.height} /></label></div> : null}
            </div> : null}
          </main>
          {detailsCollapsed ? null : <aside className="pb-inspector">
            <div className="pb-inspector-heading"><div><p className="eyebrow">Play details</p><h3>{screen === 'editor' ? 'Edit teaching details' : 'Coach view'}</h3></div><Badge variant="secondary">{screen === 'editor' ? 'Draft' : 'Saved play'}</Badge></div>
            <label htmlFor="studio-play-name">Play name<Input disabled={screen !== 'editor'} id="studio-play-name" onChange={(event) => setDraftName(event.target.value)} value={screen === 'editor' ? draftName : currentPlay.name} /></label>
            <label htmlFor="studio-play-formation">Formation<NativeSelect className="w-full" disabled={screen !== 'editor'} id="studio-play-formation" onChange={(event) => setDraftFormation(event.target.value)} value={screen === 'editor' ? draftFormation : currentPlay.formation}><NativeSelectOption value="">Unassigned</NativeSelectOption>{formations.map((item) => <NativeSelectOption key={item.id} value={item.name}>{item.name}</NativeSelectOption>)}</NativeSelect></label>
            <label htmlFor="studio-play-family">Play type<NativeSelect className="w-full" disabled={screen !== 'editor'} id="studio-play-family" onChange={(event) => setDraftFamily(event.target.value as StudioPlay['family'])} value={screen === 'editor' ? draftFamily : currentPlay.family}><NativeSelectOption value="Unassigned">Choose a play type…</NativeSelectOption><NativeSelectOption value="Run">Run</NativeSelectOption><NativeSelectOption value="Pass">Pass</NativeSelectOption><NativeSelectOption value="RPO">RPO</NativeSelectOption><NativeSelectOption value="Screen">Screen</NativeSelectOption></NativeSelect></label>
            <label htmlFor="studio-play-concept">Concept<Input disabled={screen !== 'editor'} id="studio-play-concept" onChange={(event) => setDraftConcept(event.target.value)} value={screen === 'editor' ? draftConcept : currentPlay.concept} /></label>
            <label htmlFor="studio-field-position">Ball position<NativeSelect className="w-full" disabled={screen !== 'editor'} id="studio-field-position" onChange={(event) => changeFieldPosition(Number(event.target.value))} value={screen === 'editor' ? String(draftFieldPosition) : String(currentPlay.fieldPosition ?? 55)}>{canadianFieldPositions.map((position) => <NativeSelectOption key={position.yard} value={String(position.yard)}>{position.label}</NativeSelectOption>)}</NativeSelect><small className="pb-field-helper">Defaults to centre field (C). Players and routes move with the ball spot.</small></label>
            <div className="pb-opponent-setting"><div><strong>Opponent alignment</strong><span>{(currentPlay.unit ?? activeBook.side) === 'Defence' ? 'Show an opponent offence' : 'Show an opponent defence'}</span></div><button aria-label="Toggle opponent alignment" aria-pressed={screen === 'editor' ? draftShowOpponent : Boolean(currentPlay.showOpponent)} className={(screen === 'editor' ? draftShowOpponent : currentPlay.showOpponent) ? 'on' : ''} disabled={screen !== 'editor'} onClick={() => { rememberDiagram(); setDraftShowOpponent((visible) => !visible); }} type="button"><span /></button></div>
            <div className="property-divider" />
            <PlayAssignmentsEditor assignments={screen === 'editor' ? draftAssignments : currentPlay.assignments ?? []} editing={screen === 'editor'} onChange={setDraftAssignments} />
            <div className="property-divider" />
            <label htmlFor="studio-play-notes">Coaching notes<Textarea disabled={screen !== 'editor'} id="studio-play-notes" onChange={(event) => setDraftNotes(event.target.value)} value={screen === 'editor' ? draftNotes : currentPlay.notes ?? ''} /></label>
            <div className="property-divider" />
            <section className="pb-install-panel"><div className="property-title"><strong>Install</strong></div><label htmlFor="studio-install-package">Draft package<NativeSelect className="w-full" id="studio-install-package" onChange={(event) => { setInstalledPlayIds([]); setInstallPackageId(event.target.value); }} value={installPackageId}><NativeSelectOption value="">Choose an install…</NativeSelectOption>{installPackages.filter((pack) => !pack.publishedAt && (pack.unit === 'Team' || pack.unit === currentPlay.unit)).map((pack) => <NativeSelectOption key={pack.id} value={pack.id}>{pack.name}{pack.dueAt ? ` · ${pack.dueAt}` : ''}</NativeSelectOption>)}</NativeSelect></label><p>{screen === 'editor' ? 'Save your changes before adding the play.' : installedPlayIds.includes(currentPlay.id) ? 'This play is already in the selected draft.' : 'Choose a draft or create a new install.'}</p><div><Button disabled={screen === 'editor' || !installPackageId || installedPlayIds.includes(currentPlay.id)} onClick={() => void addCurrentPlayToInstall()} size="sm"><ClipboardList /> {installedPlayIds.includes(currentPlay.id) ? 'Added' : 'Add play'}</Button><Button onClick={() => onNavigate('Install')} size="sm" variant="outline">Manage installs</Button></div></section>
          </aside>}
        </div>
      </div>
    </section>
  );
}

type SidelinePlayRecord = { id: number; dbId: string; down: string; yard: string; gain: string; call: string; status: string };

function SidelineView({ assetRevision, focusMode, onNavigate, onNotify, onToggleFocus, teamSettings }: { assetRevision: number; focusMode: boolean; onNavigate: (view: string) => void; onNotify: Notify; onToggleFocus: () => void; teamSettings: TeamSettings }) {
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
  const play = sidelinePlays.find((item) => item.id === selected) ?? sidelinePlays[0] ?? null;

  useEffect(() => {
    loadWorkspaceState('sideline-session-v2', { flagged: [] as number[], notes: [] as string[] })
      .then((saved) => { setFlagged(saved.flagged); })
      .catch(() => onNotify('Saved sideline notes could not be restored.', 'warning'));
    fetch('/api/film', { cache: 'no-store' }).then(async (response) => await response.json() as FilmPayload).then((data) => {
      const plays = (data.clips ?? []).map((clip) => ({ id: clip.clipNumber, dbId: clip.id, down: clip.down ? `${clip.down} & ${clip.distance ?? '—'}` : 'Down not charted', yard: clip.yardLine || 'Yard line not charted', gain: clip.result || '—', call: clipLabel(clip), status: 'saved' }));
      setSidelinePlays(plays); setSelected(plays[0]?.id ?? 0);
    }).catch(() => setSidelinePlays([]));
    return () => { cameraStreamRef.current?.getTracks().forEach((track) => track.stop()); };
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) cameraVideoRef.current.srcObject = stream;
      setCameraCount(1);
      onNotify('Real camera feed connected.');
    } catch { onNotify('Camera access was not granted. Check browser permissions and try again.', 'error'); }
  };

  const moveSidelinePlay = (direction: number) => {
    if (!sidelinePlays.length) return;
    const index = sidelinePlays.findIndex((item) => item.id === selected);
    setSelected(sidelinePlays[(index + direction + sidelinePlays.length) % sidelinePlays.length].id);
  };

  return (
    <section className="module-surface sideline-surface">
      <ModuleHeader
        eyebrow="Game-day replay"
        title="Sideline"
        description="Review the last snap before the next one. Fast, local, and built for the bench."
      >
        <FocusModeButton focused={focusMode} onToggle={onToggleFocus} />
        <Badge className={cameraCount ? 'connection-badge' : 'connection-badge offline'}><span /> {cameraCount ? 'Camera live' : 'No live camera'}</Badge>
        <Button className="module-secondary" onClick={() => onNotify('Sideline replay is operating on the local team network.', 'info')} variant="outline"><CloudOff /> Local network</Button>
        <Button className="module-primary" onClick={() => void toggleCamera()}>{cameraCount ? <X /> : <Camera />} {cameraCount ? 'Disconnect camera' : 'Connect camera'}</Button>
      </ModuleHeader>

      <div className="sideline-scorebar"><div className="score-team"><MediaAvatar assetKey="team-logo" className="team-crest dark" fallback={initialsFor(teamSettings.teamName)} label={`${teamSettings.teamName || 'Team'} logo`} revision={assetRevision} /><div><small>{teamSettings.teamName || 'Team'} replay</small><strong>{cameraCount ? 'Camera connected' : 'Camera offline'}</strong></div></div><div className="game-clock"><span>SAVED PLAY HISTORY</span><strong>{sidelinePlays.length}</strong><small>Charted in Film Room</small></div><div className="possession"><span>CURRENT CLIP</span><strong>{play?.call ?? 'None selected'}</strong></div></div>

      <div className="sideline-grid">
        <aside className="drive-panel">
          <div className="panel-title"><div><strong>Saved clip history</strong><span>{sidelinePlays.length} charted plays</span></div><Badge variant="secondary">Local</Badge></div>
          <div className="sideline-play-list">
            {sidelinePlays.map((item) => (
              <button className={selected === item.id ? 'sideline-play active' : 'sideline-play'} key={item.id} onClick={() => setSelected(item.id)} type="button">
                <span className="snap-number">{item.id}</span>
                <div><strong>{item.down} · {item.call}</strong><small>{item.yard} <b>{item.gain}</b></small></div>
                {flagged.includes(item.id) ? <Pin className="flagged" /> : <Check />}
              </button>
            ))}
            {!sidelinePlays.length ? <div className="channel-empty">No play history yet. Chart clips in Film Room to populate this list.</div> : null}
          </div>
          <Button className="w-full" onClick={() => onNavigate('Film Room')} variant="outline"><Film /> Open Film Room</Button>
        </aside>

        <div className="sideline-viewer-column">
          <div className="sideline-viewer">
            <div className="angle-tabs">
              {['Sideline', 'End zone', 'Tight'].map((item) => <button className={angle === item ? 'active' : ''} key={item} onClick={() => setAngle(item)} type="button">{item}</button>)}
              <span>{angle} · Cam {angle === 'End zone' ? '2' : angle === 'Sideline' ? '1' : '3'}</span>
            </div>
            <div className="replay-stage">
              <video aria-label="Connected sideline camera" autoPlay className={cameraCount ? 'sideline-live-video available' : 'sideline-live-video'} muted playsInline ref={cameraVideoRef} />
              {cameraCount ? <><span className="replay-label"><Radio /> LIVE LOCAL CAMERA</span>{telestrate ? <svg className="telestration" viewBox="0 0 800 420" /> : null}{play ? <div className="down-overlay"><strong>{play.down}</strong><span>{play.call}</span><b>{play.gain}</b></div> : null}</> : <div className="viewer-empty-state"><Camera /><strong>No camera connected</strong><span>Connect a real local camera to start the sideline view.</span><Button onClick={() => void toggleCamera()}><Camera /> Connect camera</Button></div>}
            </div>
            <div className="replay-controls">
              <Button aria-label="Previous snap" onClick={() => moveSidelinePlay(-1)} size="icon" variant="ghost"><SkipBack /></Button>
              <Button aria-label={playing ? 'Pause replay' : 'Play replay'} className="control-play" disabled={!cameraCount} size="icon" onClick={() => setPlaying(!playing)}>{playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</Button>
              <Button aria-label="Next snap" onClick={() => moveSidelinePlay(1)} size="icon" variant="ghost"><SkipForward /></Button>
              <span>{play ? `Clip ${play.id}` : 'No clip selected'}</span>
              <Slider aria-label="Replay timeline" className="film-slider" disabled={!cameraCount} value={[0]} />
              <button className={telestrate ? 'telestrate-toggle active' : 'telestrate-toggle'} disabled={!cameraCount} onClick={() => setTelestrate(!telestrate)} type="button"><Pencil /> Draw</button>
              <Button aria-label="Fullscreen" onClick={() => document.querySelector('.sideline-viewer')?.requestFullscreen?.()} size="icon" variant="ghost"><Maximize2 /></Button>
            </div>
          </div>

          <div className="sideline-bottom">
            <div className="coach-note">
              <span className="chat-avatar bg-[#dce4ef] text-[#234873]">OC</span>
              <div><strong>Quick note to offence</strong><Input aria-label="Send a quick sideline note" onChange={(event) => setQuickNote(event.target.value)} placeholder="What should they see on the bench?" value={quickNote} /></div>
              <Button disabled={!quickNote.trim()} onClick={async () => { const state = await loadWorkspaceState<{ flagged: number[]; notes: string[]; cameraCount: number }>('sideline-session-v2', { flagged, notes: [], cameraCount }); await saveWorkspaceState('sideline-session-v2', { ...state, flagged, cameraCount, notes: [...state.notes, quickNote.trim()] }); setQuickNote(''); onNotify('Sideline note saved for the offence.'); }}><Send /> Save</Button>
            </div>
            <div className="sideline-actions">
              <button disabled={!play} onClick={async () => { if (!play) return; const next = flagged.includes(selected) ? flagged.filter((id) => id !== selected) : [...flagged, selected]; setFlagged(next); await saveWorkspaceState('sideline-session-v2', { flagged: next, notes: [], cameraCount }); onNotify(flagged.includes(selected) ? 'Halftime flag removed.' : 'Play flagged for halftime.'); }} type="button"><Pin /><span><strong>{flagged.includes(selected) ? 'Unflag play' : 'Flag play'}</strong><small>For halftime</small></span></button>
              <button disabled={!play} onClick={() => setUnitSendPending(true)} type="button"><Users /><span><strong>Send to unit</strong><small>Offence</small></span></button>
              <button disabled={!play} onClick={async () => { if (!play) return; const cutups = await loadWorkspaceState<{ name: string; clips: string[] }[]>('film-cutups', []); await saveWorkspaceState('film-cutups', [...cutups, { name: `${play.call} sideline`, clips: [play.dbId] }]); onNotify(`${play.call} added to a saved cut-up.`); }} type="button"><Film /><span><strong>Add to cut-up</strong><small>Saved locally</small></span></button>
            </div>
          </div>
        </div>
      </div>
      <Dialog onOpenChange={setUnitSendPending} open={unitSendPending}><DialogContent className="athlete-dialog sm:max-w-[480px]"><DialogHeader><DialogTitle>Send this play to Offence?</DialogTitle><DialogDescription>{play ? `${play.call} will be queued in the Offence conversation.` : 'Choose a saved play first.'}</DialogDescription></DialogHeader><DialogFooter><Button onClick={() => setUnitSendPending(false)} variant="outline">Cancel</Button><Button disabled={!play} onClick={() => { if (!play) return; setUnitSendPending(false); onNotify(`${play.call} queued in the offence conversation.`); onNavigate('Messages'); }}>Confirm and send <Send /></Button></DialogFooter></DialogContent></Dialog>
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

function AthletesView({ assetRevision, onAssetsChanged, onNotify }: { assetRevision: number; onAssetsChanged: () => void; onNotify: Notify }) {
  const [query, setQuery] = useState('');
  const [unit, setUnit] = useState('All');
  const [statusFilter, setStatusFilter] = useState<'All' | AthleteStatus>('All');
  const [roster, setRoster] = useState<AthleteRecord[]>(fallbackAthletes);
  const [metrics, setMetrics] = useState<AthleteMetrics>(fallbackMetrics);
  const [selected, setSelected] = useState<AthleteRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [dataMessage, setDataMessage] = useState('Loading the local roster…');
  const visibleAthletes = useMemo(() => roster.filter((athlete) => {
    const matchesQuery = `${athlete.name} ${athlete.position} ${athlete.no}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (unit === 'All' || athlete.unit === unit) && (statusFilter === 'All' || athlete.status === statusFilter);
  }), [query, roster, statusFilter, unit]);

  useEffect(() => {
    let active = true;
    fetch('/api/athletes')
      .then(async (response) => {
        const data = await response.json() as { athletes?: AthleteRecord[]; metrics?: AthleteMetrics; error?: string };
        if (!response.ok) throw new Error(data.error ?? 'Unable to load the roster.');
        return data;
      })
      .then((data) => {
        if (!active || !data.athletes || !data.metrics) return;
        setRoster(data.athletes);
        setMetrics(data.metrics);
        setSelected((current) => data.athletes?.find((athlete) => athlete.id === current?.id) ?? data.athletes?.[0] ?? null);
        setDataMessage(data.athletes.length ? 'Saved locally' : 'Roster empty · ready for your athletes');
      })
      .catch((error: unknown) => {
        if (active) setDataMessage(error instanceof Error ? error.message : 'The roster could not be loaded.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onNotify]);

  const createAthlete = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setDataMessage('Saving athlete…');
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
      const response = await fetch('/api/athletes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json() as { athlete?: AthleteRecord; metrics?: AthleteMetrics; error?: string };
      if (!response.ok || !data.athlete || !data.metrics) throw new Error(data.error ?? 'Unable to add athlete.');
      setRoster((items) => [...items, data.athlete!].sort((a, b) => (a.no ?? Number.MAX_SAFE_INTEGER) - (b.no ?? Number.MAX_SAFE_INTEGER)));
      setMetrics(data.metrics);
      setSelected(data.athlete);
      setAddOpen(false);
      setDataMessage(`${data.athlete.name} added to the local roster`);
      onNotify(`${data.athlete.name} added to the roster.`);
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : 'Unable to add athlete.');
    } finally {
      setSaving(false);
    }
  };

  const updateAthlete = async (changes: Partial<Pick<AthleteRecord, 'status' | 'staffNote' | 'install' | 'attendance'>>) => {
    if (!selected) return;
    setSaving(true);
    setDataMessage('Saving changes…');
    try {
      const response = await fetch('/api/athletes', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: selected.id, status: changes.status, staffNote: changes.staffNote, installPercent: changes.install, attendancePercent: changes.attendance }),
      });
      const data = await response.json() as { athlete?: AthleteRecord; metrics?: AthleteMetrics; error?: string };
      if (!response.ok || !data.athlete || !data.metrics) throw new Error(data.error ?? 'Unable to save changes.');
      setSelected(data.athlete);
      setRoster((items) => items.map((athlete) => athlete.id === data.athlete?.id ? data.athlete : athlete));
      setMetrics(data.metrics);
      setDataMessage('Changes saved locally');
      onNotify(`${data.athlete.name} updated.`);
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : 'Unable to save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="module-surface roster-surface">
      <ModuleHeader
        eyebrow="People & availability"
        title="Athletes"
        description="One clean roster for contacts, eligibility, health, learning, and team communication."
      >
        <Button className="module-secondary" onClick={() => { const rows = [['Name','Number','Position','Unit','Grade','Status','Email','Phone','Install'], ...roster.map((athlete) => [athlete.name, athlete.no ?? '', athlete.position, athlete.unit, athlete.year, athlete.status, athlete.email, athlete.phone, athlete.install])]; downloadText('north-shore-roster.csv', rows.map((row) => row.map(quoteCsv).join(',')).join('\n'), 'text/csv;charset=utf-8'); onNotify('Roster exported as CSV.'); }} variant="outline"><Download /> Export</Button>
        <Button className="module-primary" onClick={() => setAddOpen(true)}><UserPlus /> Add athlete</Button>
      </ModuleHeader>

      <div className="local-data-status"><span className={loading || saving ? 'sync-dot working' : 'sync-dot'} /><strong>{dataMessage}</strong><small>Local D1 database</small></div>

      <div className="roster-stats">
        <article><span className="stat-icon navy"><Users /></span><div><small>Total roster</small><strong>{metrics.total}</strong><p>{metrics.active} active</p></div></article>
        <article><span className="stat-icon green"><CheckCircle2 /></span><div><small>Game eligible</small><strong>{metrics.eligible}</strong><p>{metrics.total ? Math.round(metrics.eligible / metrics.total * 100) : 0}% cleared</p></div></article>
        <article><span className="stat-icon amber"><AlertCircle /></span><div><small>Availability</small><strong>{metrics.limited + metrics.out}</strong><p>{metrics.limited} limited · {metrics.out} out</p></div></article>
        <article><span className="stat-icon blue"><ClipboardList /></span><div><small>Install average</small><strong>{metrics.installAverage}%</strong><p>Across saved athletes</p></div></article>
      </div>

      <div className="roster-toolbar">
        <div className="toolbar-search"><Search /><Input aria-label="Search roster" onChange={(event) => setQuery(event.target.value)} placeholder="Search name, number, position…" value={query} /></div>
        <div className="segmented-control">
          {['All', 'Offence', 'Defence'].map((item) => <button className={unit === item ? 'active' : ''} key={item} onClick={() => setUnit(item)} type="button">{item}</button>)}
        </div>
        <Button onClick={() => setStatusFilter((current) => current === 'All' ? 'Limited' : current === 'Limited' ? 'Out' : 'All')} variant="outline"><ListFilter /> {statusFilter === 'All' ? 'More filters' : statusFilter} {statusFilter !== 'All' ? <Badge variant="secondary">1</Badge> : null}</Button>
      </div>

      <div className={selected ? 'roster-grid' : 'roster-grid no-selection'}>
        <div className="roster-table-wrap">
          <table className="roster-table">
            <thead><tr><th>Athlete</th><th>Pos</th><th>Unit</th><th>Year</th><th>Status</th><th>Install</th><th><span className="sr-only">Open athlete</span></th></tr></thead>
            <tbody>
              {!loading && visibleAthletes.length === 0 ? <tr className="roster-empty"><td colSpan={7}><Users /><strong>No athletes match these filters.</strong><span>{roster.length ? 'Try another search or filter.' : 'Your roster table will fill this workspace once athletes are added.'}</span>{!roster.length ? <Button onClick={() => setAddOpen(true)} size="sm"><UserPlus /> Add first athlete</Button> : null}</td></tr> : null}
              {visibleAthletes.map((athlete) => {
                const family = positionFamily(athlete.position, athlete.unit);
                return (
                <tr className={`${selected?.id === athlete.id ? 'selected ' : ''}position-family-${family}`} key={athlete.id} onClick={() => setSelected(athlete)}>
                  <td><MediaAvatar assetKey={`athlete-${athlete.id}`} className="roster-avatar" fallback={athlete.initials} label={`${athlete.name} profile photo`} revision={assetRevision} /><span><strong>{athlete.name}</strong><small>{athlete.no === null ? 'No jersey number' : `#${athlete.no}`}</small></span></td>
                  <td><Badge className={`position-family-tag ${family}`} variant="outline">{athlete.position}</Badge></td>
                  <td>{athlete.unit}</td>
                  <td>Grade {athlete.year}</td>
                  <td><span className={`status-pill ${athlete.status.toLowerCase()}`}><i /> {athlete.status}</span></td>
                  <td><div className="install-cell"><progress aria-label={`${athlete.install}% install complete`} className="sr-only" max={100} value={athlete.install} /><span><i style={{ width: `${athlete.install}%` }} /></span><b>{athlete.install}%</b></div></td>
                  <td><Button aria-label={`Open ${athlete.name}`} onClick={(event) => { event.stopPropagation(); setSelected(athlete); onNotify(`${athlete.name} profile opened.`, 'info'); }} size="icon-sm" variant="ghost"><ChevronRight /></Button></td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>

        {selected ? <aside className="athlete-detail">
          <div className="athlete-detail-head">
            <MediaAvatar assetKey={`athlete-${selected.id}`} className="detail-avatar" fallback={selected.initials} label={`${selected.name} profile photo`} revision={assetRevision} />
            <div><Badge variant="secondary">{selected.no === null ? 'No number' : `#${selected.no}`} · {selected.position}</Badge><h2>{selected.name}</h2><p>{selected.unit} · Grade {selected.year}</p></div>
            <Button aria-label="Athlete options" onClick={() => onNotify(`Availability, install, and private notes for ${selected.name} are editable here.`, 'info')} size="icon-sm" variant="ghost"><MoreHorizontal /></Button>
          </div>
          <div className="contact-actions">
            <Button onClick={async () => { const state = await loadWorkspaceState<{ threads: Record<string, string[]> }>('messages-team', { threads: {} }); await saveWorkspaceState('messages-team', { threads: { ...state.threads, [selected.name]: state.threads[selected.name] ?? [] } }); onNotify(`Conversation with ${selected.name} is ready in Messages.`); }} variant="outline"><MessageSquareText /> Message</Button>
            <Button aria-label="Email athlete" disabled={!selected.email} onClick={() => { window.location.href = `mailto:${selected.email}`; }} size="icon" variant="outline"><Mail /></Button>
            <Button aria-label="Phone athlete" disabled={!selected.phone} onClick={() => { window.location.href = `tel:${selected.phone}`; }} size="icon" variant="outline"><Phone /></Button>
          </div>
          <div className="profile-media-actions"><MediaUploadControl assetKey={`athlete-${selected.id}`} label="Upload athlete photo" onNotify={onNotify} onUploaded={onAssetsChanged} /><Button onClick={async () => { try { await deleteMedia(`athlete-${selected.id}`); onAssetsChanged(); onNotify(`${selected.name}'s photo removed.`, 'info'); } catch { onNotify('The athlete photo could not be removed.', 'error'); } }} size="sm" variant="ghost"><Trash2 /> Remove</Button></div>
          <div className="detail-grid">
            <div><small>Height</small><strong>{selected.height}</strong></div><div><small>Weight</small><strong>{selected.weight}</strong></div>
            <div><small>Eligibility</small><strong>{selected.eligibility}</strong></div><div><small>Attendance</small><strong>{selected.attendance}%</strong></div>
          </div>
          <label className="availability-editor" htmlFor="athlete-availability">Availability
            <NativeSelect disabled={saving} id="athlete-availability" onChange={(event) => void updateAthlete({ status: event.target.value as AthleteStatus })} value={selected.status}>
              <NativeSelectOption value="Active">Active · full participation</NativeSelectOption><NativeSelectOption value="Limited">Limited · modified work</NativeSelectOption><NativeSelectOption value="Out">Out · unavailable</NativeSelectOption>
            </NativeSelect>
          </label>
          <div className="detail-section">
            <div className="property-title"><strong>Week 5 readiness</strong><span>{selected.install}%</span></div>
            <div className="detail-progress"><i style={{ width: `${selected.install}%` }} /></div>
            <div className="readiness-check"><Check /> Film assignment complete</div>
            <div className="readiness-check"><Check /> Install quiz passed</div>
            <div className="readiness-check pending"><Clock3 /> Position review pending</div>
          </div>
          <div className="detail-section">
            <div className="property-title"><strong>Staff note</strong><Lock /></div>
            <Textarea aria-label="Staff note" className="staff-note-editor" defaultValue={selected.staffNote} key={selected.id} onBlur={(event) => { if (event.target.value !== selected.staffNote) void updateAthlete({ staffNote: event.target.value }); }} />
            <p className="staff-note-save">Private · saves when you leave the note</p>
          </div>
          <Button className="w-full" onClick={() => onNotify(`${selected.name}'s roster record is fully open in this panel.`, 'info')} variant="outline">Profile open <Check /></Button>
        </aside> : null}
      </div>

      <Dialog onOpenChange={setAddOpen} open={addOpen}>
        <DialogContent className="athlete-dialog sm:max-w-[620px]">
          <form onSubmit={createAthlete}>
            <DialogHeader><DialogTitle>Add athlete</DialogTitle><DialogDescription>Create a persistent local roster record. You can add assignments and install history next.</DialogDescription></DialogHeader>
            <div className="athlete-form-grid">
              <label htmlFor="new-athlete-first-name"><span>First name <b className="field-required" aria-hidden="true">*</b></span><Input id="new-athlete-first-name" name="firstName" required /></label><label htmlFor="new-athlete-last-name"><span>Last name <b className="field-required" aria-hidden="true">*</b></span><Input id="new-athlete-last-name" name="lastName" required /></label>
              <label htmlFor="new-athlete-number">Jersey number<Input id="new-athlete-number" max="99" min="0" name="number" type="number" /></label><label htmlFor="new-athlete-position">Position<Input id="new-athlete-position" maxLength={8} name="position" placeholder="ATH" /></label>
              <label htmlFor="new-athlete-unit">Unit<NativeSelect defaultValue="Offence" id="new-athlete-unit" name="unit"><NativeSelectOption value="Offence">Offence</NativeSelectOption><NativeSelectOption value="Defence">Defence</NativeSelectOption><NativeSelectOption value="Special teams">Special teams</NativeSelectOption></NativeSelect></label>
              <label htmlFor="new-athlete-grade">Grade<NativeSelect defaultValue="12" id="new-athlete-grade" name="graduationYear"><NativeSelectOption value="9">Grade 9</NativeSelectOption><NativeSelectOption value="10">Grade 10</NativeSelectOption><NativeSelectOption value="11">Grade 11</NativeSelectOption><NativeSelectOption value="12">Grade 12</NativeSelectOption><NativeSelectOption value="13">Grade 13</NativeSelectOption></NativeSelect></label>
              <label htmlFor="new-athlete-height">Height<Input id="new-athlete-height" name="height" placeholder={'6\'1″'} /></label><label htmlFor="new-athlete-weight">Weight (lb)<Input id="new-athlete-weight" max="450" min="0" name="weightLb" type="number" /></label>
              <label htmlFor="new-athlete-email"><span>Email <b className="field-required" aria-hidden="true">*</b></span><Input id="new-athlete-email" name="email" required type="email" /></label><label htmlFor="new-athlete-phone">Phone<Input id="new-athlete-phone" name="phone" type="tel" /></label>
              <label className="full" htmlFor="new-athlete-note">Initial staff note<Textarea id="new-athlete-note" name="staffNote" placeholder="Health, development, or role context…" /></label>
            </div>
            <DialogFooter><Button disabled={saving} type="submit">{saving ? 'Saving…' : 'Add to roster'} <UserPlus /></Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

type DepthPlayerSlot = { id: string; pos: string; athleteId: string; x: number; y: number };
type DepthLayouts = Record<AthleteUnit, DepthPlayerSlot[]>;

const emptyDepthLayouts: DepthLayouts = { Offence: [], Defence: [], 'Special teams': [] };
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
      fetch('/api/depth-charts', { cache: 'no-store' }).then(async (response) => {
        const data = await response.json() as DepthChartPayload & { error?: string };
        if (!response.ok) throw new Error(data.error ?? 'Unable to load roster choices.');
        return data.athletes;
      }),
    ]).then(([savedLayouts, athletes]) => {
      if (!active) return;
      setLayouts({ ...emptyDepthLayouts, ...savedLayouts });
      setRoster(athletes);
      setDepthMessage('Layout saved locally');
    }).catch((error: unknown) => { if (active) setDepthMessage(error instanceof Error ? error.message : 'Unable to load the depth chart.'); });
    return () => { active = false; };
  }, []);

  const persistLayouts = async (next: DepthLayouts, successMessage = 'Layout saved locally') => {
    setLayouts(next);
    setDepthSaving(true);
    setDepthMessage('Saving layout…');
    try {
      await saveWorkspaceState('depth-layouts-v2', next);
      setDepthMessage(successMessage);
    } catch (error) {
      setDepthMessage(error instanceof Error ? error.message : 'Unable to save the layout.');
    } finally {
      setDepthSaving(false);
    }
  };

  const updateSlot = (id: string, patch: Partial<DepthPlayerSlot>, save = false) => {
    const next = { ...layouts, [group]: layouts[group].map((slot) => slot.id === id ? { ...slot, ...patch } : slot) };
    if (save) void persistLayouts(next);
    else setLayouts(next);
  };

  const positionFromPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const bounds = depthBoardRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      x: Math.min(94, Math.max(6, (event.clientX - bounds.left) / bounds.width * 100)),
      y: Math.min(92, Math.max(8, (event.clientY - bounds.top) / bounds.height * 100)),
    };
  };

  const movePositionCard = (event: ReactPointerEvent<HTMLButtonElement>, slot: DepthPlayerSlot, save: boolean) => {
    const position = positionFromPointer(event);
    if (!position) return;
    const next = { ...layouts, [group]: layouts[group].map((item) => item.id === slot.id ? { ...item, ...position } : item) };
    if (save) void persistLayouts(next, `${slot.pos} position saved.`);
    else setLayouts(next);
  };

  const addPosition = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const pos = formText(fields, 'positionName').trim();
    if (!pos) return;
    const index = lineup.length;
    const slot: DepthPlayerSlot = { id: globalThis.crypto?.randomUUID?.() ?? `position-${Date.now()}`, pos, athleteId: '', x: 18 + index % 4 * 21, y: 22 + Math.floor(index / 4) * 22 };
    const next = { ...layouts, [group]: [...lineup, slot] };
    setSelectedId(slot.id);
    setEditing(true);
    setPositionDialogOpen(false);
    void persistLayouts(next, `${pos} added to ${group}.`);
  };

  const selectedAthlete = selected?.athleteId ? roster.find((athlete) => athlete.id === selected.athleteId) : null;

  return (
    <section className="module-surface depth-surface">
      <ModuleHeader eyebrow="Personnel" title="Depth Charts" description="Build each unit with the position names and alignment your team actually uses.">
        <Button className="module-secondary" onClick={() => window.print()} variant="outline"><Download /> Print</Button>
        <Button className="module-primary" onClick={async () => { if (editing) { await saveWorkspaceState('depth-chart-publication', { unit: group, publishedAt: new Date().toISOString() }); onNotify(`${group} depth chart published.`); } setEditing((value) => !value); }}>{editing ? <Check /> : <Pencil />} {editing ? 'Publish layout' : 'Edit layout'}</Button>
      </ModuleHeader>

      <div className="depth-toolbar">
        <div className="segmented-control large">{depthUnits.map((item) => <button className={group === item ? 'active' : ''} key={item} onClick={() => { setGroup(item); setSelectedId(layouts[item][0]?.id ?? ''); }} type="button">{item}</button>)}</div>
        <Button onClick={() => setPositionDialogOpen(true)} variant="outline"><Plus /> Add position</Button>
        <Button onClick={() => onNotify(`${assignedCount} of ${lineup.length} positions are assigned.`, 'info')} variant="outline"><Users /> {assignedCount} assigned</Button>
      </div>
      <div className="local-data-status depth-data-status"><span className={depthSaving ? 'sync-dot working' : 'sync-dot'} /><strong>{depthMessage}</strong><small>{lineup.length} team-defined {lineup.length === 1 ? 'position' : 'positions'} · {roster.length} roster athletes</small></div>

      <div className="depth-grid">
        <div className="depth-field">
          <div className="depth-field-header"><span>{group} alignment</span><small>{editing ? 'Drag a position card to move it, or use the precise controls' : 'Published team layout'}</small></div>
          <div className="depth-field-inner depth-custom-board" ref={depthBoardRef}>
            {!lineup.length ? <div className="viewer-empty-state"><Shirt /><strong>No positions in this unit</strong><span>Create only the roles and alignment your team uses.</span><Button onClick={() => setPositionDialogOpen(true)}><Plus /> Add first position</Button></div> : null}
            {lineup.map((slot) => {
              const athlete = roster.find((item) => item.id === slot.athleteId);
              return <button aria-label={`${slot.pos}, ${athlete?.name ?? 'unassigned'}${editing ? '. Drag to reposition.' : ''}`} className={`${selectedId === slot.id ? 'depth-player selected' : 'depth-player'}${draggingId === slot.id ? ' dragging' : ''}`} key={slot.id} onClick={() => setSelectedId(slot.id)} onPointerCancel={() => setDraggingId('')} onPointerDown={(event) => { if (!editing || event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedId(slot.id); setDraggingId(slot.id); movePositionCard(event, slot, false); }} onPointerMove={(event) => { if (editing && draggingId === slot.id) movePositionCard(event, slot, false); }} onPointerUp={(event) => { if (draggingId !== slot.id) return; movePositionCard(event, slot, true); setDraggingId(''); }} style={{ left: `${slot.x}%`, top: `${slot.y}%` }} type="button">{editing ? <GripVertical aria-hidden="true" /> : null}<span>{slot.pos}</span><strong>{athlete?.name ?? 'Unassigned'}</strong></button>;
            })}
          </div>
        </div>

        <aside className="depth-detail">
          {selected ? <>
            <div className="properties-heading"><strong>{selected.pos}</strong><Badge>{group}</Badge></div>
            <label className="depth-position-name" htmlFor="depth-position-name">Position name<Input disabled={!editing} id="depth-position-name" onBlur={() => void persistLayouts(layouts)} onChange={(event) => updateSlot(selected.id, { pos: event.target.value })} value={selected.pos} /></label>
            <div className="depth-rank starter"><span>1</span><span className="roster-avatar">{selectedAthlete?.name.split(' ').map((part) => part[0]).join('') || '—'}</span><div><strong>{selectedAthlete?.name ?? 'Unassigned'}</strong><small>{selectedAthlete ? `${selectedAthlete.position || 'No roster position'} · ${selectedAthlete.status}` : 'Choose a real roster athlete'}</small></div><Badge>Starter</Badge></div>
            <NativeSelect aria-label={`Choose ${selected.pos} starter`} className="depth-athlete-select" disabled={!editing || depthSaving} onChange={(event) => updateSlot(selected.id, { athleteId: event.target.value }, true)} value={selected.athleteId}><NativeSelectOption value="">Unassigned</NativeSelectOption>{roster.map((athlete) => <NativeSelectOption key={athlete.id} value={athlete.id}>{athlete.no === null ? '—' : `#${athlete.no}`} · {athlete.name}{athlete.position ? ` · ${athlete.position}` : ''}</NativeSelectOption>)}</NativeSelect>
            <div className="depth-coordinate-controls"><label htmlFor="depth-x">Horizontal position<input disabled={!editing} id="depth-x" max="94" min="6" onChange={(event) => updateSlot(selected.id, { x: Number(event.target.value) })} onPointerUp={() => void persistLayouts(layouts)} type="range" value={selected.x} /></label><label htmlFor="depth-y">Vertical position<input disabled={!editing} id="depth-y" max="92" min="8" onChange={(event) => updateSlot(selected.id, { y: Number(event.target.value) })} onPointerUp={() => void persistLayouts(layouts)} type="range" value={selected.y} /></label></div>
            <div className="property-divider" />
            <div className="detail-section compact"><div className="property-title"><strong>Role notes</strong><Lock /></div><Textarea placeholder="Add a real game or role note…" onBlur={async (event) => { await saveWorkspaceState(`depth-note-${group.toLowerCase().replaceAll(' ', '-')}-${selected.id}`, event.target.value); onNotify(`${selected.pos} note saved.`); }} /></div>
            <Button className="w-full" disabled={!editing} onClick={() => { const next = { ...layouts, [group]: lineup.filter((slot) => slot.id !== selected.id) }; setSelectedId(''); void persistLayouts(next, `${selected.pos} removed.`); }} variant="outline"><Trash2 /> Remove position</Button>
          </> : <div className="viewer-empty-state compact"><CircleDot /><strong>Select a position</strong><span>Add or select a position card to edit its name, athlete, and placement.</span></div>}
        </aside>
      </div>
      <Dialog onOpenChange={setPositionDialogOpen} open={positionDialogOpen}><DialogContent className="athlete-dialog sm:max-w-[460px]"><form onSubmit={addPosition}><DialogHeader><DialogTitle>Add a team position</DialogTitle><DialogDescription>Name the role exactly as your team uses it. You can assign an athlete and move it on the board next.</DialogDescription></DialogHeader><div className="athlete-form-grid"><label className="full" htmlFor="depth-new-position">Position name<Input id="depth-new-position" maxLength={24} name="positionName" placeholder="Example: Boundary half" required /></label></div><DialogFooter><Button onClick={() => setPositionDialogOpen(false)} type="button" variant="outline">Cancel</Button><Button type="submit">Add position <Plus /></Button></DialogFooter></form></DialogContent></Dialog>
    </section>
  );
}

type MessageRecord = { id: number; author: string; initials: string; time: string; text: string; own: boolean; reacted?: boolean; reactionCount?: number };
type MessageCentreState = { store: Record<string, MessageRecord[]>; channels: string[]; kinds: Record<string, 'channel' | 'direct'>; members: Record<string, string[]> };

const channels = [
  { name: 'Coaches', icon: Hash, unread: 0 },
  { name: 'Announcements', icon: Megaphone, unread: 0 },
  { name: 'Offence', icon: Hash, unread: 0 },
  { name: 'Defence', icon: Hash, unread: 0 },
  { name: 'Special teams', icon: Hash, unread: 0 },
  { name: 'Athlete leadership', icon: Lock, unread: 0 },
];

function MessagesView({ onNavigate, onNotify, teamSettings }: { onNavigate: (view: string) => void; onNotify: Notify; teamSettings: TeamSettings }) {
  const [activeChannel, setActiveChannel] = useState('Coaches');
  const [messageStore, setMessageStore] = useState<Record<string, MessageRecord[]>>({});
  const [channelNames, setChannelNames] = useState(channels.map((channel) => channel.name));
  const [channelKinds, setChannelKinds] = useState<Record<string, 'channel' | 'direct'>>(() => Object.fromEntries(channels.map((channel) => [channel.name, 'channel'])));
  const [memberStore, setMemberStore] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [conversationDialogOpen, setConversationDialogOpen] = useState(false);
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const messages = (messageStore[activeChannel] ?? []).filter((message) => message.text.toLowerCase().includes(messageSearch.toLowerCase()));
  const ActiveChannelIcon = channels.find((channel) => channel.name === activeChannel)?.icon ?? Hash;

  useEffect(() => {
    const defaultKinds = Object.fromEntries(channels.map((channel) => [channel.name, 'channel' as const]));
    loadWorkspaceState<MessageCentreState>('message-centre-v2', { store: {}, channels: channels.map((channel) => channel.name), kinds: defaultKinds, members: {} })
      .then((saved) => { setMessageStore(saved.store ?? {}); setChannelNames(saved.channels ?? []); setChannelKinds({ ...defaultKinds, ...saved.kinds }); setMemberStore(saved.members ?? {}); })
      .catch(() => onNotify('Saved conversations could not be loaded.', 'warning'));
  }, [onNotify]);

  const persistMessages = async (store = messageStore, names = channelNames, kinds = channelKinds, members = memberStore) => saveWorkspaceState('message-centre-v2', { store, channels: names, kinds, members });

  const sendMessage = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const next = { ...messageStore, [activeChannel]: [...(messageStore[activeChannel] ?? []), { id: Date.now(), author: 'You', initials: 'CM', time: 'Now', text, own: true }] };
    setMessageStore(next);
    setDraft('');
    try { await persistMessages(next); onNotify(`Message sent to ${activeChannel}.`); }
    catch { onNotify('The message could not be saved.', 'error'); }
  };

  const createConversation = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = formText(fields, 'conversationName').trim();
    const kind: 'channel' | 'direct' = fields.get('conversationKind') === 'direct' ? 'direct' : 'channel';
    if (!name) return;
    if (channelNames.some((item) => item.toLowerCase() === name.toLowerCase())) { onNotify('A conversation with that name already exists.', 'warning'); return; }
    const names = [...channelNames, name];
    const store = { ...messageStore, [name]: [] };
    const kinds: Record<string, 'channel' | 'direct'> = { ...channelKinds, [name]: kind };
    setChannelNames(names); setMessageStore(store); setChannelKinds(kinds); setActiveChannel(name);
    setConversationOpen(true);
    setConversationDialogOpen(false);
    await persistMessages(store, names, kinds);
    onNotify(`${name} created.`);
  };

  const addMember = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = formText(new FormData(event.currentTarget), 'memberName').trim();
    if (!name) return;
    const current = memberStore[activeChannel] ?? [];
    if (current.some((member) => member.toLowerCase() === name.toLowerCase())) { onNotify(`${name} is already in ${activeChannel}.`, 'info'); return; }
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
      return { ...message, reacted, reactionCount: Math.max(0, (message.reactionCount ?? 0) + (reacted ? 1 : -1)) };
    });
    const next = { ...messageStore, [activeChannel]: nextMessages };
    setMessageStore(next);
    try { await persistMessages(next); }
    catch { onNotify('The reaction could not be saved.', 'error'); }
  };

  return (
    <section className="module-surface messages-surface">
      <ModuleHeader
        eyebrow="Team communication"
        title="Messages"
        description="Film, plays, assignments, and decisions stay attached to the conversation."
      >
        <Button className="module-secondary" onClick={() => setSearchOpen((value) => !value)} variant="outline"><Search /> Search messages</Button>
        <Button className="module-primary" onClick={() => setConversationDialogOpen(true)}><Plus /> New message</Button>
      </ModuleHeader>

      <div className={`messages-layout${conversationOpen ? ' conversation-open' : ''}`}>
        <aside className="channel-sidebar">
          <div className="panel-title"><div><strong>{teamSettings.teamName || 'Team'}</strong><span>{channelNames.length} saved channels</span></div><Button aria-label="Workspace options" onClick={() => onNotify(`${teamSettings.teamName || 'Team'} messaging workspace is active.`, 'info')} size="icon-sm" variant="ghost"><MoreHorizontal /></Button></div>
          <p className="channel-label">Channels</p>
          {channelNames.filter((name) => channelKinds[name] !== 'direct').map((name) => {
            const channel = channels.find((item) => item.name === name);
            const Icon = channel?.icon ?? Hash;
            return (
            <button className={activeChannel === name ? 'channel-row active' : 'channel-row'} key={name} onClick={() => { setActiveChannel(name); setConversationOpen(true); }} type="button">
              <Icon /><span>{name}</span>{channel?.unread ? <b>{channel.unread}</b> : null}
            </button>
          )})}
          <p className="channel-label">Direct messages</p>
          {channelNames.filter((name) => channelKinds[name] === 'direct').map((name) => <button className={activeChannel === name ? 'channel-row active dm' : 'channel-row dm'} key={name} onClick={() => { setActiveChannel(name); setConversationOpen(true); }} type="button"><Users /><span>{name}</span></button>)}
          {!channelNames.some((name) => channelKinds[name] === 'direct') ? <div className="channel-empty">No direct conversations yet</div> : null}
          <button className="add-channel" onClick={() => setConversationDialogOpen(true)} type="button"><Plus /> Add people or channel</button>
        </aside>

        <div className="conversation">
          <header className="conversation-head">
            <div><button className="conversation-back" onClick={() => setConversationOpen(false)} type="button"><ChevronLeft /> Channels</button><span className="channel-icon"><ActiveChannelIcon /></span><div><strong>{activeChannel}</strong><small>Saved local channel</small></div></div>
            <div><Button aria-label="Channel options" onClick={() => setDetailsOpen((value) => !value)} size="icon" variant="ghost"><MoreHorizontal /></Button></div>
          </header>
          {searchOpen ? <div className="toolbar-search message-search"><Search /><Input aria-label="Search current conversation" onChange={(event) => setMessageSearch(event.target.value)} placeholder="Search this conversation…" value={messageSearch} /></div> : null}
          <div className="message-stream">
            {messages.length ? <div className="day-divider"><span>Messages</span></div> : <div className="viewer-empty-state"><MessageSquareText /><strong>No messages in {activeChannel}</strong><span>Write the first real message below.</span></div>}
            {messages.map((message) => (
              <article className={message.own ? 'message-row own' : 'message-row'} key={message.id}>
                <span className="message-avatar">{message.initials}</span>
                <div><div><strong>{message.author}</strong><small>{message.time}</small></div><p>{message.text}</p><button aria-label={message.reacted ? 'Remove thumbs up reaction' : 'Add thumbs up reaction'} aria-pressed={Boolean(message.reacted)} className={message.reacted ? 'message-reaction active' : 'message-reaction'} onClick={() => void toggleReaction(message.id)} type="button">👍 <span>{message.reactionCount ? message.reactionCount : 'React'}</span></button></div>
              </article>
            ))}
          </div>
          <form className="message-composer" onSubmit={sendMessage}>
            <Textarea aria-label={`Message ${activeChannel}`} onChange={(event) => setDraft(event.target.value)} placeholder={`Message #${activeChannel.toLowerCase().replace(' ', '-')}`} value={draft} />
            <div><span><Button aria-label="Attach file" onClick={() => onNotify('Choose Film or Play to attach saved team content.', 'info')} size="icon-sm" type="button" variant="ghost"><Paperclip /></Button><Button aria-label="Add emoji" onClick={() => setDraft((value) => `${value} 👍`)} size="icon-sm" type="button" variant="ghost"><Smile /></Button><Button onClick={() => { setDraft((value) => `${value}${value ? ' ' : ''}[Film attachment]`); }} size="sm" type="button" variant="ghost"><Film /> Add film</Button><Button onClick={() => { setDraft((value) => `${value}${value ? ' ' : ''}[Play attachment]`); }} size="sm" type="button" variant="ghost"><BookOpen /> Add play</Button></span><Button aria-label="Send message" disabled={!draft.trim()} size="icon" type="submit"><Send /></Button></div>
          </form>
        </div>

        {detailsOpen ? <aside className="chat-details">
          <div className="properties-heading"><strong>Conversation details</strong><Button aria-label="Close details" onClick={() => setDetailsOpen(false)} size="icon-sm" variant="ghost"><X /></Button></div>
          <div className="channel-summary"><span className="channel-icon large"><Hash /></span><h3>{activeChannel}</h3><p>Messages written here are saved to this local workspace.</p></div>
          <div className="property-divider" />
          <button className="detail-row-button" onClick={() => onNavigate('Film Room')} type="button"><Film /><span><strong>Shared film</strong><small>No attachments yet</small></span><ChevronRight /></button>
          <button className="detail-row-button" onClick={() => onNavigate('Playbook')} type="button"><BookOpen /><span><strong>Shared plays</strong><small>No attachments yet</small></span><ChevronRight /></button>
          <div className="property-divider" />
          <div className="property-title"><strong>Members</strong><Button onClick={() => setMemberDialogOpen(true)} size="xs" variant="ghost"><UserPlus /> Add</Button></div>
          {(memberStore[activeChannel] ?? []).length ? <div className="member-list">{memberStore[activeChannel].map((member) => <div key={member}><span className="dm-dot">{initialsFor(member)}</span><strong>{member}</strong><i /></div>)}</div> : <div className="channel-empty">No membership records are attached yet.</div>}
        </aside> : null}
      </div>
      <Dialog onOpenChange={setConversationDialogOpen} open={conversationDialogOpen}><DialogContent className="athlete-dialog sm:max-w-[500px]"><form onSubmit={createConversation}><DialogHeader><DialogTitle>Create a conversation</DialogTitle><DialogDescription>Choose what you are making and give it a name your staff will recognize.</DialogDescription></DialogHeader><div className="athlete-form-grid"><label htmlFor="conversation-kind">Conversation type<NativeSelect defaultValue="channel" id="conversation-kind" name="conversationKind"><NativeSelectOption value="channel">Team channel</NativeSelectOption><NativeSelectOption value="direct">Direct conversation</NativeSelectOption></NativeSelect></label><label htmlFor="conversation-name">Name<Input id="conversation-name" maxLength={48} name="conversationName" placeholder="Example: Quarterbacks" required /></label></div><DialogFooter><Button onClick={() => setConversationDialogOpen(false)} type="button" variant="outline">Cancel</Button><Button type="submit">Create conversation <MessageSquareText /></Button></DialogFooter></form></DialogContent></Dialog>
      <Dialog onOpenChange={setMemberDialogOpen} open={memberDialogOpen}><DialogContent className="athlete-dialog sm:max-w-[460px]"><form onSubmit={addMember}><DialogHeader><DialogTitle>Add a member</DialogTitle><DialogDescription>Add a saved local member name to {activeChannel}.</DialogDescription></DialogHeader><div className="athlete-form-grid"><label className="full" htmlFor="conversation-member-name">Member name<Input id="conversation-member-name" maxLength={64} name="memberName" placeholder="Full name" required /></label></div><DialogFooter><Button onClick={() => setMemberDialogOpen(false)} type="button" variant="outline">Cancel</Button><Button type="submit">Add member <UserPlus /></Button></DialogFooter></form></DialogContent></Dialog>
    </section>
  );
}

function ReportsView({ onNavigate, onNotify }: { onNavigate: (view: string) => void; onNotify: Notify }) {
  const [reportUnit, setReportUnit] = useState('Offence');
  const [reportFilm, setReportFilm] = useState<FilmPayload>({ assets: [], asset: null, clips: [] });
  useEffect(() => { fetch('/api/film', { cache: 'no-store' }).then(async (response) => await response.json() as FilmPayload).then(setReportFilm).catch(() => setReportFilm({ assets: [], asset: null, clips: [] })); }, []);
  const reportClips = reportFilm.clips.filter((clip) => clip.odk === reportUnit);
  const yardsFor = (clip: FilmClipRecord) => { const match = clip.result.match(/[+-]?\d+/); return match ? Number(match[0]) : null; };
  const numericYards = reportClips.map(yardsFor).filter((value): value is number => value != null);
  const positive = numericYards.filter((value) => value > 0).length;
  const explosive = numericYards.filter((value) => value >= 20).length;
  const complete = reportClips.filter((clip) => clip.down != null && clip.distance != null && Boolean(clip.result)).length;
  const grouped = reportClips.reduce<Record<string, FilmClipRecord[]>>((groups, clip) => { const key = clip.down ? `${clip.down}${clip.distance != null ? ` & ${clip.distance}` : ' down'}` : 'Down not charted'; (groups[key] ??= []).push(clip); return groups; }, {});
  const reportRows = Object.entries(grouped).map(([situation, clips]) => {
    const calls = clips.map(clipLabel); const topCall = calls.sort((a, b) => calls.filter((call) => call === b).length - calls.filter((call) => call === a).length)[0] ?? '—';
    const yards = clips.map(yardsFor).filter((value): value is number => value != null);
    return [situation, topCall, `${Math.round(clips.length / Math.max(1, reportClips.length) * 100)}%`, yards.length ? (yards.reduce((sum, value) => sum + value, 0) / yards.length).toFixed(1) : '—', `${clips.length}`];
  });
  return (
    <section className="module-surface reports-surface">
      <ModuleHeader eyebrow="Scouting intelligence" title="Reports" description="Turn every tagged snap into tendencies your coordinators can trust and act on.">
        <Button className="module-secondary" disabled={!reportRows.length} onClick={() => { const rows = [['Situation','Top saved play','Share of charted clips','Average yards','Clip count'], ...reportRows]; downloadText(`${reportUnit.toLowerCase().replaceAll(' ', '-')}-report.csv`, rows.map((row) => row.map(quoteCsv).join(',')).join('\n'), 'text/csv;charset=utf-8'); onNotify(`${reportUnit} report exported.`); }} variant="outline"><Download /> Export</Button>
        <Button className="module-primary" onClick={() => onNavigate('Gameplanning')}><Zap /> Build gameplan</Button>
      </ModuleHeader>
      <div className="planning-toolbar">
        <div className="segmented-control">{['Offence', 'Defence', 'Special teams'].map((unit) => <button className={reportUnit === unit ? 'active' : ''} key={unit} onClick={() => setReportUnit(unit)} type="button">{unit}</button>)}</div>
        <NativeSelect aria-label="Choose film dataset" defaultValue="current"><NativeSelectOption value="current">{reportFilm.asset?.title ?? 'No uploaded film'}</NativeSelectOption></NativeSelect>
        <Button onClick={() => onNavigate('Film Room')} variant="outline"><Film /> Chart film</Button>
      </div>
      <div className="report-kpis">
        <article><span className="metric-icon blue"><SlidersHorizontal /></span><div><small>Charted clips</small><strong>{reportClips.length}</strong><p>{reportFilm.clips.length} across all units</p></div></article>
        <article><span className="metric-icon teal"><CheckCircle2 /></span><div><small>Data completeness</small><strong>{reportClips.length ? Math.round(complete / reportClips.length * 100) : 0}%</strong><p>Down, distance, and result</p></div></article>
        <article><span className="metric-icon violet"><Film /></span><div><small>Positive results</small><strong>{numericYards.length ? Math.round(positive / numericYards.length * 100) : 0}%</strong><p>{numericYards.length} clips with yardage</p></div></article>
        <article><span className="metric-icon orange"><Zap /></span><div><small>Explosive clips</small><strong>{explosive}</strong><p>20 or more yards</p></div></article>
      </div>
      <div className="reports-layout">
        <div className="reports-main">
          <section className="analytics-card">
            <div className="analytics-head"><div><p className="eyebrow">Down and distance</p><h3>Charted tendency matrix</h3></div><Badge variant="secondary">{reportClips.length} clips</Badge></div>
            {reportRows.length ? <div className="tendency-table"><div className="tendency-table-head"><span>Situation</span><span>Top saved play</span><span>Share</span><span>Yds/play</span><span>Clips</span></div>{reportRows.map((row) => <button key={row[0]} onClick={() => onNavigate('Film Room')} type="button">{row.map((cell, index) => <span className={index === 2 ? 'rate-cell' : ''} key={`${index}-${cell}`}>{cell}</span>)}</button>)}</div> : <div className="viewer-empty-state compact"><SlidersHorizontal /><strong>No {reportUnit.toLowerCase()} clips charted</strong><span>Upload film and save clip data before ChalkTalk calculates tendencies.</span><Button onClick={() => onNavigate('Film Room')} size="sm">Open Film Room</Button></div>}
          </section>
        </div>
        <aside className="reports-rail">
          <section className="analytics-card insight-rail-card"><div className="analytics-head"><div><p className="eyebrow">Dataset health</p><h3>What is actually available</h3></div><Film /></div><article><span>1</span><div><strong>{reportFilm.asset ? 'Film uploaded' : 'Film missing'}</strong><p>{reportFilm.asset?.title ?? 'Add a real video before charting.'}</p></div></article><article><span>2</span><div><strong>{reportClips.length} clips for {reportUnit}</strong><p>{complete} have down, distance, and result data.</p></div></article><article><span>3</span><div><strong>{reportClips.filter((clip) => clip.playId).length} linked plays</strong><p>Link clips to saved plays for stronger call-sheet context.</p></div></article><Button className="w-full" disabled={!reportClips.length} onClick={() => onNavigate('Gameplanning')}>Use saved data in gameplan <ChevronRight /></Button></section>
        </aside>
      </div>
    </section>
  );
}

const initialGameplanObjectives: { title: string; detail: string; target: string }[] = [];
const initialGameplanBuckets: { name: string; plays: string[] }[] = [];

function GameplanningView({ onNavigate, onNotify }: { onNavigate: (view: string) => void; onNotify: Notify }) {
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
  const insights = gameplanFilm.filter((clip) => clip.note || clip.concept || clip.tags.length).slice(0, 8).map((clip) => ({ id: clip.id, title: clipLabel(clip), detail: clip.note || [clip.odk, clip.result].filter(Boolean).join(' · ') || 'Charted film clip', clips: 1 }));

  useEffect(() => {
    loadWorkspaceState('gameplan-week-5-v2', { unit: 'Offence', included: [] as string[], objectives: initialGameplanObjectives, callBuckets: initialGameplanBuckets })
      .then((saved) => { setUnit(saved.unit); setIncluded(saved.included); setObjectives(saved.objectives); setCallBuckets(saved.callBuckets); })
      .catch(() => onNotify('Saved gameplan changes could not be restored.', 'warning'));
    loadPlaybookData().then((data) => setGameplanPlays(data.plays)).catch(() => setGameplanPlays([]));
    fetch('/api/film', { cache: 'no-store' }).then(async (response) => await response.json() as FilmPayload).then((data) => setGameplanFilm(data.clips ?? [])).catch(() => setGameplanFilm([]));
  }, [onNotify]);

  const saveGameplan = async (changes: { unit?: string; included?: string[]; objectives?: typeof objectives; callBuckets?: typeof callBuckets }) => {
    const next = { unit: changes.unit ?? unit, included: changes.included ?? included, objectives: changes.objectives ?? objectives, callBuckets: changes.callBuckets ?? callBuckets };
    await saveWorkspaceState('gameplan-week-5-v2', next);
  };

  const sendPlanToInstall = async () => {
    if (!targetInstall || sendingInstall) return;
    setSendingInstall(true);
    try {
    await saveGameplan({});
    const selectedNames = Array.from(new Set(callBuckets.flatMap((bucket) => bucket.plays)));
    const selectedPlays = selectedNames.map((name) => gameplanPlays.find((play) => play.name === name)).filter((play): play is StudioPlay => Boolean(play));
    if (selectedPlays.length !== selectedNames.length) throw new Error('Some selected plays were renamed or deleted. Update the call sheet before sending.');
    const response = await fetch('/api/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packageId: targetInstall, playIds: selectedPlays.map((play) => play.id) }) });
    if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error || 'Unable to add plays to install.'); }
    onNotify(`${selectedPlays.length} plays added to the selected draft install.`);
    setInstallDialogOpen(false);
    onNavigate('Install');
    } finally { setSendingInstall(false); }
  };
  const addObjective = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const title = formText(fields, 'objectiveTitle').trim();
    if (!title) return;
    const next = [...objectives, { title, detail: formText(fields, 'objectiveDetail').trim(), target: formText(fields, 'objectiveTarget').trim() }];
    setObjectives(next); void saveGameplan({ objectives: next }); setObjectiveDialogOpen(false); onNotify('Objective added.');
  };
  const addCallSheetSection = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = formText(new FormData(event.currentTarget), 'sectionName').trim();
    if (!name) return;
    const next = [...callBuckets, { name, plays: [] }]; setCallBuckets(next); void saveGameplan({ callBuckets: next }); setSectionDialogOpen(false);
  };
  return (
    <section className="module-surface gameplan-surface">
      <Dialog open={installDialogOpen} onOpenChange={(open) => { if (!sendingInstall) setInstallDialogOpen(open); }}><DialogContent className="athlete-dialog"><DialogHeader><DialogTitle>Add gameplan plays to an install</DialogTitle><DialogDescription>Choose a draft package. Existing plays will not be duplicated.</DialogDescription></DialogHeader><NativeSelect aria-label="Destination install" onChange={(event) => setTargetInstall(event.target.value)} value={targetInstall}><NativeSelectOption value="">Choose an install…</NativeSelectOption>{installChoices.map((pack) => <NativeSelectOption key={pack.id} value={pack.id}>{pack.name} · {pack.unit}</NativeSelectOption>)}</NativeSelect><DialogFooter><Button disabled={sendingInstall} onClick={() => onNavigate('Install')} variant="outline">Manage installs</Button><Button disabled={!targetInstall || sendingInstall} onClick={() => void sendPlanToInstall().catch((error: unknown) => onNotify(error instanceof Error ? error.message : 'Unable to add plays.', 'error'))}>{sendingInstall ? 'Adding…' : 'Add plays'}</Button></DialogFooter></DialogContent></Dialog>
      <ModuleHeader eyebrow="Coordinator workspace" title="Gameplan" description="Bridge scouting evidence to your call sheet, install, and practice script.">
        <Button className="module-secondary" onClick={() => onNavigate('Reports')} variant="outline"><SlidersHorizontal /> Open reports</Button>
        <Button className="module-primary" disabled={!callBuckets.some((bucket) => bucket.plays.length)} onClick={() => { void fetch('/api/install').then(async (response) => { if (!response.ok) throw new Error('Unable to load installs.'); return await response.json() as { packages: InstallPackage[] }; }).then((data) => { setInstallChoices(data.packages.filter((pack) => !pack.publishedAt)); setTargetInstall(''); setInstallDialogOpen(true); }).catch((error: unknown) => onNotify(error instanceof Error ? error.message : 'Unable to load installs.', 'error')); }}><ClipboardList /> Add to install</Button>
      </ModuleHeader>
      <div className="workflow-stepper">
        <button className={gameplanFilm.length ? 'complete' : ''} onClick={() => onNavigate('Film Room')} type="button"><span>{gameplanFilm.length ? <Check /> : '1'}</span><div><strong>Film charted</strong><small>{gameplanFilm.length} saved clips</small></div></button>
        <i />
        <button className={insights.length ? 'complete' : ''} onClick={() => onNavigate('Reports')} type="button"><span>{insights.length ? <Check /> : '2'}</span><div><strong>Reports ready</strong><small>{insights.length} usable observations</small></div></button>
        <i />
        <button className="active" onClick={() => onNotify('You are editing the active gameplan.', 'info')} type="button"><span>3</span><div><strong>Build gameplan</strong><small>In progress</small></div></button>
        <i />
        <button onClick={() => onNavigate('Install')} type="button"><span>4</span><div><strong>Install</strong><small>Publish to team</small></div></button>
      </div>
      <div className="planning-toolbar gameplan-toolbar"><div className="segmented-control">{['Offence', 'Defence', 'Special teams'].map((item) => <button className={unit === item ? 'active' : ''} key={item} onClick={() => { setUnit(item); void saveGameplan({ unit: item }); }} type="button">{item}</button>)}</div><span className="autosave-status"><CheckCircle2 /> Saved locally</span><Button onClick={() => setBriefOpen(true)} variant="outline"><Eye /> Preview staff brief</Button></div>
      <div className="gameplan-layout">
        <aside className="insight-inbox">
          <div className="analytics-head"><div><p className="eyebrow">From reports</p><h3>Insight inbox</h3></div><Badge>{insights.length}</Badge></div>
          <p className="panel-helper">Add evidence-backed ideas to this week’s plan.</p>
          {insights.map((item) => <button className={included.includes(item.id) ? 'included' : ''} key={item.id} onClick={() => { const next = included.includes(item.id) ? included.filter((id) => id !== item.id) : [...included, item.id]; setIncluded(next); void saveGameplan({ included: next }); }} type="button"><span className="insight-check">{included.includes(item.id) ? <Check /> : <Plus />}</span><div><strong>{item.title}</strong><p>{item.detail}</p><small><Film /> {item.clips} linked clip</small></div></button>)}
          {!insights.length ? <div className="channel-empty">No film observations yet. Add notes or tags while charting clips.</div> : null}
        </aside>
        <div className="gameplan-board">
          <section className="gameplan-objectives"><div className="analytics-head"><div><p className="eyebrow">Identity</p><h3>Objectives</h3></div><Button onClick={() => setObjectiveDialogOpen(true)} size="sm" variant="ghost"><Plus /> Add</Button></div><div className="objective-grid">{objectives.map((objective, index) => <article key={`${objective.title}-${index}`}><span>{index + 1}</span><div><strong>{objective.title}</strong><p>{objective.detail || 'No detail added.'}</p><small>{objective.target || 'No target added.'}</small></div><Button aria-label={`Remove ${objective.title}`} onClick={() => { const next = objectives.filter((_, itemIndex) => itemIndex !== index); setObjectives(next); void saveGameplan({ objectives: next }); }} size="icon-sm" variant="ghost"><Trash2 /></Button></article>)}{!objectives.length ? <div className="channel-empty">No objectives yet.</div> : null}</div></section>
            <section className="call-sheet-builder"><div className="analytics-head"><div><p className="eyebrow">Call sheet builder</p><h3>Plan by situation</h3></div><div><span>{callBuckets.reduce((sum, bucket) => sum + bucket.plays.length, 0)} saved plays selected</span><Button onClick={() => setSectionDialogOpen(true)} size="sm" variant="ghost"><Plus /> Add section</Button></div></div><div className="call-buckets">{callBuckets.map((bucket, bucketIndex) => <article key={`${bucket.name}-${bucketIndex}`}><header><strong>{bucket.name}</strong><NativeSelect aria-label={`Add saved play to ${bucket.name}`} onChange={(event) => { const play = event.target.value; if (!play || bucket.plays.includes(play)) return; const next = callBuckets.map((item, index) => index === bucketIndex ? { ...item, plays: [...item.plays, play] } : item); setCallBuckets(next); void saveGameplan({ callBuckets: next }); event.target.value = ''; }} value=""><NativeSelectOption value="">Add saved play…</NativeSelectOption>{gameplanPlays.filter((play) => (play.unit ?? 'Offence') === unit && !bucket.plays.includes(play.name)).map((play) => <NativeSelectOption key={play.id} value={play.name}>{play.name}</NativeSelectOption>)}</NativeSelect></header>{bucket.plays.map((play, index) => { const savedPlay = gameplanPlays.find((item) => item.name === play); const linked = gameplanFilm.filter((clip) => clip.playId === savedPlay?.id).length; return <div key={`${play}-${index}`}><GripVertical /><span><b>{play}</b><small>{index === 0 ? 'Primary' : 'Complement'}</small></span><button onClick={() => onNavigate(linked ? 'Film Room' : 'Playbook')} type="button">{linked ? <><Film /> {linked}</> : <><BookOpen /> Open</>}</button><Button aria-label={`Remove ${play}`} onClick={() => { const next = callBuckets.map((item, itemIndex) => itemIndex === bucketIndex ? { ...item, plays: item.plays.filter((name) => name !== play) } : item); setCallBuckets(next); void saveGameplan({ callBuckets: next }); }} size="icon-sm" variant="ghost"><X /></Button></div>; })}</article>)}{!callBuckets.length ? <div className="viewer-empty-state compact"><ClipboardList /><strong>No call-sheet sections yet</strong><span>Add a situation, then choose from plays already saved in Playbook.</span></div> : null}</div></section>
        </div>
        <aside className="gameplan-rail">
          <section className="analytics-card"><div className="analytics-head"><div><p className="eyebrow">Plan health</p><h3>Ready to install</h3></div><strong className="health-score">{Math.min(100, (included.length ? 25 : 0) + (objectives.length ? 25 : 0) + (callBuckets.some((bucket) => bucket.plays.length) ? 50 : 0))}%</strong></div><div className="plan-checks"><span className={included.length ? '' : 'pending'}>{included.length ? <CheckCircle2 /> : <AlertCircle />} {included.length} film observations linked</span><span className={callBuckets.some((bucket) => bucket.plays.length) ? '' : 'pending'}>{callBuckets.some((bucket) => bucket.plays.length) ? <CheckCircle2 /> : <AlertCircle />} {callBuckets.reduce((sum, bucket) => sum + bucket.plays.length, 0)} saved plays selected</span><span className={objectives.length ? '' : 'pending'}>{objectives.length ? <CheckCircle2 /> : <AlertCircle />} {objectives.length} objectives defined</span></div><Button className="w-full" onClick={() => onNavigate('Practice Plans')} variant="outline">Build practice plan</Button></section>
        </aside>
      </div>
      <Dialog onOpenChange={setBriefOpen} open={briefOpen}><DialogContent className="athlete-dialog sm:max-w-[620px]"><DialogHeader><DialogTitle>Staff brief</DialogTitle><DialogDescription>{unit} · {included.length} report insights · {callBuckets.reduce((sum, bucket) => sum + bucket.plays.length, 0)} selected calls</DialogDescription></DialogHeader><div className="brief-preview">{objectives.map((objective, index) => <div key={objective.title}><Badge>{index + 1}</Badge><span><strong>{objective.title}</strong><small>{objective.detail}</small></span></div>)}</div><DialogFooter><Button onClick={() => { downloadText('staff-brief.txt', objectives.map((item, index) => `${index + 1}. ${item.title}\n${item.detail}`).join('\n\n')); onNotify('Staff brief downloaded.'); }}>Download brief <Download /></Button></DialogFooter></DialogContent></Dialog>
      <Dialog onOpenChange={setObjectiveDialogOpen} open={objectiveDialogOpen}><DialogContent className="athlete-dialog sm:max-w-[560px]"><form onSubmit={addObjective}><DialogHeader><DialogTitle>Add an objective</DialogTitle><DialogDescription>Capture the coaching purpose and an optional measurable target.</DialogDescription></DialogHeader><div className="athlete-form-grid"><label className="full" htmlFor="objective-title">Objective<Input id="objective-title" name="objectiveTitle" required /></label><label className="full" htmlFor="objective-detail">Coaching detail<Textarea id="objective-detail" name="objectiveDetail" /></label><label className="full" htmlFor="objective-target">Measurable target<Input id="objective-target" name="objectiveTarget" /></label></div><DialogFooter><Button onClick={() => setObjectiveDialogOpen(false)} type="button" variant="outline">Cancel</Button><Button type="submit">Add objective <Plus /></Button></DialogFooter></form></DialogContent></Dialog>
      <Dialog onOpenChange={setSectionDialogOpen} open={sectionDialogOpen}><DialogContent className="athlete-dialog sm:max-w-[460px]"><form onSubmit={addCallSheetSection}><DialogHeader><DialogTitle>Add a call-sheet section</DialogTitle><DialogDescription>Name the situation using your team’s terminology.</DialogDescription></DialogHeader><div className="athlete-form-grid"><label className="full" htmlFor="call-sheet-section">Section name<Input id="call-sheet-section" name="sectionName" placeholder="Example: Backed up" required /></label></div><DialogFooter><Button onClick={() => setSectionDialogOpen(false)} type="button" variant="outline">Cancel</Button><Button type="submit">Add section <Plus /></Button></DialogFooter></form></DialogContent></Dialog>
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
  const match = iso.match(/T(\d{2}):(\d{2})/);
  if (!match) return { hour: 15, minute: 0, label: '' };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const displayHour = hour % 12 || 12;
  return { hour, minute, label: `${displayHour}:${String(minute).padStart(2, '0')}` };
}

function eventPlacement(event: CalendarEventRecord, weekDates: string[]) {
  const day = Math.max(0, weekDates.indexOf(event.startsAt.slice(0, 10)));
  const start = eventClock(event.startsAt);
  const startMinutes = start.hour * 60 + start.minute;
  const durationMinutes = Math.max(30, Math.round((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000));
  return {
    day,
    start: Math.max(0, Math.min(5, Math.floor((startMinutes - 15 * 60) / 60))),
    span: Math.max(1, Math.min(3, Math.ceil(durationMinutes / 60))),
    meta: `${start.label} · ${event.location || 'Location TBD'}`,
    tone: event.eventType,
  };
}

function CalendarView({ onNavigate, onNotify, teamSettings }: { onNavigate: (view: string) => void; onNotify: Notify; teamSettings: TeamSettings }) {
  const [calendarView, setCalendarView] = useState('Week');
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventRecord[]>([]);
  const [eventOpen, setEventOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventRecord | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [eventSaving, setEventSaving] = useState(false);
  const [calendarMessage, setCalendarMessage] = useState('Loading saved schedule…');
  const [calendarRoster, setCalendarRoster] = useState<AthleteMetrics>(fallbackMetrics);
  const [newEventLocation, setNewEventLocation] = useState('');
  const weekDates = useMemo(() => calendarWeekDates(weekOffset), [weekOffset]);
  const weekEvents = useMemo(() => calendarEvents.filter((event) => weekDates.includes(event.startsAt.slice(0, 10))), [calendarEvents, weekDates]);
  const monthAnchor = useMemo(() => { const value = new Date(); value.setDate(1); value.setMonth(value.getMonth() + monthOffset); value.setHours(12, 0, 0, 0); return value; }, [monthOffset]);
  const monthEvents = useMemo(() => calendarEvents.filter((event) => { const value = new Date(event.startsAt); return value.getFullYear() === monthAnchor.getFullYear() && value.getMonth() === monthAnchor.getMonth(); }), [calendarEvents, monthAnchor]);
  const days = weekDates.map((date) => {
    const value = new Date(`${date}T12:00:00`);
    return `${value.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()} ${value.getDate()}`;
  });

  useEffect(() => {
    let active = true;
    fetch('/api/calendar-events')
      .then(async (response) => {
        const data = await response.json() as { events?: CalendarEventRecord[]; error?: string };
        if (!response.ok || !data.events) throw new Error(data.error ?? 'Unable to load calendar events.');
        return data.events;
      })
      .then((events) => { if (active) { setCalendarEvents(events); setCalendarMessage('Schedule saved locally'); } })
      .catch((error: unknown) => { if (active) setCalendarMessage(error instanceof Error ? error.message : 'Unable to load saved events.'); });
    fetch('/api/athletes', { cache: 'no-store' }).then(async (response) => await response.json() as { metrics?: AthleteMetrics }).then((data) => { if (active && data.metrics) setCalendarRoster(data.metrics); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const createCalendarEvent = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
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
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: value('title'),
          eventType: value('eventType'),
          startsAt: `${date}T${value('startTime')}:00-03:00`,
          endsAt: `${date}T${value('endTime')}:00-03:00`,
          location: value('location'),
          notes: value('notes'),
        }),
      });
      const data = await response.json() as { event?: CalendarEventRecord; error?: string };
      if (!response.ok || !data.event) throw new Error(data.error ?? 'Unable to create the event.');
      setCalendarEvents((events) => [...events, data.event!].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
      setCalendarMessage(`${data.event.title} added to the shared schedule`);
      setEventOpen(false);
      onNotify(`${data.event.title} added to the calendar.`);
    } catch (error) {
      setCalendarMessage(error instanceof Error ? error.message : 'Unable to create the event.');
    } finally {
      setEventSaving(false);
    }
  };

  const deleteCalendarEvent = async () => {
    if (!selectedEvent) return;
    setEventSaving(true);
    try {
      const response = await fetch(`/api/calendar-events?id=${encodeURIComponent(selectedEvent.id)}`, { method: 'DELETE' });
      const data = await response.json() as { deleted?: string; error?: string };
      if (!response.ok || !data.deleted) throw new Error(data.error ?? 'Unable to remove the event.');
      setCalendarEvents((events) => events.filter((event) => event.id !== selectedEvent.id));
      onNotify(`${selectedEvent.title} removed from the calendar.`, 'info');
      setSelectedEvent(null);
      setCalendarMessage('Schedule saved locally');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Unable to remove the event.', 'error');
    } finally {
      setEventSaving(false);
    }
  };

  const subscribeCalendar = () => {
    const format = (iso: string) => iso.replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}/, '').replace(/[+-]\d{2}00$/, '');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ChalkTalk//Team Calendar//EN', ...calendarEvents.flatMap((event) => ['BEGIN:VEVENT', `UID:${event.id}@chalktalk.local`, `DTSTART:${format(event.startsAt)}`, `DTEND:${format(event.endsAt)}`, `SUMMARY:${event.title}`, `LOCATION:${event.location}`, `DESCRIPTION:${event.notes.replaceAll('\n', '\\n')}`, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
    downloadText('chalktalk-calendar.ics', ics, 'text/calendar;charset=utf-8');
    onNotify('Calendar subscription file downloaded.');
  };

  const periodLabel = calendarView === 'Month' ? monthAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : `${new Date(`${weekDates[0]}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}–${new Date(`${weekDates[6]}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`;
  const periodEvents = calendarView === 'Month' ? monthEvents : weekEvents;
  const moveCalendar = (direction: number) => calendarView === 'Month' ? setMonthOffset((offset) => offset + direction) : setWeekOffset((offset) => offset + direction);
  const openNewEvent = () => { setNewEventLocation(teamSettings.practiceFacility || teamSettings.homeField || teamSettings.teamRoom || ''); setEventOpen(true); };

  return (
    <section className="module-surface calendar-surface">
      <ModuleHeader eyebrow="Team operations" title="Calendar" description="Keep film, install, practice, travel, and game-day work on one shared schedule."><Button className="module-secondary" onClick={subscribeCalendar} variant="outline"><Download /> Subscribe</Button><Button className="module-primary" onClick={openNewEvent}><Plus /> New event</Button></ModuleHeader>
      <div className="local-data-status"><span className={eventSaving ? 'sync-dot working' : 'sync-dot'} /><strong>{calendarMessage}</strong><small>{calendarEvents.length} events</small></div>
      <div className="planning-toolbar"><div className="calendar-nav"><Button aria-label={`Previous ${calendarView.toLowerCase()}`} onClick={() => moveCalendar(-1)} size="icon" variant="outline"><ArrowLeft /></Button><div><strong>{periodLabel}</strong><small>{periodEvents.length} saved {periodEvents.length === 1 ? 'event' : 'events'}</small></div><Button aria-label={`Next ${calendarView.toLowerCase()}`} onClick={() => moveCalendar(1)} size="icon" variant="outline"><ChevronRight /></Button></div><div className="segmented-control">{['Week', 'Month', 'Agenda'].map((item) => <button className={calendarView === item ? 'active' : ''} key={item} onClick={() => setCalendarView(item)} type="button">{item}</button>)}</div></div>
      <div className="calendar-layout">
        {calendarView === 'Week' ? <div className="week-calendar"><div className="week-head"><span>TIME</span>{days.map((day, index) => <div className={weekDates[index] === localDateKey(new Date()) ? 'today' : ''} key={day}><small>{day.split(' ')[0]}</small><strong>{day.split(' ')[1]}</strong></div>)}</div><div className="week-body"><div className="time-labels">{['3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM'].map((time) => <span key={time}>{time}</span>)}</div><div className="calendar-grid-lines">{Array.from({ length: 42 }, (_, index) => <i key={index} />)}</div>{weekEvents.map((event) => { const placement = eventPlacement(event, weekDates); return <button className={'calendar-event ' + placement.tone} key={event.id} onClick={() => setSelectedEvent(event)} style={{ gridColumn: placement.day + 2, gridRow: placement.start + 1 + ' / span ' + placement.span }} title={event.notes} type="button"><strong>{event.title}</strong><small>{placement.meta}</small></button>; })}</div></div> : <div className={`calendar-alternate ${calendarView.toLowerCase()}`}><div className="analytics-head"><div><p className="eyebrow">{calendarView} view</p><h3>{periodLabel}</h3></div><Badge>{periodEvents.length} events</Badge></div>{periodEvents.length ? periodEvents.map((event) => <button key={event.id} onClick={() => setSelectedEvent(event)} type="button"><span className={`calendar-type-dot ${event.eventType}`} /><span><strong>{event.title}</strong><small>{event.startsAt.slice(0, 10)} · {eventClock(event.startsAt).label} · {event.location || 'Location TBD'}</small></span><ChevronRight /></button>) : <div className="pb-empty"><CalendarDays /><strong>No saved events in this {calendarView.toLowerCase()}</strong><span>Use New event to add one.</span></div>}</div>}
        <aside className="calendar-rail"><section className="analytics-card"><div className="analytics-head"><div><p className="eyebrow">This week</p><h3>Upcoming</h3></div><span className="calendar-date">{weekEvents.length}</span></div>{weekEvents.length ? <div className="day-agenda">{weekEvents.slice(0, 4).map((item) => <div key={item.id}><b>{eventClock(item.startsAt).label}</b><i /><span><strong>{item.title}</strong><small>{item.location || 'Location TBD'}</small></span></div>)}</div> : <div className="pb-empty"><CalendarDays /><strong>No events scheduled</strong><span>Add the first real team event.</span></div>}</section><section className="analytics-card"><div className="analytics-head"><div><p className="eyebrow">Availability</p><h3>Team status</h3></div><Users /></div><div className="availability-metrics"><span><strong>{calendarRoster.active}</strong>Available</span><span><strong>{calendarRoster.limited}</strong>Limited</span><span><strong>{calendarRoster.out}</strong>Out</span></div><Button className="w-full" onClick={() => onNavigate('Athletes')} variant="outline">View roster availability</Button></section></aside>
      </div>

      <Dialog onOpenChange={setEventOpen} open={eventOpen}>
        <DialogContent className="athlete-dialog sm:max-w-[620px]">
          <form onSubmit={createCalendarEvent}>
            <DialogHeader><DialogTitle>Add calendar event</DialogTitle><DialogDescription>Put a team activity on the saved local schedule. It will be available to practice plans and gameplanning next.</DialogDescription></DialogHeader>
            <div className="athlete-form-grid">
              <label className="full" htmlFor="calendar-event-title"><span>Event title <b className="field-required" aria-hidden="true">*</b></span><Input id="calendar-event-title" name="title" required /></label>
              <label htmlFor="calendar-event-type">Type<NativeSelect defaultValue="practice" id="calendar-event-type" name="eventType"><NativeSelectOption value="practice">Practice</NativeSelectOption><NativeSelectOption value="film">Film</NativeSelectOption><NativeSelectOption value="install">Install</NativeSelectOption><NativeSelectOption value="game">Game</NativeSelectOption><NativeSelectOption value="staff">Staff</NativeSelectOption><NativeSelectOption value="meeting">Meeting</NativeSelectOption><NativeSelectOption value="travel">Travel</NativeSelectOption></NativeSelect></label>
              <label htmlFor="calendar-event-date"><span>Date <b className="field-required" aria-hidden="true">*</b></span><Input defaultValue={localDateKey(new Date())} id="calendar-event-date" name="date" required type="date" /></label>
              <label htmlFor="calendar-event-start"><span>Starts <b className="field-required" aria-hidden="true">*</b></span><Input defaultValue="16:00" id="calendar-event-start" name="startTime" required type="time" /></label>
              <label htmlFor="calendar-event-end"><span>Ends <b className="field-required" aria-hidden="true">*</b></span><Input defaultValue="17:30" id="calendar-event-end" name="endTime" required type="time" /></label>
              <label className="full" htmlFor="calendar-event-location">Location<div className="saved-location-row"><Input id="calendar-event-location" name="location" onChange={(event) => setNewEventLocation(event.target.value)} placeholder="Choose a saved location or type one" value={newEventLocation} /><NativeSelect aria-label="Use a saved location" onChange={(event) => { if (event.target.value) setNewEventLocation(event.target.value); }} value=""><NativeSelectOption value="">Saved locations…</NativeSelectOption>{[teamSettings.practiceFacility, teamSettings.homeField, teamSettings.teamRoom].filter(Boolean).map((location) => <NativeSelectOption key={location} value={location}>{location}</NativeSelectOption>)}</NativeSelect></div></label>
              <label className="full" htmlFor="calendar-event-notes">Notes<Textarea id="calendar-event-notes" name="notes" placeholder="Equipment, objectives, or arrival details…" /></label>
            </div>
            <DialogFooter><Button disabled={eventSaving} type="submit">{eventSaving ? 'Saving…' : 'Add to calendar'} <CalendarDays /></Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog onOpenChange={(open) => { if (!open) setSelectedEvent(null); }} open={Boolean(selectedEvent)}><DialogContent className="athlete-dialog sm:max-w-[520px]"><DialogHeader><DialogTitle>{selectedEvent?.title}</DialogTitle><DialogDescription>{selectedEvent ? `${selectedEvent.startsAt.slice(0, 10)} · ${eventClock(selectedEvent.startsAt).label} · ${selectedEvent.location}` : ''}</DialogDescription></DialogHeader><div className="event-detail-copy"><Badge>{selectedEvent?.eventType}</Badge><p>{selectedEvent?.notes || 'No additional notes.'}</p></div><DialogFooter><Button disabled={eventSaving} onClick={() => void deleteCalendarEvent()} variant="ghost"><Trash2 /> Remove</Button><Button onClick={() => setSelectedEvent(null)} variant="outline">Close</Button><Button onClick={() => { if (selectedEvent) { downloadText(`${selectedEvent.id}.txt`, `${selectedEvent.title}\n${selectedEvent.startsAt} – ${selectedEvent.endsAt}\n${selectedEvent.location}\n\n${selectedEvent.notes}`); onNotify('Event details downloaded.'); } }}>Download <Download /></Button></DialogFooter></DialogContent></Dialog>
    </section>
  );
}

type PracticePlanRecord = { id: string; gameId: string | null; title: string; practiceDate: string; durationMinutes: number; blocks: string[][]; generated: boolean };
const initialPracticeBlocks: string[][] = [];

function PracticePlansView({ onNavigate, onNotify }: { onNavigate: (view: string) => void; onNotify: Notify }) {
  const [generated, setGenerated] = useState(false);
  const [practiceBlocks, setPracticeBlocks] = useState<string[][]>(initialPracticeBlocks);
  const [playerView, setPlayerView] = useState(false);
  const [practicePlans, setPracticePlans] = useState<PracticePlanRecord[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [newSegmentOpen, setNewSegmentOpen] = useState(false);
  const selectedPlan = practicePlans.find((plan) => plan.id === selectedPlanId) ?? null;
  const durationMinutes = practiceBlocks.reduce((total, block) => total + (Number.parseInt(block[1], 10) || 0), 0);

  useEffect(() => {
    fetch('/api/practice-plans', { cache: 'no-store' }).then(async (response) => {
      const data = await response.json() as { plans?: PracticePlanRecord[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Unable to load practice plans.');
      const plans = data.plans ?? []; setPracticePlans(plans); const plan = plans[0]; setSelectedPlanId(plan?.id ?? ''); setGenerated(plan?.generated ?? false); setPracticeBlocks(plan?.blocks ?? []);
    }).catch(() => onNotify('Saved practice plans could not be restored.', 'warning'));
  }, [onNotify]);

  const savePractice = async (blocks = practiceBlocks, isGenerated = generated) => {
    const response = await fetch('/api/practice-plans', { method: selectedPlan ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(selectedPlan ? { id: selectedPlan.id, title: selectedPlan.title, practiceDate: selectedPlan.practiceDate, blocks, generated: isGenerated } : { title: 'Practice plan', practiceDate: localDateKey(new Date()), blocks, generated: isGenerated }) });
    const data = await response.json() as { plans?: PracticePlanRecord[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Unable to save the practice plan.');
    const plans = data.plans ?? []; setPracticePlans(plans); const saved = selectedPlan ? plans.find((plan) => plan.id === selectedPlan.id) : plans[0]; if (saved) { setSelectedPlanId(saved.id); setPracticeBlocks(saved.blocks); setGenerated(saved.generated); }
  };

  const createPractice = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const title = formText(fields, 'practiceTitle').trim();
    const practiceDate = formText(fields, 'practiceDate').trim();
    if (!title || !practiceDate) return;
    const response = await fetch('/api/practice-plans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, practiceDate, blocks: [], generated: false }) });
    const data = await response.json() as { plans?: PracticePlanRecord[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Unable to create the practice plan.');
    const plan = data.plans?.find((item) => item.title === title) ?? data.plans?.[0]; setPracticePlans(data.plans ?? []); setSelectedPlanId(plan?.id ?? ''); setPracticeBlocks(plan?.blocks ?? []); setGenerated(false); setNewPlanOpen(false); onNotify(`${title} created.`);
  };

  const generatePractice = async () => {
    const gameplan = await loadWorkspaceState<{ objectives: { title: string; detail: string }[]; callBuckets: { name: string; plays: string[] }[] }>('gameplan-week-5-v2', { objectives: [], callBuckets: [] });
    const generatedBlocks = [...gameplan.objectives.map((objective) => ['TBD', '10 min', objective.title, objective.detail, 'team']), ...gameplan.callBuckets.filter((bucket) => bucket.plays.length).map((bucket) => ['TBD', '15 min', bucket.name, `${bucket.plays.length} saved plays`, 'offence'])];
    if (!generatedBlocks.length) { onNotify('Add gameplan objectives or saved plays before generating practice.', 'info'); return; }
    setGenerated(true); setPracticeBlocks(generatedBlocks); await savePractice(generatedBlocks, true); onNotify('Practice plan generated from saved gameplan items.');
  };
  const addPracticeSegment = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const title = formText(fields, 'segmentTitle').trim(); if (!title) return;
    const start = formText(fields, 'segmentStart').trim() || 'TBD';
    const minutes = Math.max(1, Number.parseInt(formText(fields, 'segmentMinutes', '10'), 10) || 10);
    const focus = formText(fields, 'segmentFocus').trim();
    const group = formText(fields, 'segmentGroup', 'team').trim().toLowerCase() || 'team';
    const next = [...practiceBlocks, [start, `${minutes} min`, title, focus, group]]; setPracticeBlocks(next); await savePractice(next); onNotify('Practice segment added.');
    setNewSegmentOpen(false);
  };
  const deletePractice = async () => {
    if (!selectedPlan) return;
    const response = await fetch(`/api/practice-plans?id=${encodeURIComponent(selectedPlan.id)}`, { method: 'DELETE' });
    const data = await response.json() as { plans?: PracticePlanRecord[]; error?: string }; if (!response.ok) throw new Error(data.error ?? 'Unable to delete the practice plan.');
    const plans = data.plans ?? []; const next = plans[0]; setPracticePlans(plans); setSelectedPlanId(next?.id ?? ''); setPracticeBlocks(next?.blocks ?? []); setGenerated(next?.generated ?? false); onNotify(`${selectedPlan.title} deleted.`);
  };
  return (
    <section className={`module-surface practice-surface ${playerView ? 'player-preview' : ''}`}>
      <ModuleHeader eyebrow="Team preparation" title={selectedPlan?.title ?? 'Practice Plans'} description="Build a real minute-by-minute plan or generate segments from the gameplan you saved."><Button className="module-secondary" onClick={() => onNavigate('Gameplanning')} variant="outline"><Zap /> View gameplan</Button><Button onClick={() => setNewPlanOpen(true)} variant="outline"><Plus /> New plan</Button><Button className="module-primary" onClick={() => void generatePractice().catch((error: unknown) => onNotify(error instanceof Error ? error.message : 'Unable to generate practice.', 'error'))}><Sparkles /> {generated ? 'Refresh from plan' : 'Generate from plan'}</Button></ModuleHeader>
      <div className="planning-toolbar"><NativeSelect aria-label="Choose practice plan" onChange={(event) => { const plan = practicePlans.find((item) => item.id === event.target.value); setSelectedPlanId(event.target.value); setPracticeBlocks(plan?.blocks ?? []); setGenerated(plan?.generated ?? false); }} value={selectedPlanId}><NativeSelectOption value="">No saved plan</NativeSelectOption>{practicePlans.map((plan) => <NativeSelectOption key={plan.id} value={plan.id}>{plan.practiceDate} · {plan.title}</NativeSelectOption>)}</NativeSelect><Button disabled={!selectedPlan} onClick={() => void deletePractice().catch((error: unknown) => onNotify(error instanceof Error ? error.message : 'Unable to delete the plan.', 'error'))} variant="ghost"><Trash2 /> Delete plan</Button></div>
      <div className="practice-overview"><div><p className="eyebrow">{selectedPlan?.practiceDate ?? 'No date selected'}</p><h2>{durationMinutes} minutes planned</h2><span>{practiceBlocks.length} saved {practiceBlocks.length === 1 ? 'segment' : 'segments'}</span></div><div className="practice-load"><span><b>{practiceBlocks.filter((block) => block[4] === 'offence').length}</b>Offence</span><span><b>{practiceBlocks.filter((block) => block[4] === 'defence').length}</b>Defence</span><span><b>{practiceBlocks.filter((block) => block[4] === 'teams').length}</b>Teams</span><span><b>{practiceBlocks.filter((block) => !['offence', 'defence', 'teams'].includes(block[4])).length}</b>Team / prep</span></div><Button disabled={!practiceBlocks.length} onClick={() => { setPlayerView((value) => !value); onNotify(playerView ? 'Coach practice view restored.' : 'Player practice view enabled.', 'info'); }} variant="outline"><Eye /> {playerView ? 'Coach view' : 'Player view'}</Button></div>
      <div className="practice-layout">
        <div className="practice-builder"><div className="practice-builder-head"><div><strong>Practice timeline</strong><span>{selectedPlan ? 'Saved local plan' : 'Create a plan to begin'} · {practiceBlocks.length} segments</span></div><Button disabled={!selectedPlan} onClick={() => setNewSegmentOpen(true)} size="sm" variant="outline"><Plus /> Add segment</Button></div><div className="practice-timeline">{practiceBlocks.map((block, index) => <article className={'practice-block ' + block[4]} key={`${block[2]}-${index}`}><GripVertical /><div className="practice-time"><strong>{block[0]}</strong><small>{block[1]}</small></div><span className="block-tone" /><div className="practice-copy"><strong>{block[2]}</strong><p>{block[3] || 'No coaching focus added.'}</p></div><div className="practice-links"><span><Users /> {block[4] || 'Team'}</span></div><Button aria-label={'Remove ' + block[2]} onClick={() => { const next = practiceBlocks.filter((_, itemIndex) => itemIndex !== index); setPracticeBlocks(next); void savePractice(next); onNotify(`${block[2]} removed from practice.`); }} size="icon-sm" variant="ghost"><Trash2 /></Button></article>)}{!practiceBlocks.length ? <div className="viewer-empty-state compact"><ClipboardList /><strong>No practice segments yet</strong><span>Add a segment manually or generate one from saved gameplan items.</span></div> : null}</div></div>
        <aside className="practice-rail"><section className="analytics-card"><div className="analytics-head"><div><p className="eyebrow">Plan summary</p><h3>{selectedPlan?.title ?? 'No plan selected'}</h3></div><strong className="health-score">{durationMinutes}</strong></div><div className="plan-checks"><span className={practiceBlocks.length ? '' : 'pending'}>{practiceBlocks.length ? <CheckCircle2 /> : <AlertCircle />} {practiceBlocks.length} timeline segments</span><span className={generated ? '' : 'pending'}>{generated ? <CheckCircle2 /> : <AlertCircle />} {generated ? 'Generated from saved gameplan' : 'Manual plan'}</span><span className={durationMinutes ? '' : 'pending'}>{durationMinutes ? <CheckCircle2 /> : <AlertCircle />} {durationMinutes} total minutes</span></div><Button className="w-full" onClick={() => onNavigate('Install')} variant="outline">Review install load</Button></section><section className={generated ? 'generation-note visible' : 'generation-note'}><Sparkles /><div><strong>Generated from real plan data</strong><p>Only saved objectives and call-sheet sections were used.</p></div></section></aside>
      </div>
      <Dialog onOpenChange={setNewPlanOpen} open={newPlanOpen}><DialogContent className="athlete-dialog sm:max-w-[500px]"><form onSubmit={(event) => void createPractice(event).catch((error: unknown) => onNotify(error instanceof Error ? error.message : 'Unable to create a plan.', 'error'))}><DialogHeader><DialogTitle>New practice plan</DialogTitle><DialogDescription>Name the plan and choose its real practice date.</DialogDescription></DialogHeader><div className="athlete-form-grid"><label htmlFor="practice-plan-title">Plan name<Input id="practice-plan-title" name="practiceTitle" placeholder="Example: Tuesday team practice" required /></label><label htmlFor="practice-plan-date">Practice date<Input defaultValue={localDateKey(new Date())} id="practice-plan-date" name="practiceDate" required type="date" /></label></div><DialogFooter><Button onClick={() => setNewPlanOpen(false)} type="button" variant="outline">Cancel</Button><Button type="submit">Create plan <Plus /></Button></DialogFooter></form></DialogContent></Dialog>
      <Dialog onOpenChange={setNewSegmentOpen} open={newSegmentOpen}><DialogContent className="athlete-dialog sm:max-w-[560px]"><form onSubmit={(event) => void addPracticeSegment(event).catch((error: unknown) => onNotify(error instanceof Error ? error.message : 'Unable to add a segment.', 'error'))}><DialogHeader><DialogTitle>Add practice segment</DialogTitle><DialogDescription>Add a real block to {selectedPlan?.title ?? 'this plan'}.</DialogDescription></DialogHeader><div className="athlete-form-grid"><label htmlFor="practice-segment-title">Segment name<Input id="practice-segment-title" name="segmentTitle" required /></label><label htmlFor="practice-segment-start">Start time<Input id="practice-segment-start" name="segmentStart" type="time" /></label><label htmlFor="practice-segment-minutes">Minutes<Input defaultValue="10" id="practice-segment-minutes" min="1" name="segmentMinutes" type="number" /></label><label htmlFor="practice-segment-group">Group<NativeSelect defaultValue="team" id="practice-segment-group" name="segmentGroup"><NativeSelectOption value="team">Team</NativeSelectOption><NativeSelectOption value="offence">Offence</NativeSelectOption><NativeSelectOption value="defence">Defence</NativeSelectOption><NativeSelectOption value="teams">Special teams</NativeSelectOption></NativeSelect></label><label className="full" htmlFor="practice-segment-focus">Coaching focus<Textarea id="practice-segment-focus" name="segmentFocus" /></label></div><DialogFooter><Button onClick={() => setNewSegmentOpen(false)} type="button" variant="outline">Cancel</Button><Button type="submit">Add segment <Plus /></Button></DialogFooter></form></DialogContent></Dialog>
    </section>
  );
}

type InstallItemRecord = { id: string; playId?: string | null; type: string; title: string; group: string; due: string; complete: number };

type InstallReview = {
  id: string;
  itemId: string;
  athleteId: string;
  initials: string;
  name: string;
  position: string;
  reviewed: boolean;
  assignment: boolean;
  note: boolean;
  acknowledged: boolean;
};



function SettingsView({ assetRevision, onAssetsChanged, onNavigate, onNotify, teamSettings, onTeamSettingsChange }: { assetRevision: number; onAssetsChanged: () => void; onNavigate: (view: string) => void; onNotify: Notify; teamSettings: TeamSettings; onTeamSettingsChange: (settings: TeamSettings) => void }) {
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('Team profile');
  const [staffInviteOpen, setStaffInviteOpen] = useState(false);

  const saveSettings = async () => {
    try {
      await saveWorkspaceState('team-settings', teamSettings);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
      onNotify(`${activeTab} saved.`);
      return true;
    } catch { onNotify('Workspace settings could not be saved.', 'error'); return false; }
  };
  const updateSettings = (changes: Partial<TeamSettings>) => {
    const next = { ...teamSettings, ...changes };
    onTeamSettingsChange(next);
    setSaved(false);
  };
  const confirmStaffInvite = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = formText(fields, 'staffName').trim();
    const email = formText(fields, 'staffEmail').trim();
    if (!name || !email) return;
    const savedInvites = await loadWorkspaceState<Array<{ id: string; name: string; email: string; createdAt: string }>>('staff-invitations', []);
    await saveWorkspaceState('staff-invitations', [...savedInvites, { id: crypto.randomUUID(), name, email, createdAt: new Date().toISOString() }]);
    setStaffInviteOpen(false);
    onNotify(`Invitation confirmed for ${name}.`);
  };

  const tabs = ['Team profile', 'Season & schedule', 'Staff & permissions', 'Notifications', 'Local data'];
  return (
    <section className="module-surface settings-surface">
      <ModuleHeader
        eyebrow="Workspace"
        title="Settings"
        description="Control your team identity, season, permissions, and local prototype preferences."
      />
      <div className="settings-layout">
        <aside className="settings-nav">
          {tabs.map((item, index) => <button className={activeTab === item ? 'active' : ''} key={item} onClick={() => setActiveTab(item)} type="button">{index === 0 ? <Shield /> : index === 1 ? <CalendarDays /> : index === 2 ? <Users /> : index === 3 ? <Bell /> : <CloudOff />}{item}<ChevronRight /></button>)}
        </aside>
        {activeTab === 'Team profile' ? <div className="settings-card">
          <div className="settings-section-head"><div><h2>Team profile</h2><p>This information appears throughout ChalkTalk.</p></div><MediaAvatar assetKey="team-logo" className="large-crest home-crest" fallback={initialsFor(teamSettings.teamName)} label={`${teamSettings.teamName || 'Team'} logo`} revision={assetRevision} /></div>
          <div className="asset-manager-grid">
            {[
              { key: 'team-logo', label: 'Team logo', fallback: initialsFor(teamSettings.teamName), className: 'large-crest home-crest' },
              { key: 'opponent-logo', label: 'Opponent logo', fallback: 'OP', className: 'large-crest away-crest' },
              { key: 'coach-profile', label: 'Coach photo', fallback: 'CM', className: 'detail-avatar' },
              { key: 'player-profile', label: 'Player photo', fallback: 'PL', className: 'detail-avatar' },
            ].map((asset) => <article key={asset.key}><MediaAvatar assetKey={asset.key} className={asset.className} fallback={asset.fallback} label={asset.label} revision={assetRevision} /><div><strong>{asset.label}</strong><span>Uploaded file or initials fallback</span><div><MediaUploadControl assetKey={asset.key} label="Choose image" onNotify={onNotify} onUploaded={onAssetsChanged} /><Button onClick={async () => { try { await deleteMedia(asset.key); onAssetsChanged(); onNotify(`${asset.label} removed.`, 'info'); } catch { onNotify(`${asset.label} could not be removed.`, 'error'); } }} size="xs" variant="ghost"><Trash2 /> Remove</Button></div></div></article>)}
          </div>
          <div className="settings-form">
            <label htmlFor="team-name">Team name<Input id="team-name" onChange={(event) => updateSettings({ teamName: event.target.value })} value={teamSettings.teamName} /></label>
            <label htmlFor="program-level">Program level<NativeSelect className="w-full" id="program-level" onChange={(event) => updateSettings({ level: event.target.value })} value={teamSettings.level}><NativeSelectOption value="varsity">Varsity</NativeSelectOption><NativeSelectOption value="junior">Junior varsity</NativeSelectOption><NativeSelectOption value="club">Club</NativeSelectOption></NativeSelect></label>
            <label htmlFor="team-city">City<Input id="team-city" onChange={(event) => updateSettings({ city: event.target.value })} value={teamSettings.city} /></label>
            <label htmlFor="team-province">Province<NativeSelect className="w-full" id="team-province" onChange={(event) => updateSettings({ province: event.target.value })} value={teamSettings.province}><NativeSelectOption value="ns">Nova Scotia</NativeSelectOption><NativeSelectOption value="nb">New Brunswick</NativeSelectOption><NativeSelectOption value="on">Ontario</NativeSelectOption></NativeSelect></label>
          </div>
          <div className="property-divider" />
          <div className="settings-section-head compact"><div><h2>Team colours</h2><p>Used for crests, charts, and sideline labels.</p></div></div>
          <div className="colour-row">{['navy','red','gold','green'].map((colour) => <button aria-label={`Use ${colour} team colour`} aria-pressed={teamSettings.colour === colour} className={`colour-chip ${colour} ${teamSettings.colour === colour ? 'active' : ''}`} key={colour} onClick={() => updateSettings({ colour })} type="button">{teamSettings.colour === colour ? <Check /> : null}</button>)}<Button onClick={() => { updateSettings({ colour: 'teal' }); onNotify('Custom teal colour selected.', 'info'); }} variant="outline"><Plus /> Custom colour</Button></div>
          <div className="property-divider" />
          <div className="local-data-note"><CloudOff /><div><strong>Local prototype mode</strong><p>Your prototype runs entirely on this computer. Cloud sync, sign-in, and team invitations can be connected later.</p></div><Button onClick={() => onNavigate('Home')} variant="outline">Back home</Button></div>
          <div className="settings-section-save"><span>Save team identity, media choices, and colours together.</span><Button onClick={() => void saveSettings()}>{saved ? <Check /> : null}{saved ? 'Team profile saved' : 'Save team profile'}</Button></div>
        </div> : <div className="settings-card settings-secondary-card">
          <div className="settings-section-head"><div><h2>{activeTab}</h2><p>{activeTab === 'Season & schedule' ? 'Set the active season used across schedules and game-week tools.' : activeTab === 'Staff & permissions' ? 'Review local staff access and coaching roles.' : activeTab === 'Notifications' ? 'Choose whether ChalkTalk surfaces team reminders.' : 'Inspect and export the local prototype record.'}</p></div>{activeTab === 'Season & schedule' ? <CalendarDays /> : activeTab === 'Staff & permissions' ? <Users /> : activeTab === 'Notifications' ? <Bell /> : <CloudOff />}</div>
          {activeTab === 'Season & schedule' ? <div className="settings-form"><label htmlFor="season-year">Active season<Input id="season-year" onChange={(event) => updateSettings({ season: event.target.value })} value={teamSettings.season} /></label><label htmlFor="schedule-mode">Schedule<NativeSelect className="w-full" defaultValue="canadian" id="schedule-mode"><NativeSelectOption value="canadian">Canadian football</NativeSelectOption><NativeSelectOption value="custom">Custom season</NativeSelectOption></NativeSelect></label><label htmlFor="practice-facility">Practice facility<Input id="practice-facility" onChange={(event) => updateSettings({ practiceFacility: event.target.value })} placeholder="Practice field or facility" value={teamSettings.practiceFacility} /></label><label htmlFor="home-field">Home field<Input id="home-field" onChange={(event) => updateSettings({ homeField: event.target.value })} placeholder="Home game venue" value={teamSettings.homeField} /></label><label htmlFor="team-room">Team room<Input id="team-room" onChange={(event) => updateSettings({ teamRoom: event.target.value })} placeholder="Meeting or film room" value={teamSettings.teamRoom} /></label><Button onClick={() => void saveSettings().then((didSave) => { if (didSave) onNavigate('Calendar'); })} variant="outline"><CalendarDays /> Save &amp; open calendar</Button></div> : null}
          {activeTab === 'Staff & permissions' ? <div className="settings-list-actions"><button onClick={() => onNotify('Coach Martin has administrator access.', 'info')} type="button"><MediaAvatar assetKey="coach-profile" className="profile-avatar" fallback="CM" label="Coach Martin profile photo" revision={assetRevision} /><span><strong>Coach Martin</strong><small>Administrator · Offence</small></span><ChevronRight /></button><Button onClick={() => setStaffInviteOpen(true)}><UserPlus /> Invite staff</Button></div> : null}
          {activeTab === 'Notifications' ? <div className="settings-toggle-card"><button aria-pressed={teamSettings.notifications} onClick={() => updateSettings({ notifications: !teamSettings.notifications })} type="button"><Bell /><span><strong>Team reminders</strong><small>Install, practice, and schedule updates</small></span><span aria-hidden="true" className={teamSettings.notifications ? 'visual-toggle on' : 'visual-toggle'}><i /></span></button></div> : null}
          {activeTab === 'Local data' ? <div className="local-data-note"><CloudOff /><div><strong>Local D1 persistence is active</strong><p>Roster, schedule, workspace drafts, install progress, and settings remain on this computer.</p></div><Button onClick={() => { downloadText('chalktalk-settings.json', JSON.stringify(teamSettings, null, 2), 'application/json'); onNotify('Local settings backup downloaded.'); }} variant="outline"><Download /> Export settings</Button></div> : null}
          <div className="settings-section-save"><span>Changes stay in this section until you save them.</span><Button onClick={() => void saveSettings()}>{saved ? <Check /> : null}{saved ? `${activeTab} saved` : `Save ${activeTab.toLowerCase()}`}</Button></div>
        </div>}
      </div>
      <Dialog onOpenChange={setStaffInviteOpen} open={staffInviteOpen}><DialogContent className="athlete-dialog sm:max-w-[500px]"><form onSubmit={(event) => void confirmStaffInvite(event).catch((error: unknown) => onNotify(error instanceof Error ? error.message : 'Unable to save the invitation.', 'error'))}><DialogHeader><DialogTitle>Confirm staff invitation</DialogTitle><DialogDescription>Review the recipient before creating this invitation. No notification is sent until you confirm.</DialogDescription></DialogHeader><div className="athlete-form-grid"><label htmlFor="staff-invite-name">Staff name<Input id="staff-invite-name" name="staffName" required /></label><label htmlFor="staff-invite-email">Email<Input id="staff-invite-email" name="staffEmail" required type="email" /></label></div><DialogFooter><Button onClick={() => setStaffInviteOpen(false)} type="button" variant="outline">Cancel</Button><Button type="submit">Confirm invitation <Send /></Button></DialogFooter></form></DialogContent></Dialog>
    </section>
  );
}

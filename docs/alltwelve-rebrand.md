# AllTwelve rebrand — local non-prod handoff

Approved direction: cobalt identity on ink/charcoal surfaces, warm white type,
the A12 mark, and the Home / Play Designer / Film Room concept layouts.
Target: local non-production only. Stable production is not promoted by this goal.

## Completion checklist

- [x] Shared identity, favicon, metadata, accessible names, onboarding and account entry
- [x] Shared colour tokens, typography, spacing, controls, menus, popovers and dialogs
- [x] Home and player home; team switcher, search, sidebar and mobile navigation
- [x] Film player, library, charting, uploads, deletion and draft recovery
- [x] Designer, playbooks, formations/packages, installs, learning, printouts and leaderboard
- [x] Sideline, athletes and traditional depth chart
- [x] Reports, gameplans, calendar and practice plans
- [x] Messages, settings, permissions and backup controls
- [x] Internal names, API headers, exports, local tooling and recovery compatibility
- [x] Desktop, tablet and mobile review including populated/empty/error/disabled states
- [x] Build and functional checks; non-prod release; confirm prod release unchanged

## Baseline

The staging checkout predates the latest local visual fixes. Existing changes from
the original local checkout were carried forward before starting this rebrand,
including depth charts, messaging, controls and dialog improvements. They must
not be overwritten with the older staging versions.

## Naming boundaries to resolve

Persisted backup manifests, local storage names and service-control identifiers
need a migration path. Git history, an existing repository URL and an active
GitHub required-check rule are external references, not safe search-and-replace
targets. Do not break restoration or change production storage to remove a label.

## Working checkpoint — 11 November 2026

- Branch: `codex/alltwelve-rebrand`, carrying the newer local source forward.
- Local non-prod currently runs `d9ca236a3ced7dda1609373651830ee68531434c76baded05649da215d2bedfa`.
- Production settings were checked unchanged before and after each non-prod update.
- Shared SVG mark, favicon, browser metadata, onboarding, mobile brand and designer header are implemented.
- Home now uses the approved compact game strip, recent work, upcoming schedule,
  and install assignment layout, using only real saved data.
- Active code, API headers, filenames, scripts, docs and checks use the new name.
  README directs readers to the actual Git remote instead of embedding the old name.
- New local configurations preserve existing D1 names/IDs and R2 namespaces.
  Recovery validates backup schema/version independently of historical product prefixes.
- Type checking and build passed. 120 unit checks passed inside the restricted
  environment; the account-proxy check was blocked by loopback permissions and
  passed with loopback access. The additional compatibility check and all nine
  targeted account/storage/recovery checks passed.
- Browser inspected all sixteen main navigation destinations and opened athlete,
  depth-position and new-formation dialogs. Home geometry and shared palette
  were reviewed visually. Text-size audit found nested upload labels at 8px;
  these label fixes are now in the running non-prod release.

### Populated review pass

- Added opt-in `--review` to the existing disposable integration rehearsal. It
  holds isolated review servers after the checks pass; normal CI still exits.
  No synthetic records were added to team 333 or either user-facing database.
- Two successful integration runs verified rebranded API headers, local account
  access, saved plays, installs, athletes, messages, plans, backups and restart persistence.
- Visually reviewed populated Home, defensive play library/preview, locked play,
  duplicate/edit entry, designer tools, player editing palette, custom play-type
  menu, roster/detail, traditional depth rows/assignment editor and messaging.
- Reviewed Home and Messages at 390px, Home at 820px, and designer at 390px.
  Fixed the stacked designer logo and fixed-height header that hid mobile Save;
  confirmed the rebuilt mobile designer shows Details and Save together.
- Fixed 9px roster initials and 10px install percentages. Restored tablet branding
  between the sidebar and phone breakpoints. The follow-up tablet header fit rule
  (hide verbose account name / allow search to shrink) is released; 820px DOM width equals scroll width.
- Source scan of app/components/lib/scripts/tests/docs/public/recovery and workflow
  files finds no former product name. Existing Git remote/history and the old
  live controller are external transition concerns, not renamed by replacement.

### Film, settings and print pass

- Shared logo paths now serve the React identity, local account-entry pages and
  ink-friendly PDF footers. Practice PDF generated through the UI, downloaded,
  rendered with Poppler and visually checked: footer and plan content fit cleanly.
  Evidence: `outputs/alltwelve-practice-review.png` (disposable fixture data).
- Populated Film Room reviewed with a generated 12-second MP4 and three saved
  clips in an isolated instance: collapsed/expanded library, spreadsheet editor,
  teaching notes/timeline, and film deletion confirmation (cancelled).
  Corrected leftover teal/coral interaction accents and 8–10px panel labels.
- All five Settings subpages inspected. Corrected dark-theme data panel contrast,
  section-save captions and unnecessary minimum height on short subpages.
- Latest typecheck/build passed before the final CSS refinements; sixteen targeted
  print-layout and local-account checks passed. These refinements are released to non-prod; Data & privacy contrast was rechecked in the browser. Production configuration remained byte-for-byte unchanged.

### Teaching and player pass

- Populated Install, Learn, Leaderboard and teaching print selection/preview
  reviewed. Install review tracking shows the linked athlete's saved completion.
  Teaching PDF generation succeeds; browser download inspection timed out, so
  that PDF's final rendered page is not yet independently verified.
- PlayerWorkspace is a separate shell, now explicitly branded with shared A12,
  dark tokens, cobalt selection, readable inputs and responsive header controls.
  Reviewed a linked player's home, published diagram and Messages at desktop
  and 390px. Account permissions and stored completion remained intact.
- Install content/list surfaces now use shared charcoal cards instead of the
  remaining legacy navy. Typecheck and build passed before final input CSS.
- Consolidated remaining active analytics/planning/calendar/film cards and
  selected film rows onto flat shared surfaces, replacing legacy gradients.

## Handoff and verification limits

- Final build and typecheck passed. The four new brand/Home modules also pass
  targeted lint. Repository-wide lint is not clean; its findings are retained in
  `outputs/rebrand-lint.txt` and are not represented as passing.
- Final non-prod release: `d9ca236a3ced7dda1609373651830ee68531434c76baded05649da215d2bedfa`.
  Stable production configuration was compared byte-for-byte and left unchanged.
- All main destinations and shared controls were reviewed, with representative
  populated, empty, loading, disabled, dialog and responsive states. This is not
  a claim that every possible data combination was manually exercised.
- Teaching PDF generation and preview were checked; its downloaded final page
  could not be independently inspected because the browser download stalled.
  The shared PDF identity was rendered and verified in the practice PDF.
- Existing Git history, checkout directory, remote repository address, live
  production/controller and remote required-check rule are intentionally untouched.
  Before merging the renamed CI job, coordinate the required-check rule with it.
  The new local tooling source is rebranded and preserves existing storage names.
- Disposable review servers were stopped; user-facing non-prod remains running.
  User review: http://127.0.0.1:3102/ . No production promotion or remote push.

## Annotation follow-up

The first handoff missed shared legacy colours: empty media states, segmented
controls, status badges, search placeholders and the calendar grid/header.
These now resolve through AllTwelve tokens. Browser computed-style checks cover
Film, Sideline, Athletes, Depth Charts, Reports, Formations, Printouts, Calendar
and Messages. Collapsed navigation now separates logo/toggle/team rows, retains
the Playbook icon, and gives hidden-label submenu buttons accessible names and
tooltips. This supersedes the earlier blanket visual sign-off.

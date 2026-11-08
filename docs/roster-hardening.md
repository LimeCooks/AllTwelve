# Roster hardening

The athlete PATCH response previously selected its result by ID without team scope, even though the UPDATE itself was team-scoped. An authenticated owner supplying a different team's athlete ID could therefore receive that record without changing it. PATCH now checks ownership before applying any change and scopes its final read. POST's final read is scoped too. The regression test proves a foreign update returns 404, contains no athlete/private note, and leaves the record unchanged. This code defect does not establish that any real visitor accessed another record; the hosted pilot's audience remains owner-private.

Input validation now rejects non-finite/out-of-range percentages and invalid statuses or notes. Errors distinguish invalid input, ownership misses, duplicate numbers/emails and infrastructure failures. Email/jersey uniqueness remains team-scoped. Anonymous API calls retain the correct authentication status.

Roster load failures produce a retry screen instead of an editable empty roster. Staff notes use an explicit Save action; switching athletes, section navigation and page unload guard unsaved drafts. Pending writes are serialized, and a delayed response cannot select an unrelated athlete. Failed creates keep the dialog open with an error. Prototype-only save wording was removed. The disconnected Message/options/Profile-open buttons and hard-coded quiz/film completion claims were removed.

## Evidence

The automated suite now has 24 tests, including cross-owner athlete targeting, invalid percentages, duplicate-email isolation and save/reopen checks. Local browser tests saved a staff note, reopened it, verified that another athlete's note stayed separate, and checked both Keep editing guards plus explicit discard navigation. Two disposable profiles were then removed only after matching their exact IDs/emails/notes and checking for linked records; the original roster/metrics matched the retained pre-test snapshot.

The production-artifact rehearsal includes the foreign-athlete PATCH check. Earlier calendar/planning archives are not approved rollback targets because they predate this fix. The first fixed baseline passed restart-only verification; subsequent releases can rehearse rollback to a compatible fixed baseline.

## Profile corrections

The profile editor now updates names, jersey number, position, unit, grade, height/weight and contacts while retaining the same athlete ID. Notes, availability, eligibility and progress are excluded from the profile UPDATE, so an older open profile form cannot overwrite them. Jersey/email collision checks exclude the current athlete and remain team-scoped. Invalid or foreign writes leave the saved profile untouched. Unassigned jerseys sort after numbered athletes consistently across saves and reloads, including jersey zero.

Tests cover correction, number clearing, duplicate rejection, owner isolation and preservation of notes/status/progress even when stale values are submitted with the profile. Browser verification corrected a disposable athlete's last name, jersey to zero, position and phone; a duplicate email was rejected without losing the entered changes. A valid save reopened with its original staff note. Unsaved form closure was tested with Keep editing and explicit Discard. Test profiles were removed with the guarded local cleanup and the pre-test roster/metrics matched exactly. The production-artifact rehearsal also corrects a profile and checks that it survives version changes.

The phone viewport check also exposed a shared responsive rule hiding every module's header actions. Those actions now wrap below the heading with usable targets. Shared dialogs are bounded to the dynamic viewport and scroll internally. At 390×844, Add athlete was accessible, the dialog heading/Close remained in bounds, and scrolling reached the form's submit button. The empty form was closed without creating a record and the viewport override was reset. These browser checks do not establish real iOS keyboard/touch behavior.

## Remaining work

Safe athlete removal/archive, actual account-to-athlete membership and review-derived learning progress remain incomplete. Physical phone/tablet editing and authenticated hosted roster workflows still need verification. A saved install percentage alone does not prove quiz or film completion.

## Staff-note conflicts and responsive athlete details — November 8

Staff-note PATCH requests now include the note baseline that was actually opened in the editor. The UPDATE compares that exact saved text in its WHERE clause and returns 409 without applying any requested field when it no longer matches. The comparison happens atomically with the write, so an edit arriving between ownership preflight and commit cannot be overwritten. Missing baselines require reloading. Availability-only changes stay independent. Conflict responses retain their own message rather than being incorrectly labelled as jersey/email collisions.

The browser keeps the note baseline separate from the selected athlete response. If an availability save returns a newer note, a clean editor adopts it; a dirty editor retains both its original baseline and draft, so the availability response cannot authorize overwriting the newer note. Conflicts offer a draft JSON download with a retained link and an explicit reload confirmation. Keep editing preserves the draft. A failed reload keeps it open and leaves the saved selection intact; successful reload replaces the draft only after the requested athlete has been found and validated. There is no automatic merge or offline note autosave. The generated download/fallback link was checked in the browser; saving that file to the OS Downloads folder was not established in this environment.

The phone/tablet check exposed a separate broken workflow: below 1100px the profile sidebar was hidden, while its Open button only selected an athlete and revealed nothing. On those widths, Open now reveals and focuses the selected athlete details below the roster, including profile editing, availability and staff notes. Back to roster returns to the list. Explicit athlete search/deep links and newly saved profiles reveal the same detail view. Desktop layout stays in its existing two-column form.

Validation: 74 tests pass, including stale/missing baselines, atomic rejection of combined note/status changes, independent availability updates, a note changed immediately before the UPDATE, and cross-owner rejection. Local browser QA verified clean-note adoption after an availability save, dirty-note preservation through another availability change, stale-save rejection, Keep editing, a failed reload retaining the draft, successful explicit reload and a fresh note save. The detail opener and recovery dialog were checked at 390px and 820px. Only a disposable unlinked athlete was modified; cleanup restored the exact original roster and metrics. Physical phone/tablet roster editing remains an owner handoff check.

The production-artifact rehearsal now requires stale-note rejection at every restart/version stage. Older builds without this guard are not approved rollback targets for this release. Use restart-only for the first corrected baseline; future rollback candidates must pass the strengthened check. Other profile/availability fields do not yet have full multi-field revision protection, and safe athlete removal/membership remain separate work.


## Guarded removal of unused entries

The owner confirmed on a physical phone/tablet that Open exposes the athlete profile, availability, and editable staff note. A separate Remove roster entry action now performs a fresh, owned read and names the exact athlete in a confirmation dialog. An explicit checkbox is required. Unsaved profile/note changes and in-flight roster writes block starting removal. Failed or uncertain removals require reloading the roster before another attempt.

Removal permanently deletes only an unused roster entry and its staff note. Existing backups and uploaded files remain. Relational depth assignments, install reviews, exact athlete-ID values anywhere in the team's saved JSON, and unreadable JSON all prevent removal. A SHA-256 version over every raw athlete column catches stale confirmations, and a single conditional DELETE repeats every row/link check atomically, protecting changes arriving after preflight. A depth-chart save rechecks roster membership in the same SQL statement; generic workspace writes cannot bypass the dedicated v3 depth service.

Regression coverage includes ownership/authentication, absent versions, stale availability, late note/reference changes, linked relational and JSON work, malformed saved JSON, repeated removal, and a depth save racing a removal. Local phone viewport checks confirmed the checkbox gate, cancel, and unsaved-note protection. A real local Worker/API test rejected a stale confirmation, removed one disposable athlete, and restored the exact initial roster and metrics. This is removal of unused entries, not archival or staff/player membership management.

The production-artifact rehearsal requires linked-athlete protection, foreign read rejection, stale removal rejection, and successful disposable removal at every restart/version stage. Earlier archives lack these guarantees and are not approved rollback targets; this first removal baseline uses restart-only verification.

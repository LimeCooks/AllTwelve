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

## Remaining work

Safe athlete removal/archive, actual account-to-athlete membership and review-derived learning progress remain incomplete. Physical phone/tablet editing and authenticated hosted roster workflows still need verification. A saved install percentage alone does not prove quiz or film completion.

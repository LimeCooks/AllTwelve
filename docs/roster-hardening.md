# Roster hardening

The athlete PATCH response previously selected its result by ID without team scope, even though the UPDATE itself was team-scoped. An authenticated owner supplying a different team's athlete ID could therefore receive that record without changing it. PATCH now checks ownership before applying any change and scopes its final read. POST's final read is scoped too. The regression test proves a foreign update returns 404, contains no athlete/private note, and leaves the record unchanged. This code defect does not establish that any real visitor accessed another record; the hosted pilot's audience remains owner-private.

Input validation now rejects non-finite/out-of-range percentages and invalid statuses or notes. Errors distinguish invalid input, ownership misses, duplicate numbers/emails and infrastructure failures. Email/jersey uniqueness remains team-scoped. Anonymous API calls retain the correct authentication status.

Roster load failures produce a retry screen instead of an editable empty roster. Staff notes use an explicit Save action; switching athletes, section navigation and page unload guard unsaved drafts. Pending writes are serialized, and a delayed response cannot select an unrelated athlete. Failed creates keep the dialog open with an error. Prototype-only save wording was removed. The disconnected Message/options/Profile-open buttons and hard-coded quiz/film completion claims were removed.

## Evidence

All 17 automated tests pass, including cross-owner athlete targeting, invalid percentages, duplicate-email isolation and save/reopen checks. Local browser tests saved a staff note, reopened it, verified that another athlete's note stayed separate, and checked both Keep editing guards plus explicit discard navigation. Two disposable profiles were then removed only after matching their exact IDs/emails/notes and checking for linked records; the original roster/metrics matched the retained pre-test snapshot.

The production-artifact rehearsal now includes the foreign-athlete PATCH check. Earlier calendar/planning archives are not approved rollback targets because they predate this fix. Use restart-only verification for the first corrected baseline until a compatible fixed rollback artifact exists.

## Remaining work

Full profile editing, safe athlete removal/archive, actual account-to-athlete membership and review-derived learning progress remain incomplete. Physical phone/tablet editing and authenticated hosted roster workflows still need verification. A saved install percentage alone does not prove quiz or film completion.

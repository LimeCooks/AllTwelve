# Hosted Install follow-up

## Preserved publication material — local Non-Prod, 10 November 2026

New publications retain an independent copy of each issued diagram, play name/unit, position assignment and coaching note. The copy, roster review assignments and publication timestamp are written in one transaction. Pre-existing unreadable material prevents publication; late eligibility failures leave no partial copy or reviews. Retrying publication does not replace an issued copy. Normal source-play and formation locks remain in place.

Coach Install and the restricted player workspace read the same preserved material. Future source changes or loss do not substitute different teaching or remove the saved version. The copies live in protected team-scoped workspace records and are included in the existing portable manual backup without changing its 19-table schema.

Older publications without a copy remain explicitly labelled as current-library previews, not reconstructed historical versions. Their prior review records are retained; new player acknowledgements require a newly published install. Corrupt preserved material fails visibly instead of silently falling back to the live library.

Evidence: 120 passing tests and type checking; `outputs/local-pilot-check-Oz9b6J/report.json` verifies the actual production build, matching coach/player material, restart persistence, downloadable ZIPs and independent offline recovery of issued material plus team messages. Separate browser checks opened the preserved coach preview and the player version at 390px with secondary details collapsed. Raw source-change/loss and corruption cases use disposable SQLite tests, not user data. The first expanded rehearsal used a JSON-bodied request unlike the actual backup button and stalled; the corrected body-free app request passed. Prod retains its earlier release.

The historical notes below describe the earlier implementation.

This supplements the historical local-only audit in `playbook-install-audit.md`. The hosted pilot now uses authenticated, team-scoped storage. Real player membership and account-to-athlete linking remain separate unfinished work; coach views never claim that a player received a notification or completed a review.

Install loads validate complete package, play and review data. Loading and failed reloads gate editing; a network failure cannot expose apparently empty or editable stale contents. Requests are sequenced so older reads cannot replace a newer selection. Missing selected packages can recover through View all installs. Mutation retries are locked while a write is in flight, and an unconfirmed save response requires a reload rather than an immediate duplicate write.

Details forms retain edits after save failures, warn before close/navigation/tab exit, and offer draft download plus explicit discard/reload when another device has changed the package. Metadata saves require a content version and compare the original name, unit, date and unpublished state in the write. There is no schema migration. An older open browser must refresh to obtain the version before editing details.

Adding and removing plays and deleting draft packages recheck the unpublished state at the SQL write. Metadata changes also recheck current unit compatibility. Publication assigns the current items to the current matching roster inside one batch, including any eligible items added after the preflight read. The batch's eligibility guard rejects unavailable plays, stale unit associations, empty installs and unmatched recipients; an invalid late change produces no partial review assignments. Unknown server errors return a generic failure; authentication errors retain their actual status. Other source-play edits and richer historical play snapshots still need continued concurrency review.

The saved diagram gets the main width. Play selection, assignments/notes and review tracking start collapsed. The play picker remains open after adding a play, marks it Added and gives a real filtered-empty explanation. Success notices dismiss automatically. Installs retain names and optional due dates without assuming a weekly, daily or monthly cadence.

Validation: 39 automated tests pass, including competing metadata saves, stale versions, owner isolation, anonymous rejection, malformed/wrong-package responses, inconsistent reviews and a play becoming unavailable between preflight and publication. Local browser checks saved renamed details, protected a dirty form, added an existing saved diagram without closing the picker, exercised its search-empty state, rejected a competing-device save while retaining the draft, and explicitly reloaded the latest package. The phone-sized details form fit at 390px. Stopping the local server showed disabled creation and an unavailable state instead of editable content; retry was initiated after restart, then development-server reconnection reloaded the page. Reopening Install restored the real saved installs. The disposable local package was removed, and all original installs and saved plays matched their pre-test snapshots. No hosted test records were created.

Remaining handoff gates include real player roles/linking, actual athlete completion, physical-device workflows, durable historical snapshots, recipient overrides and the owner's saved-play/file checks across devices. This follow-up does not claim those features are complete.


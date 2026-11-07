# Film workflow hardening

## Fixed failures

- Film registration previously referenced `game-hamilton-week-5` regardless of the team. A blank hosted database therefore rejected registration. A new film now starts without a game; an optional game must belong to the signed-in team.
- Every upload previously overwrote one storage key. Each new upload now receives its own key and library record. Retrying registration for the same stored file preserves its clips and saved metadata.
- Library buttons now load the selected film and that film's clips. Saving or deleting a clip returns its own film, rather than jumping to the newest upload.
- “New clip” no longer falls back to editing the first saved clip. New numbers use the highest existing number plus one. A database uniqueness constraint protects against concurrent duplicate numbers. Invalid clip times, duplicate numbers, overlong notes and foreign-team play links are rejected.
- Notes and charting fields are protected when switching films/clips, navigating away, or closing the page. Failed saves retain the draft. Upload controls await library registration before reporting success.
- The framework treats multipart POSTs as progressive form actions and rejects bodies above 1 MiB before reaching the media handler. The client now sends raw file requests with type, filename and size headers; the Worker uses `FixedLengthStream` to validate the byte count and stream to R2. Incomplete writes fail without replacing the old complete file. Legacy small multipart requests remain accepted by the handler.
- Home uses registered film records instead of the old prototype key, shows loading/failure states, and selects a saved play with a real drawing when available.
- Removed Film Room's pretend telestration button, misleading “Assign” navigation and write-only cut-up control. Existing saved cut-up JSON is preserved; a usable playlist/assignment flow remains future work.

## Verification

The isolated tests use the actual media and film handlers with two identities and the complete hosted schema. They cover raw uploads above 1 MiB, rejected size mismatches, failed overwrite preservation, multiple films, clip creation/deletion, selected-film response stability, foreign-team read/write rejection, invalid references and the blank team's absent sample game. Backup and recovery checks continue to pass against the new clip-number constraint.

The local browser additionally uploaded and played [MDN's public sample video](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video), saved two separately timed clips with distinct notes, uploaded a second file, reopened the first with both clips intact, and exercised film-switch and whole-workspace unsaved-change prompts. Home showed the actual saved film and a saved defensive diagram. Both temporary QA films, their clips and file objects were removed afterward. No test film was uploaded to the hosted pilot.

## Still unverified or incomplete

- Physical iPhone/iPad codec compatibility and touch playback.
- Large hosted uploads near the current application limit (250 MiB), plus resumable/multipart upload support for larger game footage. The successful local 1.1 MB test does not prove hosting ingress limits or large-upload reliability.
- A full film playlist, persistent film telestration, and clip-to-player assignment workflow.
- Cloud first-time onboarding and cross-device recovery still await the owner's authenticated session.

Do not describe the whole Film Room or pilot as complete based on these checks alone.

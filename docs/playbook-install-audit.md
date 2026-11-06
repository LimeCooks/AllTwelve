# Playbook and Install hardening

Scope: the existing local coaching workspace, Playbook → Install, and the Gameplan entry into Install. Hosting and real account authentication remain a separate stage.

## Fixed

| Finding | Result |
| --- | --- |
| All installs used a fixed `install-week-5` ID. | Named packages with explicit selection, independent content, optional due dates, and no recurring cadence assumption. The legacy package is retained; it is no longer recreated on every boot. |
| No package lifecycle or control over recipients. | Create/edit/delete drafts, choose plays, and publish. Publication assigns each play to matching roster athletes and rejects plays with no matching recipients. |
| Adding the same play could create duplicates or target the wrong package. | Destination ID is required. Adds are idempotent, including bulk Gameplan adds, and incompatible units are rejected. |
| Coach preview could write review completion for an arbitrary athlete. | Previews are read-only. Review writes return 403 until there is an authenticated, linked player identity. |
| Published teaching material could be edited or deleted after review. | Published packages and their plays are locked. Duplicate a play to revise it; the original teaching record remains. |
| Play saves could partially update before assignments failed. | Play and assignment updates use one transactional D1 batch. Invalid diagram coordinates, duplicate item IDs, and invalid formation references are rejected. |
| Player route selection could miss on a scaled/letterboxed field. | Pointer coordinates use the SVG screen transform. Player selection takes precedence over nearby route endpoints. |
| Unsaved edits disappeared during navigation. | Confirm before leaving the editor or cancelling; warn on page unload, disable previous/next while editing, and block role switching until save/cancel. |
| Film-like fake animation, future Import, ornamental row actions. | Removed animation and Import controls; reduced repeated toolbar actions and inspector footer. |
| Reminders reported delivery without sending anything. | Removed delivery claims and reminder controls. |
| Install invented an alignment for a play with no saved diagram. | Display honest missing-diagram copy. Saved diagrams, assignments, and coaching notes come from the real play. |
| Formation search field had no handler. | Search filters saved formations. New plays using a saved formation copy its actual saved alignment. |
| Native confirmation dialogs were unsupported in the embedded browser. | Playbook deletion uses product dialogs. |

## Validation

`pnpm test` exercises the actual API handlers and SQL in a temporary in-memory SQLite database using a D1 adapter. It does not touch the user's local data. Coverage includes save/reload, multi-point route and colour persistence, undated and dated packages, package isolation, duplicate adds, missing destinations, invalid dates, atomic failed bulk adds, publication validation, actual roster assignment, duplicate publication, rejected coach completion writes, locked published content, safe duplication, draft removal, and rollback on invalid assignment saves.

Browser verification covers draft creation, saved-play selection, persistence across reload, publication error display, explicit Playbook destination selection, and navigation confirmation from the editor. The production build and TypeScript check are also run.

## Remaining boundaries

- This is still a single-team local environment with a fixed server-side team ID. The Coach/Player switch is a preview, not authentication. Team authorization must be enforced server-side before a hosted team pilot.
- Real player completion requires account-to-athlete linking. It is deliberately unavailable rather than simulated.
- Published packages lock referenced plays rather than storing independent historical snapshots. This keeps existing review records stable; independent play versioning would allow more flexibility later.
- Recipients are captured at publication. Late roster additions and individual recipient overrides are not implemented; the UI does not claim otherwise.
- Import, animated playback, quizzes, and real reminder delivery are outside this pass. Their unfinished controls are absent from the audited screens.
- Gameplan still stores selected play names. Missing/renamed plays now block transfer instead of silently dropping them; changing the Gameplan storage model to play IDs remains future work.
- Existing runtime database initialization/migrations are retained. This pass needs no database schema change. Move startup migrations to deployment tooling as part of hosting work.

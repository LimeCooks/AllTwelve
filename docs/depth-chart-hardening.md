# Custom depth-chart reliability

The prior UI saved team-defined positions in workspace JSON while its roster loader required a fixed “Doubles” formation/chart. A fresh hosted team therefore could not load choices correctly. The UI kept editing available after failed reads, marked optimistic changes as saved, and its “Publish” action stored only a timestamp. Role notes were written on blur but never read back. Pointer-only slider saves missed keyboard changes; a canceled drag could leave an unsaved position looking saved.

The board now uses one authenticated `/api/depth-charts` read/write path for all three units and its real roster. A first-time team receives empty alignments and an empty roster without needing any formation or sample chart. Custom role names, starter IDs, coordinates and role notes are validated and saved together. Athletes can cover roles across units; foreign or unavailable athlete IDs cannot be saved. A missing athlete remains visibly unavailable rather than silently appearing unassigned.

All changes are explicit drafts until Save layout succeeds. Save failures preserve the draft and show the error. Section navigation and page unload are guarded. Reload requires explicit discard when dirty and offers a JSON draft download before replacement. The server uses a content version plus atomic compare-and-swap to reject competing stale writes. A load failure blocks editing and exposes Retry rather than offering editable blank defaults. “Publish” has been replaced with an honest Save action; no delivery or player visibility is implied.

The existing `depth-layouts-v2` board and separate role-note records are read into the model when no v3 chart exists. Missing legacy units and cleared null records retain their old blank semantics. Original legacy rows and the old relational depth-chart tables are preserved. The first successful explicit save writes `depth-layouts-v3` in the existing backed-up workspace table, leaving originals intact. Corrupt saved data fails without replacement.

Dragging tracks the active pointer, preserves the grab offset, ignores secondary touches and restores the starting coordinates on cancellation. Sliders and note inputs update the same draft with keyboard or pointer input. New positions stay within the board. On phones an unsaved-change bar places a reachable Save action above navigation; it disappears after success and is excluded from printing.

## Verification

Thirty-three tests pass. Actual handlers cover blank onboarding without a sample formation, legacy/custom note restoration, cleared and partial legacy boards, validation without overwriting saved data, missing/foreign roster assignments, same-version competing writes, corrupt-state preservation, authentication and owner isolation. Packaged release rehearsal creates a real assigned custom role and checks its notes/assignment through rollback and forward using the existing workspace-state endpoint. Older UI versions do not expose the v3 board.

Local browser QA added one disposable role, dragged it, saved its note/placement, reloaded and reopened both values. A simulated second device changed only that QA role; the stale browser save returned a conflict and retained its draft note. Keep editing preserved the draft; explicit discard/reload showed the newer saved note. At 390 × 844 a note was saved using the fixed phone save bar. The test role was then removed after verifying its exact ID, notes, coordinates and unchanged surrounding roles. All original depth-related database rows, timestamps, versions and roster choices were restored exactly. No hosted test positions were created.

## Remaining work

The present board assigns one starter per custom role. Backup ranking, multiple personnel packages/lineups, a dedicated print layout, physical touch/pointer-cancellation verification and real cloud cross-device checks remain unfinished. This is a hardened custom alignment workflow, not proof that the complete Depth Charts product or hosted handoff is finished.

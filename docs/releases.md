# Private pilot release and rollback procedure

The hosted pilot is the owner's persistent workspace. Development runs on localhost with the existing prototype. Release rehearsals run the actual packaged production Worker on loopback with fresh local D1/R2 storage under a unique ignored `outputs/release-rehearsal-*` directory. None of these three stores may be substituted for another.

## Before publication

1. Review the source diff and preserve `.openai/hosting.json`'s existing project ID and owner-private audience. Do not introduce a public Worker origin accepting identity headers. Keep credentials, `.wrangler`, outputs and uploaded files out of Git and deployment archives.
2. Run `pnpm test` and `pnpm run typecheck`, then build/package the exact reviewed source through the Sites source helper. Retain the candidate archive, its full commit SHA and the previous approved archive/version. Application build inputs must not change after validation.
3. Before a release that changes stored data or migrations, prepare/download the owner's full backup and confirm all parts are retained. A code rollback does not undo database migrations. Schema changes need a forward-compatible migration and a compatible prior build, or a tested forward fix. Never roll a live database back by copying a rehearsal database over it.
4. Rehearse the candidate and previous archive against temporary local storage:

   ```powershell
   node scripts/rehearse-release.mjs --candidate outputs/private-pilot-calendar.tar.gz --rollback outputs/private-pilot-planning.tar.gz
   ```

   Substitute the reviewed archive names for each release. The older calendar and planning builds in that example are historical evidence, **not approved rollback targets**: the later roster audit found a missing ownership check in their athlete update response. The strengthened rehearsal now tests that response too and must reject those builds. For the first corrected baseline, use `--restart-only` instead of `--rollback ...`; this tests restart persistence and isolation but explicitly grants no rollback approval. A future rollback target must contain the ownership fix and pass all current checks.

   The script accepts archives only under `outputs`, creates a fresh directory, applies the candidate's packaged migrations with `--local`, binds only to `127.0.0.1`, and uses a dummy local database/bucket configuration. It contains no deployment or remote-storage command. It never reads the prototype's storage or hosted team records.

5. Require a passed report. The script proves first-time blank onboarding for two fixture identities, anonymous and cross-origin rejection, saves a play/install/practice/event/file, switches candidate → previous build → candidate using the same isolated storage, and verifies persistence, concurrent owner isolation and full backup ZIP contents at each stage. Fixture identities simulate trusted ingress only on loopback; this does not prove the owner's hosted ChatGPT login.
6. Publish the matching pushed commit/archive to the same owner-private Site. Inspect the returned deployment status; continue the same deployment if pending rather than saving another version. Record the exact saved version/deployment IDs. Never enable automatic publication from the development server or share its data store with the pilot.
7. Verify the owner can sign in, open the existing workspace and complete the affected workflow on the intended devices. A successful deployment or local rehearsal alone is insufficient for polished-product handoff.

## Code rollback

Use the exact previous compatible saved version with the native private-version deployment operation. Do not recreate the Site, upload an unrelated archive, broaden sharing, or restore a database merely to revert code. After deployment succeeds, verify saved records/files and owner access. If a schema change prevents the prior build from working, use a forward fix or an explicitly reviewed recovery process instead.

The local rehearsal exercises switching actual Worker artifacts over persistent local data. It does **not** establish that a live hosted rollback or hosted disaster recovery has been exercised. Those remain separate handoff gates.

## Recorded rehearsal

The calendar build (`ca68fcdcacb2ee679bbf7d9cb13dd81f33bcb12b`) and preceding planning build (`d999a6c6675f73b1670d11b4642a0e826aa445a3`) passed the full local rehearsal. The retained machine-readable report is `outputs/release-rehearsal-0gnqsZ/report.json`; it includes archive SHA-256 hashes and completed stages. The owned Worker process was stopped between transitions and the last process exited successfully. Temporary fixture data remains only in that ignored rehearsal directory for inspection.

No hosted test team or records were created, and neither the original prototype nor the private pilot database was used by the rehearsal.

## Expanded designer persistence rehearsal — November 8

The rehearsal now creates and saves actual custom drawing geometry instead of only editing a play's teaching note. A defensive team formation with a coach-named personnel package initializes the defensive play. A separate scout offensive formation supplies opponent terminology and players. The saved play includes a three-point dashed route tied to a player, a rotated coverage ellipse attached to its end, a teaching label, opponent look and position assignment.

At candidate, rollback and forward-again stages, assertions compare every drawing array and field, formation scope/package/opponent metadata, and assignment content. The full backup manifest is checked against the same expected geometry and includes both formation records. Another owner sees no formations. The new isolated run passed in `outputs/release-rehearsal-YpnKlw/report.json`, using `private-pilot-backup-status.tar.gz` and `private-pilot-clip-conflicts.tar.gz`. This is persistence/ownership evidence, not proof of physical touch interaction. The fixtures remain only in that ignored rehearsal directory.

## Staff-note safety baseline — November 8

The rehearsal now submits a stale note baseline together with an availability change, requires 409, and verifies that both saved fields remain intact at each version/restart stage. Earlier archives lack this guard and are no longer approved rollback targets for this corrected baseline. Use `--restart-only` for its initial rehearsal; later rollback builds must include note protection and pass all checks. This adds a data-safety gate rather than treating unchanged row counts as proof against lost work.

## Named-gameplan baseline — November 8

The source now supports independent named gameplans with optional dates/opponents and archived state, rather than a single active planning slot. Existing active/legacy content is preserved as a virtual Previous gameplan and materialized only on an explicit save; neither original record is rewritten. Practice records retain source ID/title/revision after manual edits. New named records use dedicated owned/versioned writes. Older browsers must refresh to obtain the new API; generic legacy writes are rejected.

The strengthened rehearsal checks two independent named gameplans, team isolation, source-generated segments, stable source history after a manual adjustment, safe creation replay, archive/restore, stale generation rejection, persistence through restarts and exact source/segment content in backup manifests. The packaged application passed in `outputs/release-rehearsal-unmxo8/report.json`. Its first run stopped safely on an incorrect harness expectation: invalid generic keys return 400 before reaching protected-key rejection. The harness expectation was corrected; application code was unchanged for the passing run.

Use a restart-only baseline for this first protocol release. Earlier artifacts do not implement named gameplans or explicit practice sources and are not approved rollback targets for this workflow. This release adds no schema migration or automatic data rewrite. A future compatible artifact must pass the current strengthened rehearsal before being approved for rollback.

Published verification: source `4dbbe65b463f877766c4aa3318a38b1cc97c2c36` was packaged as `outputs/private-pilot-named-gameplans.tar.gz`, passed the final isolated rehearsal `outputs/release-rehearsal-MjkcRM/report.json`, and deployed successfully to the existing owner-private pilot. Deployment: `appgdep_6af12fb591cc81919813440cc830757d`; saved version: `appgprj_6aee2b7e04ac81919078454cbaae1b12~appgver_dd693d8dacb081918b710419548401bf`. The hosted browser opened the real owner's existing team and read its Previous gameplan successfully. No hosted record was created or edited during that read-only check. Desktop and 390px form proof are retained under outputs/named-gameplan-*.png. The owned local preview and sign-in adapter were stopped after verification.

## Saved practice printouts — November 8

The owner confirmed that a named gameplan objective and generated practice match across physical devices. This release adds a print workflow for those saved practices, with independent Printouts selection, fresh exact-revision checks, bounded previews and client-only PDF generation. It changes no database schema or saved-record protocol. Candidate checks must use the named-gameplan archive as the compatible prior baseline, not an earlier single-plan build. Source/backup persistence and team isolation are still required alongside browser/PDF output checks; native file saving and physical printing remain separate owner gates.

Published practice printout verification: source `edca115e76697176631065eb550c5d7544959f30`, archive `outputs/private-pilot-practice-printouts.tar.gz`, and compatible rollback `outputs/private-pilot-named-gameplans.tar.gz` passed `outputs/release-rehearsal-BYJQVk/report.json`. Deployment `appgdep_6af13569d8ac8191a3053c0d62335152` succeeded on the existing private pilot; saved version `appgprj_6aee2b7e04ac81919078454cbaae1b12~appgver_0812db6c640881918891dbad26288c8c`. Read-only hosted checks opened the existing owner's team and the new practice-script selector without fixture writes. The owner then confirmed the practice PDF opens and saves on a physical phone/tablet. Physical printer output remains unverified; PDF preparation, rendering and device opening/saving have separate recorded evidence.

## Player learning release — 9 November 2026

- App commit: ee58875508a25b99fb0f734d2036c128cb3d3097.
- Private deployment: appgdep_6af148a870f881919dbeb8fbc210903e (succeeded).
- Saved version: appgprj_6aee2b7e04ac81919078454cbaae1b12~appgver_5a8e616eade08191a6ef4692f6ae34db.
- Archive: outputs/private-pilot-player-learning.tar.gz.
- Compatible rollback: outputs/private-pilot-staff-access.tar.gz. Owner workflows remain available during rollback; the earlier build lacks player learning UI/API. Do not claim a rollback leaves newly added player functionality available.
- Evidence: 113 tests, type checking, local production-browser recipient/coach flow, and full candidate/rollback/forward report outputs/release-rehearsal-NiZPdI/report.json. Player acknowledgements survive transitions and appear in coach progress. Access-role isolation and no draft delivery are verified separately.
- Live owner verification: existing team and access controls load. Audience unchanged, no real invitations or external visitors created. Real staff approval and physical second-account checks remain pending. Quizzes remain WIP.

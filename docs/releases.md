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

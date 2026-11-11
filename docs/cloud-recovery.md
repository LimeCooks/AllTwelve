# Separate-destination cloud recovery

Status: the separate owner-private recovery service has restored the disposable release-rehearsal backup in hosted D1/R2. Independent native database reads match every source row across all 19 domain tables and confirm one new owner grant. The normal ChalkTalk application now opens that recovered team under the signed-in owner, including its defensive play and linked install. No recovery endpoint or overwrite action has been added to the live pilot.

## Local preparation

First use `scripts/restore-backup.mjs` with every ZIP part and an entirely new output folder, as described in [backups.md](backups.md). The recovery tool now retains SHA-256 digests computed from the ZIP-verified original bytes, along with the original backup time, parts, and byte total.

Then run:

```powershell
node scripts/prepare-cloud-recovery.mjs outputs/complete-offline-recovery
```

The command has no network or deployment operations. It opens the recovered SQLite database read-only, checks the current schema, database integrity, foreign keys, saved JSON, and sole recorded team/owner. It streams each recovered file through SHA-256 and compares it to the digest retained during ZIP recovery. Changed, missing, unsafe, incomplete or mismatched files prevent output. A successful check writes a new `cloud-recovery.json`; an existing output file is never replaced. Older offline folders without retained digests must be recreated from their original ZIP parts with the current tool.

The manifest contains all 19 domain tables and original media metadata plus file SHA-256s. It excludes ownership grants. The destination must derive the new owner from trusted sign-in, never from this manifest. Structured metadata is bounded to 18 MiB to accommodate the existing backup manifest and added file hashes; the existing file/part limits remain unchanged. Preparation streams media and does not buffer the library into memory.

## Destination invariants

`lib/recovery-plan.ts` validates exact current columns and tables, a single source team, consistent file totals/parts, SHA-256s, safe media keys, primitive database values, and readable saved JSON. Its D1 insert plan uses the existing foreign-key-safe table order and adds only the explicitly chosen trusted owner grant. The first statement checks for any domain or ownership rows inside the same transaction as the inserts. An existing destination, including one populated after validation, causes failure instead of merging or replacing data. D1 foreign keys must remain enabled; a missing parent must roll back the batch.

The database plan is only one part of the recovery boundary. The separate hosted service implements owner authentication, streamed/checksummed files, safe interruption/retry, inaccessible unverified data, an atomic empty-destination check, and exact completion verification. Large-library D1/runtime capacity still needs real hosted testing. Do not call this a completed cloud recovery feature based on the local plan tests.

## Current evidence

The handler/export test creates data in every domain table, exports two ZIP parts with private file metadata, restores them offline, prepares the cloud manifest, and imports that manifest into a separate empty database. Every domain row matches exactly, both file digests match, the old ownership grant is absent, and only the chosen new owner is bound. A deliberately changed file is rejected before output is created. Additional tests cover late destination population, broken foreign keys, injected owner tables, foreign-team rows, changed columns, unreadable JSON, unsafe/duplicate files, invalid digests and inconsistent totals. The preparation and import-plan checks passed; the expanded service suite is recorded below.

These preparation and import-plan tests use disposable local databases/files. The owner's hosted team, existing backups, prototype records, sharing policy, and manual backup preference are unchanged.

## Separate hosted transfer

The recovery lab uses its own checkout, source repository, D1 database and R2 bucket. Its Site ID is `appgprj_6af0e63e1a58819189af8bda60658078`; its URL is https://chalktalk-recovery-lab.liamcooks.chatgpt.site. The owner completed real sign-in and confirmed its initially empty recovery screen. The pilot retains its original Site ID and storage. No audience was broadened.

The transfer service accepts only trusted signed-in identity and same-origin writes. Preparation is immutable for a given destination. Every file upload verifies length and SHA-256 in R2; existing mismatched destination files are never replaced. Large files transfer as resumable 8 MiB chunks and are streamed into a final object whose complete SHA-256 must match the prepared backup before record restoration is enabled. Temporary chunks can be corrected with ETag-guarded replacement; complete restored objects remain immutable during recovery. Refresh can resume verified uploads, and an uncertain database confirmation is resolved by comparing exact saved rows and files rather than importing twice.

The ordinary manifest/file picker is present. This environment's automated file chooser incurred long delays, so the page also registers foreground WebMCP read/upload actions through the same visible upload helper. They require the active signed-in page and add no background server, plugin connection, service token or bypass identity. The hosted browser check rejected altered image bytes, accepted the correct image, and completed restoration using the visible confirmation. The database row audit is retained at `outputs/recovery-cloud-row-audit.json`. This proves the small rehearsal transfer; it does not prove cloud capacity at the maximum record/file limits.

The local real-Worker test also uploaded the first chunk of an 8 MiB-plus file, restarted over the same isolated store, resumed progress, rejected a wrong complete-file hash, corrected the temporary final chunk, and restored the original rehearsal records. All 87 tests and type checking pass, including authentication, cross-owner/cross-origin rejection, immutable retries, a lost commit response, late destination population, and checksum failures.

After native row verification, `scripts/stage-recovered-app.mjs` stages the normal application into that lab checkout while preserving the lab Site ID. It refuses the pilot checkout or an incomplete/mismatched row audit. It does not publish, migrate data or access hosted storage; the normal source/build/private-deploy workflow is still required. Keep the lab clearly separate from the owner's real workspace.

R2 integrity/conditional stream behavior follows the [official Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/). D1 batch execution remains bounded by the [official D1 limits](https://developers.cloudflare.com/d1/platform/limits/); full-limit cloud load testing and a simpler owner recovery handoff remain unfinished.


## Recovered application check

The normal application was built from committed source `c81e574` into the lab's source commit `20193211cfce5770df498187a15dd9ecd04dcf40`. The exact package passed the production-Worker restart rehearsal at `outputs/release-rehearsal-52CBEN/report.json`, then was deployed to the same recovery Site while retaining its D1/R2 bindings and already-restored data. No live-pilot deployment, database replacement, audience change or prototype migration occurred.

A second independent native database read after deployment still matched every row across all 19 domain tables and the new owner grant; see `outputs/recovery-cloud-application-audit.json`. The signed-in browser opened the restored workspace directly, loaded its uploaded team image, opened Rehearsal → Rehearsal defence, and rendered the exact segmented route (`M250 650 L250 620 L290 620`), attached ellipse, opponent look, custom colours and teaching label. Install opened Corrected rehearsal install with that same linked play and diagram. The screenshot `outputs/recovery-cloud-playbook.png` shows the recovered drawing. This completes the small, separate-destination cloud/application recovery rehearsal, including the new destination's real owner sign-in.

Remaining recovery handoff work: simplify the operator-assisted ZIP/manifest preparation, exercise maximum-size cloud transfers/record sets, and define retention/cleanup for backup and abandoned recovery copies. The recovery lab currently serves the normal application; the recovery-only service remains available as its prior saved source/version for a future separate empty destination. Do not deploy it over the owner's live pilot to test recovery or imply the pilot has a restore-over-live UI.


The owner subsequently confirmed that the real private pilot's manual backup ZIP saved to their device. This closes the real download-flow check; the separate hosted recovery used disposable rehearsal data, not that owner's downloaded archive.

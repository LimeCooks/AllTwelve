# Separate-destination cloud recovery

Status: preparation and database-import validation are implemented and tested locally. The hosted upload service, separate recovery deployment, and real cloud recovery exercise are not yet implemented or verified. No recovery endpoint or overwrite action has been added to the live pilot.

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

The database plan is only one part of the recovery boundary. Before exposing a hosted import, the service must also authenticate the owner, stream and checksum every file, support safe interruption/retry, keep unverified data inaccessible, recheck destination emptiness atomically, and verify completion. Large-library D1/runtime capacity still needs real hosted testing. Do not call this a completed cloud recovery feature based on the local plan tests.

## Current evidence

The handler/export test creates data in every domain table, exports two ZIP parts with private file metadata, restores them offline, prepares the cloud manifest, and imports that manifest into a separate empty database. Every domain row matches exactly, both file digests match, the old ownership grant is absent, and only the chosen new owner is bound. A deliberately changed file is rejected before output is created. Additional tests cover late destination population, broken foreign keys, injected owner tables, foreign-team rows, changed columns, unreadable JSON, unsafe/duplicate files, invalid digests and inconsistent totals. All 82 tests and type checking pass.

All of this evidence uses disposable local databases/files. The owner's hosted team, existing backups, prototype records, sharing policy, and manual backup preference are unchanged.

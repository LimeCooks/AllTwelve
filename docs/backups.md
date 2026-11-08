# Team backups and offline recovery

## Prepare and download

Open Settings → Data & privacy → Prepare backup. The database records are captured in one transaction. Uploaded files are then streamed into separate, private recovery objects, five per request. Settings shows progress and offers Continue preparing backup after an interruption or device change. A source upload must still match the snapshot when copied; a changed or missing source blocks completion and requires recovering that source or preparing a new snapshot. Incomplete backups have no download links.

Once ready, the backup uses the preserved file copies. Replacing or deleting an original film/image does not change those bytes or break that prepared backup. Download every ZIP part and keep the parts together. Preparing is not the same as downloading; check your device's download status.

The export contains all 19 team/domain tables plus uploaded image/video bytes and their original metadata. Ownership grants are excluded. All database reads, source objects, recovery copies and manifests are scoped to the authenticated owner's team. Another account cannot retrieve a backup using its ID. Internal `_backups/` objects are excluded from future source-media enumeration, preventing recursive backups.

Large libraries are split at file boundaries into parts containing up to 512 MiB of media plus the manifest. Each ZIP part contains the same `chalktalk-backup.json` and its own `media/` files. Copying and ZIP downloads use streaming backpressure, not whole-library buffering. The current limits remain 10,000 uploaded files, 16 MiB of structured records, and 512 MiB per file/ZIP media part; normal uploads remain limited to 250 MiB. Large-limit performance has not been load-tested.

## Interruption, replacement and retention

A stored progress count makes copying resumable. A retry recognizes previously copied matching objects. Progress updates compare the current manifest's ETag, so a delayed request cannot replace a newer preparation from another device. A completed snapshot also stores a write-once manifest alongside its independently preserved file set.

The current prepared download links last 24 hours or until another backup is prepared. Completed preserved snapshots also appear in the collapsed Saved backup history panel; their recovery-copy downloads remain available after those quick links expire or are replaced. Settings shows expiry, hides expired links, and restores current preparation status across navigation and devices. Older pre-copy snapshots remain readable but are explicitly labelled as depending on original uploads; prepare a new backup to gain independent copies.

Completed copy sets/manifests are retained and downloadable from Saved backup history. Preparation is intentionally manual, following the owner's November 8 preference. Automatic pruning/retention limits and an exercised cloud restore procedure are unfinished. Repeated preparation uses additional storage, and unfinished or replaced preparations can leave internal file copies until cleanup is implemented. Do not describe this as an unattended disaster-recovery service or imply that the UI can overwrite the live workspace from a retained snapshot. No hosted restore-over-live action exists.

## Offline recovery check

Requires this checkout's dependencies and Node 22.13+. Use an entirely new output path:

```powershell
node scripts/restore-backup.mjs --out outputs/recovery-check --owner-id recovery-check "C:\Downloads\chalktalk-part-1.zip"
```

Supply every part path for multipart backups; order does not matter. The tool never contacts the hosted pilot, never changes the prototype, and refuses an existing output directory. It creates `workspace.sqlite`, the original uploaded bytes under `media/`, and `recovery.json` with team/file metadata. The explicit owner ID binds the offline team; it is not a login credential and grants no hosted access.

Recovery verifies ZIP CRCs, sizes, available MD5 ETags, complete/matching parts, safe paths, schema/columns, team ownership and foreign keys. A failed attempt leaves `RESTORE_INCOMPLETE.txt`; retry into a different new directory. Never replace the live database with an offline recovery without a separate reviewed procedure.

Current offline recoveries also retain SHA-256 file digests for the separate-destination recovery preparation tool. See [cloud-recovery.md](cloud-recovery.md) for its local-only preparation and validation status. A hosted recovery service has not yet been exercised or exposed.

## Verification and limits

The actual handler/SQLite suite exports every domain table and uploaded bytes, restores into a new database, compares rows and metadata, and rejects corrupt/incomplete/duplicate archives, expired or replaced jobs, foreign owners and overwrite attempts. Preserved-copy cases cover 11-file batching, interruption/resume, missing sources, changed/deleted originals, and a competing preparation inserted immediately before progress commits.

Local browser QA showed a 5-of-6 preparation, blocked a missing sixth source, resumed after restoring identical source bytes, and exposed download links only at completion. All six disposable original videos were then removed; the backup still restored every original byte and every row across the 19 tables into a separate offline workspace. Disposable recovery objects were removed and the previous local prepared manifest restored. The hosted owner's records/files were not used for destructive QA.

The packaged production-Worker rehearsal checks the real streaming copy path and downloads original bytes after deliberately replacing a disposable source upload. Rollback compatibility keeps older prepared manifests readable through their original-source path; those older snapshots do not gain preserved bytes retroactively.

The prototype stores old messages in workspace JSON and lacks two unused relational messaging tables. Prototype export preserves that JSON and exports those absent tables as empty. Hosted export requires the complete deployed schema.

Implementation references: [R2 streaming and conditional operations](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [fflate streaming ZIP](https://github.com/101arrowz/fflate).


## Saved backup history

History starts collapsed and loads only when opened. It lists complete preserved snapshots in bounded pages, with creation time, record/file counts, part count and links for each ZIP part. Loaded entries are sorted by date; Load more retrieves further pages and merges them without duplicates. The current preparation remains visible above history. Archived downloads use the immutable manifest and preserved files rather than the current-preparation pointer, so replacement and its 24-hour expiry do not revoke those saved recovery copies.

Every listing and archive read derives the team from authenticated identity. IDs accept only UUIDs; page cursors stay within the team's fixed manifest prefix. Invalid, incomplete or failed history reads show an error instead of an apparently empty list. Older preserved manifests without listing metadata are read through the same scoped path. Incomplete preparations are never listed as completed backups.

The actual-handler tests cover old snapshots after replacement/expiry, paging, legacy manifest metadata, malformed IDs/cursors, missing records and cross-account/anonymous rejection. Local browser QA verified the collapsed default, two distinct snapshots after source replacement/deletion, and 390px download controls. Both ZIPs contained their respective original video bytes; the older ZIP restored all domain rows into a new offline workspace. Only disposable local snapshots were removed, and the prior local preparation was restored. The packaged release rehearsal also lists/downloads a saved archive and rejects a foreign owner's archive request.


Owner preference, November 8: keep backups manual. No recurring schedule or background tool connection was enabled.

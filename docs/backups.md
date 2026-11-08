# Team backups and offline recovery

## Download

Open Settings → Data & privacy → Prepare backup. This creates a consistent database snapshot and a list of the team's current uploaded files. Download every ZIP part and keep the parts together. Preparing is not the same as downloading; check your device's download status.

The export includes all 19 team/domain tables and the actual image/video bytes, their content types, original filenames, and stored upload metadata. It excludes account ownership grants. Every query and file prefix is scoped to the signed-in owner's team. Another account cannot use a backup ID to retrieve it.

Large libraries are split at file boundaries into parts containing up to 512 MiB of uploaded files, plus the manifest. Files are streamed with backpressure; the Worker does not load the film library into memory. Each part contains the same `chalktalk-backup.json` manifest and its own `media/` files. The streaming ZIP implementation uses [fflate](https://github.com/101arrowz/fflate); object version checks and metadata listing use the [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

Download links expire after 24 hours or when a new backup is prepared. A team has one cached snapshot manifest; preparing another replaces it. If a referenced film is missing, preparation fails. If a file changes or disappears after preparation, the download fails instead of silently creating an incomplete archive. Prepare again after changes finish.

These are manual recovery copies, not scheduled backups or a verified cloud disaster-recovery service. The current pilot limit is 10,000 uploaded files and 16 MiB of structured records per snapshot. A single uploaded file cannot exceed the 512 MiB part size (the current normal upload limit is 250 MiB).

## Offline recovery check

Requires this checkout's dependencies and Node 22.13+. Use an entirely new output path:

```powershell
node scripts/restore-backup.mjs --out outputs/recovery-check --owner-id recovery-check "C:\Downloads\chalktalk-part-1.zip"
```

For multipart backups, supply all part paths in the same command. Their order does not matter. The tool never contacts the hosted pilot, never changes the original prototype, and refuses an existing output directory. It creates:

- `workspace.sqlite`: the complete restored database with original IDs and JSON preserved.
- `media/`: the original uploaded file bytes.
- `recovery.json`: the recovered team's identity and file metadata.

The explicit recovery owner ID binds the restored team in this offline database. It is not a login credential and does not grant hosted access. A future cloud recovery must use the correct authenticated, Site-scoped identity and a separate empty destination. Do not upload the offline database over the live pilot without an explicit, reviewed recovery procedure.

The tool verifies ZIP CRCs, file sizes, available MD5 ETags, complete and matching parts, safe paths, schema/columns, team ownership, and foreign-key relationships. A failed recovery leaves a `RESTORE_INCOMPLETE.txt` marker in its new output directory; do not treat that directory as a complete recovery. Retry into a different new directory. Existing data is never deleted to make a recovery fit.

## Verification

`tests/private-workspace.test.mjs` builds fixtures in every exported table, invokes the actual authenticated backup handlers, downloads the streaming ZIP, and restores it into a separate SQLite database. It compares every restored row and uploaded byte, checks metadata and relationships, tests multipart recovery, and rejects damaged/incomplete/duplicate archives, cross-account access, changed source files, expired/replaced jobs, and overwrite attempts.

The development prototype stores messages in workspace JSON and lacks two unused relational messaging tables. Prototype export preserves that JSON and exports those absent tables as empty. Hosted export requires the complete deployed schema and does not silently substitute missing tables.

An actual local browser export was also downloaded and restored into a new ignored recovery directory. Every row across the 19 exported tables matched, including all three existing plays. The prototype had no uploaded files at that check; uploaded-byte and metadata recovery were verified separately with the isolated fixtures. No prototype records were imported into the hosted pilot.

## Returning to a prepared backup

Settings now reads the team's current prepared snapshot on opening Data & privacy. Its download links survive navigation, refresh, and opening Settings on another device using the same authenticated account. The status response exposes only the current team's summary, never ownership grants or another team's ID. It uses private no-store responses. Missing and expired snapshots are distinct from a failed read; an initial status failure requires Refresh backup status before preparing another copy. Concurrent clicks are locked, reads are cancelled on unmount, and incomplete summaries are rejected before links are rendered.

Settings shows preparation time, record/file counts and the 24-hour expiry. Expired links are hidden, including when expiry occurs while the screen remains open. Refresh backup status picks up replacement snapshots prepared elsewhere. A corrupt or future timestamp cannot bypass server download expiry checks. Preparing another backup still replaces the cached manifest; this change does not add scheduled backups, retained cloud archive history or a hosted restore action.

Verification: authenticated handler tests cover persisted status, replacement, expiry, invalid timestamps and sign-in boundaries; client contract tests cover malformed summaries, failed requests and cancellation. Local browser QA prepared a backup, navigated away and returned to the identical saved download ID and expiry without preparing again. That persisted backup was downloaded through the local API and restored into a separate new offline workspace, with every row across all 19 exported domain tables compared to the manifest. The prototype's domain records and hosted pilot were not modified by this check.

# Playbook library hardening

Creation now returns the exact new record ID for books, plays, formations and duplicates. The browser selects that ID rather than guessing which record appeared in a refreshed library.

New browser requests include a random creation ID, retained in memory for retries with the same details. An owner-scoped fingerprint and resulting ID are stored alongside the insert in one database transaction. Simultaneous identical requests return the winning record; altered details conflict. A failed transaction leaves no claim behind. Retrying after deletion does not recreate a removed record. Duplicate play assignments commit in the same transaction. Existing clients without a creation ID remain compatible, but do not receive this retry guarantee.

The creation ledger uses protected `pb-create-` workspace records; the generic state writer cannot replace them. Full backups include these records. No schema migration or existing-record rewrite is required. Ledger entries are currently retained indefinitely. Request IDs held by the browser do not survive closing or reloading the page; after an uncertain result and reload, inspect the library before creating again.

Library reads and mutation responses are validated before replacing browser data. Failed reads show a retry state instead of an editable empty library. Unconfirmed creation responses preserve the form and request ID. In-flight library mutations are locked synchronously. Dirty forms ask before closing, participate in navigation/unload guards, and retain input when saves fail. Deleting a book from its settings is disabled while that form has unsaved changes. These guards do not provide offline draft recovery.

Validation: actual handler/SQL tests for all four creation types, canonical payload ordering, conflict/deletion replay, copied assignments, and valid real library responses; isolated transaction tests for simultaneous claims, rollback and team isolation; protected generic-key and anonymous-read tests. Local browser QA confirmed closing, keeping and discarding an unsaved new-book form without creating records. Existing prototype records were untouched.

Designer edits and book metadata now also have versioned transaction guards; see `designer-conflict-hardening.md`. Remaining: response validation in the older Learn/Leaderboard flows, and the owner walkthrough of saved plays and files across physical devices. Workspace visibility across the owner's devices has been confirmed by the owner, but does not itself verify individual saved records or files.

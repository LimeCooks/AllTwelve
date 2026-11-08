# Private pilot handoff status — 8 November 2026

The goal remains open. A deployed site, green tests, or a narrow module check does not establish a polished end-to-end coaching product.

| Requirement | Current evidence | What is still needed |
| --- | --- | --- |
| Owner-only hosted access | Current Sites policy: one allowed owner, no external visitors or groups. Trusted identity maps to a team server-side; no browser-selected role grants access. | Keep that audience unchanged. Membership roles must be implemented before inviting staff or players. |
| Truly blank first-time team | Actual packaged production SQL/API rehearsal starts two fresh identities with no football data. The owner reported seeing Create your team after real sign-in. | Do not reset the owner's now-created team or seed it with prototype data. |
| Same personal workspace on multiple devices | Owner confirmed the same team after signing in on another device and confirmed a saved play diagram matches across devices. | Walk the remaining saved modules on the owner's physical devices. |
| Play designer and formations persist coherently | Expanded production-artifact rehearsal creates a defensive team formation with an arbitrary package name, a scout offensive look with opponent verbiage, a defensive play using its team formation, a segmented route, attached coverage ellipse, label, opponent players and assignment. Every saved field and backup geometry matches across candidate, rollback and forward transitions. | Physical touch drawing, interrupted gestures and rotation/orientation changes still need hands-on checks. Geometry persistence does not prove every editing interaction. |
| Film workflow | Owner confirmed seeking now works with the existing desktop recording. Local native controls, saved clip revisions, failed-save retention, explicit reload and draft export have checks. | Confirm playback/seeking on physical iPhone/tablet; large uploads and unsupported formats remain limits. |
| Coaching workflow modules | Packaged rehearsal preserves an athlete correction, draft install linked to the play, corrected practice plan/event, depth assignment, private saved message, sideline note and uploaded bytes across version transitions. Domain tests cover additional conflicts/isolation. | Owner walkthrough of each real workflow; safe roster removal, multi-plan planning, staff/player delivery and actual quiz workflows remain incomplete. |
| Durable storage and development separation | D1 domain records and team-prefixed R2 files; development fallback only in development. Rehearsal uses a new isolated store, never the prototype or hosted owner data. | Continue using disposable local fixtures and explicit cleanup; never use owner data for destructive QA. |
| Backup and recovery | New manual backups stream uploads into independent private recovery objects, preserve a completed manifest, resume interrupted copying and restore offline with row/file comparison. Older pre-copy snapshots are labelled explicitly. | Scheduled backups, pruning/retention limits and an exercised cloud recovery procedure remain unfinished. Current quick links expire or are replaced; completed snapshots remain downloadable from the collapsed history panel. |
| Update safety | Actual packaged candidate → rollback → candidate rehearsal over the same isolated storage; latest report `outputs/release-rehearsal-YpnKlw/report.json`. | Live rollback/disaster recovery and owner device checks remain separate gates. A local rehearsal does not authorize restoring over the live database. |
| Honest learning/communication features | Learn/Leaderboard read saved install acknowledgements. Messages are owner-private saved conversations. Settings does not claim invitations or player-account links exist. | Real quizzes, authenticated athlete membership, scoped communication/delivery and meaningful quiz rankings are not implemented. |

## Next substantial work

1. Exercise the actual designer on physical touch devices with the owner, recording failures rather than treating desktop viewport simulation as equivalent.
2. Design and verify retained, unattended backups and a separate-destination cloud recovery process. The manual prepared snapshot is useful but does not satisfy that requirement.
3. Complete the remaining owner coaching workflows, then implement real staff/player membership before enabling invitations, delivery or player quizzes. Preserve the current owner-private boundary throughout.

The current release changes verification and documentation only. It introduces no hosted fixture records, schema change, audience expansion or product reset.

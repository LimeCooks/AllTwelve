# AllTwelve handoff status — 10 November 2026

The user chose to finish the handoff with local Prod and Non-Prod and revisit independent hosting later. Quizzes stay WIP.

| Local instance | Address | Purpose |
| --- | --- | --- |
| Dashboard | http://127.0.0.1:3100/ | Start from here and choose an account |
| Prod | http://127.0.0.1:3101/ | Stable workspace with its own saved records and files |
| Non-Prod | http://127.0.0.1:3102/ | Current changes and disposable testing |

Both sites now run the verified release `651cb5c71882`, each with its own database and file storage. The owner session on each site offers blank team onboarding. Both addresses work on this PC. Starting, account switching and promotion instructions are in [local-pilot.md](local-pilot.md).

| Requirement | Evidence and remaining boundary |
| --- | --- |
| Blank first-time team and isolation | Fresh, independent disposable Workers start with no team or football records. Onboarding creates separate team identities, rosters and file storage. A foreign team selection is denied. Original prototype and existing user records were not reset or copied. |
| Coaching access and delivery | Owner/staff/player local test identities exercise actual app invitations, role checks, restricted published teaching, player acknowledgements and coach-visible completion. Synthetic local sign-in does not verify real email authentication or physical-device staff access. |
| Saved coaching work | Real local restart checks reopen a named gameplan, generated practice, revised Calendar event, depth assignment, roster, published play and player completion. Earlier production rehearsals and owner checks cover designer touch routes, film seeking, generated practice on a second device, and practice PDF download. Those earlier physical-device checks were on the prior hosted pilot. |
| Published teaching | New installs preserve their issued diagram, assignments and notes. Coach and player views use the same copy. Older publications remain labelled as live-library previews; publish a fresh install for new acknowledgements. See [install-followup.md](install-followup.md). |
| Team communication | Team channels and participant-only direct threads persist across restart. The owner journal stays separate. Refresh checks for new replies; automatic notification delivery is not enabled. See [messages-hardening.md](messages-hardening.md). |
| Calendar concurrency | Stale edits and removals are rejected. A rejected edit retains its draft; download or explicitly replace it with the latest saved event. Stable creation retries neither duplicate nor resurrect removed events. See [calendar-hardening.md](calendar-hardening.md). |
| Manual recovery | The real local Worker creates a ZIP, which restores issued teaching, messages, planning records and media in a separate offline workspace. Prior separate-host recovery opened recovered material in the normal application. Existing access grants are excluded from backup, and full-limit capacity remains unverified. See [backups.md](backups.md) and [cloud-recovery.md](cloud-recovery.md). |

Current evidence: 121 passing tests, type checking, the actual dual-Worker report at outputs/local-pilot-check-Mrrjst/report.json, and two-tab Calendar browser checks. The browser checks include draft export, explicit reload, and a rejected stale removal at 390px. This width check is not a physical-phone test. User-facing Prod and Non-Prod data were not used as fixtures.

The next hosted acceptance gates are a user-owned destination, real email sign-in, and verifying blank onboarding, separate team access and saved work on the user's laptop, iPhone and tablet. The old Sites sign-in requires a ChatGPT account and did not work for the approved staff recipient. There is no authorization to provision new providers or transfer live data yet. See [independent-hosting-readiness.md](independent-hosting-readiness.md) and [access-and-delivery-audit.md](access-and-delivery-audit.md) for the access boundary and historical release evidence.

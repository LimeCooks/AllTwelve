# Staff/player access and delivery

## Scope and current evidence

The owner explicitly deferred only quizzes as WIP. Necessary staff/player access and delivery remain part of a dependable handoff. Staff access is the first real-account check. The test recipient email is not yet supplied; this does not block implementation or isolated testing. No invitation, external visitor grant or public access change is authorized by a test fixture.

Current server access is owner-only. `db/client.ts:getDatabase` resolves `workspace_owners` for the trusted Sites identity. `/api/session` likewise joins only owner grants to teams. `/api/onboarding` atomically creates an empty team and owner grant. In production, `lib/request-identity.ts` requires trusted ingress identity; the prototype identity fallback is development-only. `middleware.ts` rejects anonymous API access and cross-origin browser writes.

The hosted profile menu does not offer the prototype's role switch. The prototype switch changes a preview, not a server permission. Learn and Leaderboard read existing install material/acknowledgements; they are not quiz implementations. Current player workspace copy explicitly says an account is not connected. Existing owner-private messages and settings must not become readable to every staff member merely by broadening the database resolver.

The private Site's hosting allowlist is a separate access boundary. Adding an application membership alone does not let that person reach this owner-only Site. Staff sign-in must be verified through both boundaries. Preserve the private audience and use a specific reviewed test recipient; do not make the Site public to bypass this requirement. Keep hosting credentials out of application code.

## Implementation acceptance requirements

1. Trusted authenticated identity, not a browser role or team ID, determines every request's memberships and capabilities. Owners retain their existing team and data without re-onboarding or an automatic data rewrite.
2. Owners control staff/player membership. Invitations are explicitly scoped to a team, role and recipient, expire, can be revoked and cannot be replayed or accepted by a different account. A recipient's stable identity is bound only after a verified acceptance. Creating an invite is not proof of delivery or hosting access.
3. Staff can use approved coaching workflows. Access management and full backup/recovery controls stay owner-only unless explicitly granted otherwise. Existing owner-private conversations and account media require deliberate isolation rather than accidental sharing.
4. A real staff session opens the intended existing team, shows its genuine account identity, and does not show first-team creation or a pretend role selector. Server requests outside the staff role fail even if a hidden control is invoked directly. Team switching, if supported, chooses only memberships that the server has validated.
5. Players receive a server-bound athlete identity and only their assigned, published learning material and permitted communication. They cannot read the full roster, other players' contact/staff notes, draft plays, unassigned film, private settings or backups. Their review acknowledgement records their own identity; the browser cannot select another athlete.
6. Install assignment/publication and player delivery agree end to end. Due dates remain optional and independent of weekly/daily/monthly cadence. Revoked access takes effect on subsequent requests, not only after a visual role switch.
7. Tests cover anonymous/foreign-team requests, forged roles/athlete IDs, invitation expiry/replay/revocation, revoked memberships, owner preservation, staff boundaries and restricted player material. Real sign-in checks follow isolated tests, before claiming delivery works.
8. Identity/access grants must be reviewed separately from portable domain backups. Restoring football records must not silently recreate grants to old accounts or allow a restored database to bypass current hosting policy.

## Initial permission boundary

| Area | Owner | Staff | Player |
| --- | --- | --- | --- |
| Team coaching records and draft tools | Full | Explicit coaching capabilities | Denied |
| Access management and full team backups | Full | Denied by default | Denied |
| Owner-private saved conversations/account media | Full | No automatic access | Denied |
| Assigned published material | Full | Team coaching view | Own assigned material only |
| Player acknowledgement | Inspect/manage assignments | Inspect assigned reviews | Own bound athlete only |
| Quizzes | WIP, deferred | WIP, deferred | WIP, deferred |

This file records requirements and verified gaps; it does not claim that memberships, invitations or delivery have been implemented.

## Local implementation progress

The unpublished access foundation now has an additive, empty identity-table migration; explicit owner/staff/player capability sets; and server-side membership selection that checks real grants, rejects foreign team hints, rejects revoked members, preserves existing owner authority, and verifies a player's athlete belongs to the same team. Owner identity remains separate from membership roles.

Invitation services use the authenticated recipient's email only for the initial acceptance, then bind the stable Site user ID. No bearer link or separate password is introduced. The owner controls role/profile/expiry and explicit revocation. Creation retries use stable IDs. Pending invitations are visible only to the bound recipient; acceptance pins the reviewed revision, checks eligibility again inside an atomic transaction, and cannot replay a used invitation to reactivate revoked membership. A new owner-issued invitation is required for rejoining. Copies of the ordinary private Site URL do not grant hosting or application access and do not send email.

Backup recovery was updated to keep the two new grant tables outside the 19 portable football/domain tables. Tests include actual nonempty access fixtures excluded from export, with zero invitations/memberships after restore. Recovery preparation rejects a recovered database carrying existing membership/invitation grants rather than republishing those grants to a new destination.

All 108 local tests and type checking pass at this stage, including recipient mismatch, retry preservation, expired/revoked and late-revoked acceptance, stale revocation, rejoining with a new invitation, foreign team selection and athlete binding. These services are not yet connected to hosted routes or UI and the new migration is not deployed. The live pilot still runs the verified practice-printout release and remains owner-only.

Remaining integration must bind every open browser tab's selected team to its API requests; a shared server preference or cookie alone could send an older tab's writes to a different team after another tab switches. Generic owner-private state, private messages/account media, backup controls and settings need explicit permission handling before staff access is enabled. Athlete removal must also account for membership/invitation dependencies. Complete actual staff sign-in/permission checks before player delivery, and keep quizzes WIP as requested.

## Staff integration verification (2026-11-08)

The unpublished candidate now connects the services to `/api/team-access`, `/api/team-invitations`, session discovery and recipient review/join screens. Settings → Staff & permissions allows the owner to create an email-bound staff invitation and review/revoke active access. It does not send email or alter Sites hosting access. The selected real test recipient is liam@thecooksns.com; supplying that address did not authorize sending mail or granting hosted access.

Coaching APIs resolve owner/staff capabilities on every request. Settings writes, backups, owner-private messages and sideline records remain owner-only. Owner account images are also denied to staff; shared team crests remain readable. Each browser document binds its team to API requests and native media URLs; a foreign hint is rejected, and switching workspaces requires a full navigation. Athlete removal checks membership/invitation history and portable backups exclude both grant tables.

All 112 tests pass, including actual route handlers for invitation create/retry/accept, wrong-recipient rejection, staff roster writes visible to the owner, owner-only denials, forged-team rejection and immediate revocation. Type checking and the production build pass. An isolated real Worker/browser test created an invitation through the owner UI, reviewed/joined through a different synthetic staff identity, opened the existing team, verified the reduced staff navigation at desktop and phone width, revoked through the owner UI, and confirmed that the staff page could no longer reopen the team. Browser testing caught and fixed the join flow blocking its own navigation with the in-flight unload guard.

The new migration was applied only to disposable local storage. No real staff invitation or hosting grant has been created yet. Before release, run the complete packaged candidate/rollback/forward rehearsal with the new staff checks. Real staff sign-in and player delivery remain open handoff gates. Player invitations are not exposed in the owner UI; player-specific published-material and acknowledgement workflows still need implementation before they can be claimed usable. Quizzes remain WIP.

## Published staff release

Staff access candidate commit `3cd7dbb281cdb7b82145ae95ad56bba3ee1ffe9d` was published successfully as deployment `appgdep_6af144dc96c081918f4449952469c84d`, saved version `appgprj_6aee2b7e04ac81919078454cbaae1b12~appgver_afb3f94e8ae48191bb92fa2608b4b8fb`. Archive: `outputs/private-pilot-staff-access.tar.gz`. Full candidate → previous practice-printout release → forward rehearsal passed in `outputs/release-rehearsal-p9SiCL/report.json`, including staff checks before rollback and after forward, portable backup exclusion and final revocation.

The hosted owner session still opens 2026 Test Team with its saved play and uploaded film. Settings → Staff & permissions loads successfully with no additional members and zero invitations. The audience remains custom owner-only (revision 1, no external visitors). No invitation or audience change has been made. The only rejected publication attempt used a mistyped copied commit SHA; the exact verified HEAD was then supplied and deployment succeeded. No failed deployment or duplicate saved version resulted.

Next real-account action requires a separate explicit approval: allow liam@thecooksns.com to visit the private pilot as a Site viewer and create an application staff invitation for 2026 Test Team. Adding the external visitor may send a hosting invitation email. This is visitor access, not Site editor/source access; application staff permissions permit shared coaching edits while denying owner controls. After approval, verify recipient sign-in, existing-team join and genuine saved material on a second account. Do not claim physical-account verification from the local synthetic identity tests.

## Player learning integration candidate

A linked hosted player account now has a separate focused workspace rather than the coaching shell or a role preview. `/api/player-learning` returns the server-bound athlete's published install reviews and their locked play diagrams, teaching assignments and coaching notes. The payload deliberately excludes roster contacts, staff notes, other athletes/reviews, draft/unassigned plays, private messages and film-library access. Install cadence remains arbitrary and due dates optional. Existing published-install/play locks provide the stable teaching revision; no new snapshot migration is needed.

Acknowledgements use the trusted membership's athlete, never a caller-selected athlete. Each change checks the reviewed revision, is retry-safe without changing an existing timestamp, and rechecks active membership plus published ownership inside the write. A revoked-during-save test confirms that the mutation fails without recording an acknowledgement. Owner/staff previews cannot impersonate the player endpoint. Reading assignment details uses a bounded number of database queries rather than a query per play.

Settings access controls now offer Staff or Player, with Player requiring an explicit saved roster profile. No real player invitation has been created. All 113 tests and type checking pass. In the separate local Worker/browser, the owner created a roster-bound player invitation; the synthetic recipient reviewed and accepted it; the dedicated player screen displayed only its published material; all three acknowledgements saved; and the coach Install screen showed 1/1 complete. The 390px mobile view had no horizontal overflow. Completion labels were changed to readable status text instead of low-contrast disabled buttons. Final packaged release/rollback and published verification remain to run. Physical second-account staff/player checks remain open; the pending real staff approval is unchanged. Quizzes remain WIP.

## Published player learning release — 9 November

App/source commit `ee58875508a25b99fb0f734d2036c128cb3d3097` is live as deployment `appgdep_6af148a870f881919dbeb8fbc210903e`, saved version `appgprj_6aee2b7e04ac81919078454cbaae1b12~appgver_5a8e616eade08191a6ef4692f6ae34db`. Artifact: `outputs/private-pilot-player-learning.tar.gz`. Candidate → staff-access rollback → forward passed in `outputs/release-rehearsal-NiZPdI/report.json`, including persistent player review acknowledgements visible to the coach and private endpoint denials. The initial rehearsal correctly rejected a draft package; its fixture was corrected to publish explicitly before testing delivery. No application bypass was added.

Read-only live browser verification opened the original owner team and Settings → Staff & permissions with the new role selector. There are still zero invitations and no additional members. The Site audience was re-read before publishing: custom, owner only, zero external visitors. Screenshot: `outputs/player-access-release.jpg`. No real player or staff grant was created. The staff approval question for liam@thecooksns.com remains pending; supplying the email was not approval to send a hosting invitation or grant access.

## Published media integrity and approved staff test — 9 November

The final media-guard build is published: app commit b5d825250d9e531eaa50039d7e479c08f24a9f38, deployment appgdep_6af2509ea5a481919c73ead1988f7b65, saved version appgprj_6aee2b7e04ac81919078454cbaae1b12~appgver_ac7d8f56c06c8191a24fe0607335ba41 (version 42), archive outputs/private-pilot-film-file-integrity-final.tar.gz. All 114 tests and type checking pass. Final actual-worker restart report outputs/release-rehearsal-FlohiI/report.json passes original-byte preservation, simultaneous upload winner, bounded range reads and versioned deletion, plus saved coaching records and staff/player review checks. Older unguarded archives are not approved rollback baselines for this integrity invariant.

The production-artifact checks uncovered a real connection issue after early upload rejection. The final handler drains rejected incoming bytes as a bounded stream without retaining them in memory, and prevents the forwarding pipe from cancelling the input on a competing conditional write. Unit tests verify the incoming stream is drained rather than cancelled. The focused local Worker probe showed upload/register, rejected overwrite, rejected raw delete, byte-range read and permitted Film Room deletion all completing promptly. Earlier candidate/v2 artifacts and failed diagnostic rehearsals were not published. No existing hosted recording was changed or deleted.

The user explicitly approved the staff access question. Sites policy revision 2 now includes the original owner and liam@thecooksns.com as an external viewer, with no source editors or groups. A real application staff invitation to 2026 Test Team was created through the owner UI and verified pending, expiring 16 November. No application staff member has accepted. Screenshot: outputs/staff-invitation-created.jpg. Future deployments must use shared-site save/deploy operations; the site is private but no longer owner-only.

The real test uncovered a hosting requirement: the recipient has no ChatGPT account at that email and therefore cannot complete Sites sign-in. The invitation cannot create or bypass that account. The user asked where standard email sign-in would move. Cloudflare hosting under the user's own account with managed email authentication is under discussion; no migration/provider choice or new paid account is authorized yet. Do not make the current Site public, replace its authentication, transfer ownership, or revoke the approved visitor merely because of this discussion. Keep the existing team and data intact.

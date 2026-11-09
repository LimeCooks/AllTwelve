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

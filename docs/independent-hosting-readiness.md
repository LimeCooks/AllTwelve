# Independent hosting readiness — 9 November 2026

Status: recommendation only. The user asked where normal email sign-in would move; no provider migration, new paid plan, domain change, public audience or replacement authentication has been authorized. The current private pilot remains live and its approved visitor/staff invitation remain unchanged.

## Verified starting point

- Current application build is a Cloudflare Worker using D1 (`DB`) and R2 (`MEDIA`). Existing production packages and isolated recovery/restart checks establish portability of the football/domain records and media bytes.
- `wrangler whoami` reports no authenticated Cloudflare account in this workspace. This does not prove the user has no account; it means deployment access is not configured here.
- Sites owns current hosted sign-in. `lib/request-identity.ts` and `middleware.ts` trust authenticated ingress headers. Those headers must not be trusted on an independently exposed Worker. The Sites identity integration must stay intact in the existing pilot.
- The real staff recipient liam@thecooksns.com cannot accept the invitation because they have no ChatGPT account. An application invitation cannot bypass Sites sign-in. No staff member has joined.
- The user is considering Cloudflare hosting plus managed email authentication (Clerk was recommended), with accounts owned by the user. Existing accounts and a controlled domain are not yet confirmed. Credentials should not be pasted into chat.

## Work required if the user chooses that destination

1. Create a separate staging destination/configuration under the user's Cloudflare account. Preserve `.openai/hosting.json`, the current Site and the local prototype. Start with an empty staging database and file bucket.
2. Configure the chosen managed authentication provider and domain. Replace ingress-header trust only in the independent hosting target with verified provider sessions, including issuer, audience/origin and expiry checks. Keep server-side team roles and assignment restrictions.
3. Replace Sites-specific sign-in/sign-out entry points in the independent target. Test email sign-in, account recovery, invite acceptance and logout on laptop, iPhone and tablet.
4. Test genuinely blank first-team onboarding and two unrelated authenticated accounts against fresh staging storage. Reject forged headers, foreign teams, revoked access and unassigned player material before transferring real records.
5. Use a new manual backup to transfer the existing team after explicit owner verification. Preserve domain IDs and file checksums. Portable backups intentionally exclude old owner/member/invitation grants: bind the verified new owner deliberately and reissue selected staff/player invitations. Never automatically grant ownership based only on a matching email or reuse a Site-scoped identity ID as an independent-provider ID.
6. Compare every domain table and uploaded file and verify actual owner/staff workflows before switching the working URL. Keep the current pilot available until the new destination is proven. Quizzes remain WIP; manual backups remain the user's preference.

No implementation of an independent authentication stack has been started. Confirm provider choice, user-owned accounts, domain and any paid-plan budget before provisioning external resources or beginning a provider-specific migration.

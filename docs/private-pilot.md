# Private pilot handoff

## Objective

A private, authenticated ChalkTalk workspace usable on laptop, iPhone and tablet. The owner starts with no roster, plays, formations, opponents, installs, film or schedule. Development and temporary test records must stay separate from the hosted workspace.

## Architecture

- Sites supplies top-level sign-in and the owner-private access policy. Only its authenticated ingress may reach the Worker; do not expose a second public Worker origin that trusts visitor-supplied identity headers.
- D1 stores product records. `workspace_owners` maps the stable authenticated user ID to one team. Request-local database wrappers supply the team ID to every existing domain API. No browser-selected team ID or role grants server access.
- R2 stores uploaded files under a team prefix. The same logical media key in another team must resolve to a different object.
- `/api/session` distinguishes signed-out, first-time and returning owners. `/api/onboarding` creates the team, owner mapping and team settings atomically. It does not insert any football records.
- Production requires authenticated identity. Only the development server can use the existing local prototype. `CHALKTALK_MODE=pilot` also disables prototype fallback in development.
- Hosted startup does not run the legacy bootstrap or cleanup code. The schema-only `drizzle/` chain is packaged by Sites. `db/migrations/` is retained as prototype history; it is not the hosted chain.
- Git contains source only. `.wrangler/`, uploaded data, secrets and build output must never be included in the deployment source/archive.

## Evidence collected

The isolated tests apply the actual hosted SQL to a fresh database, verify that domain tables are empty, exercise unauthenticated rejection and first-time onboarding, create two owners, prove team-specific Playbook reads and attempted cross-team modification rejection, and prove team-prefixed media read/write/delete isolation. The earlier Playbook/Install tests continue exercising the actual handlers against the prototype fixture.

The first private deployment succeeded. The hosting policy was checked: owner only, no other visitors. Initially the deployed database's 20 expected tables were read back as empty. Browser verification reached the real ChatGPT sign-in gate. On November 7 the owner reported seeing “Create your team” after signing in, confirming the intended first-team screen. Actual team creation and cross-device persistence remain to be verified; the initial empty-table observation is not a statement about today's hosted records.

Follow-up work removed simulated invitations, disconnected notification/schedule controls, and hard-coded account identity from Settings. Phone (390 × 844) and tablet (820 × 1180) browser checks verified the full section menu, Settings and Playbook library. A tablet-only empty sidebar gap was corrected. Profile saves update both workspace settings and team/session identity atomically, with an isolation test.

The first-time film workflow was hardened after real browser checks exposed a missing sample-game dependency, fixed-key overwrites, an inert library selector, an unsafe New clip fallback, and a framework upload-size interception. The fixes and remaining verification limits are documented in [film-hardening.md](film-hardening.md).

Viewport checks do not prove physical iPhone/iPad touch behaviour. Sign-in, backup recovery, cross-device persistence and real coaching workflows still require verification before handoff.

## Remaining handoff gates

Home now checks successful, complete calendar/install responses before showing counts. Failed reads show a retry state instead of an apparently empty team; returning Home reloads the overview. Team settings must load before the workspace opens, so a failed settings read cannot expose editable default values. Automated checks cover empty, populated, failed, malformed and retry responses; local browser checks confirmed the original profile and saved play remain visible. Browser fault injection and physical-device checks remain outstanding.

1. Confirm authenticated first-time onboarding on the hosted URL after the owner signs in. Do not create a team using an agent/service identity; the owner should see the actual first-time screen.
2. Continue auditing remaining module-specific prototype copy and incomplete controls. Staff/player invitations and account-to-athlete linking require real membership roles before external users can join.
3. Verify every persisted module and uploaded file across two browser sessions/devices. Handle failed requests honestly; do not replace failures with apparent empty success.
4. Verify responsive layouts and touch drawing on phone/tablet. Desktop tests are insufficient for this gate.
5. Manual full export and offline recovery are implemented and tested separately; see [backups.md](backups.md). Still verify cloud disaster recovery, retention/restore procedures, and an owner-accessible recovery handoff. Retain the local prototype unchanged; do not migrate its records into the clean pilot.
6. A repeatable local production-build update/rollback rehearsal now passes with isolated storage, saved domain records, uploaded bytes, backup ZIPs and owner isolation; see [releases.md](releases.md). Live hosted rollback and disaster recovery remain unverified. Development experiments must never share pilot data or publish automatically.
7. Walk the real coaching workflows with the owner, recording and fixing defects. The first working deployment is a pilot milestone, not proof that the complete product is polished.

## Hosting identity

The private pilot registration is recorded in `.openai/hosting.json`. An expected URL from registration is not evidence of deployment. Reuse that project ID; never register another Site merely because deployment or source synchronization fails.

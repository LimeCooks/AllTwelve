# AllTwelve

Football coaching workspace for film review, playbooks, depth charts, athletes, gameplanning, practice plans, and installs.

## Local setup

Requires Node.js 22.13 or newer and pnpm.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by the development server.

The app uses React and Vinext with Cloudflare D1 and R2 bindings. Local database and uploaded media state lives in `.wrangler/` and is excluded from Git. The development database initializes on first API access. Hosted environments use the schema-only `drizzle/` migrations and authenticated team ownership; they never run the prototype bootstrap. A fresh clone does not contain existing local roster records, settings, or uploaded film.

The private pilot architecture, verified milestones, and remaining handoff gates are tracked in [docs/private-pilot.md](docs/private-pilot.md).
Manual team backup downloads and the offline recovery procedure are documented in [docs/backups.md](docs/backups.md).

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
node scripts/check-local-pilot.mjs
```

GitHub Actions runs these checks on pull requests and pushes to main. The integration rehearsal uses two disposable local instances from the same build. Its report records the commit and release ID. GitHub retains the report and worker logs for 14 days.

`pnpm lint` runs the project-wide linter. Some existing shared UI components have outstanding lint findings.

The Playbook/Install audit, fixes, validation coverage, and remaining boundaries are documented in [docs/playbook-install-audit.md](docs/playbook-install-audit.md).
The drawing workflow, field measurements, formation packages, opponent looks, and shortcuts are documented in [docs/play-designer.md](docs/play-designer.md).

## Repository

The existing Git origin remains the canonical repository; use `git remote -v`
for its current address. Renaming the product does not change the remote or
its branch protection rules.

Source and dependency versions are tracked in Git. Dependencies, generated builds, local caches, environment files, database state, and uploaded media are ignored. Keep credentials in local environment files; do not commit them.

# ChalkTalk

Football coaching workspace for film review, playbooks, depth charts, athletes, gameplanning, practice plans, and installs.

## Local setup

Requires Node.js 22.13 or newer and pnpm.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by the development server.

The app uses React and Vinext with Cloudflare D1 and R2 bindings. Local database and uploaded media state lives in `.wrangler/` and is excluded from Git. The database initializes on first API access. A fresh clone does not contain existing local roster records, settings, or uploaded film.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

`pnpm lint` runs the project-wide linter. Some existing shared UI components have outstanding lint findings.

The Playbook/Install audit, fixes, validation coverage, and remaining boundaries are documented in [docs/playbook-install-audit.md](docs/playbook-install-audit.md).
The drawing workflow, field measurements, formation packages, opponent looks, and shortcuts are documented in [docs/play-designer.md](docs/play-designer.md).

## Repository

https://github.com/LimeCooks/ChalkTalk

Source and dependency versions are tracked in Git. Dependencies, generated builds, local caches, environment files, database state, and uploaded media are ignored. Keep credentials in local environment files; do not commit them.

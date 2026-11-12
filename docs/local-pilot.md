# Local Prod and Non-Prod

Use these two local instances while Cloudflare, a domain and normal email sign-in are arranged. The old hosted pilot is no longer the working environment. It has not been deleted or reset.

| Site | Address | Purpose |
| --- | --- | --- |
| Dashboard | http://127.0.0.1:3100/ | Open either site or switch its local test account |
| Local Prod | http://127.0.0.1:3101/ | Stable build for the owner's testing |
| Local Non-Prod | http://127.0.0.1:3102/ | Test changes before deliberate promotion |

Both start on **Create your team**, with no football records copied from the prototype or hosted pilot. Choose **Use Owner** on the account screen, then create the team you want in each instance. Data entered in one will not appear in the other.

On a fresh checkout with dependencies installed, prepare the initial build once with `npm run build`, then `npm run local:setup`. Setup preserves any already-prepared environment rather than replacing its data or build.

## Starting and stopping

Double-click **Start Local AllTwelve.cmd** in the project folder. It starts the two background services and opens the dashboard. **Stop Local AllTwelve.cmd** stops them without removing saved records or files. Restarting the computer stops the services; use Start again afterward. Keep this project folder and `.local-pilot` together.

Equivalent commands:

```text
npm run local:start
npm run local:stop
npm run local:status
```

They are intentionally accessible only on this computer. A phone, tablet or office laptop cannot reach `127.0.0.1` on this machine. Local-network or later Cloudflare access needs separate setup; these services are not exposed to the internet.

## Local account testing

The account chooser at `/__local` simulates authenticated identities for local testing. It does not create internet accounts, send email or require ChatGPT.

- Owner: `owner@alltwelve.local`
- Staff coach: `staff@alltwelve.local`
- Player: `player@alltwelve.local`

Each environment has separate identities and signed browser cookies. Choosing an account does not grant it a team role. Create the team as Owner first. In Settings → Staff & permissions, invite the staff email, or invite the player email with an explicit roster profile. Switch to that local account, review the invitation and join. Player learning appears after the owner publishes an install assigned to that roster profile. Sign out or use the dashboard's Switch test account link to return to Owner.

These selectors are local test tooling only; they are not a replacement for managed authentication on an internet-facing deployment.

## Team conversations (Non-Prod)

Messages now supports team channels and direct conversations between connected accounts. Coaches create channels; active coaches and linked players can read and reply. Players open Messages from Your installs. Choose Refresh messages to check for new replies; email, push notifications and automatic live updates are not enabled.

Direct conversations appear only for their two participants in Messages. Team owners retain full team backup access, including conversation records; this is not end-to-end encrypted messaging. Revoking access prevents further use, and a remaining participant can still read the prior conversation. Messages and files persist in each environment's separate local storage.

The owner's earlier private journal stays under Personal saved notes and is not shared with staff or players. Unsent message drafts stay while changing conversations in the same page; leaving the page warns before losing them. They are not permanent saved drafts.

## Changes and promotion

Non-Prod also preserves teaching material when publishing new installs. Coach and player previews use the issued copy; later source changes do not change that copy. Older installs without a preserved copy are labelled separately and require a new publication for further player acknowledgements.

```text
npm run local:update
```

This type-checks and builds current source, captures a new fixed release snapshot, then restarts **Non-Prod only**. Prod keeps its existing build and storage while changes are tested. A failed Non-Prod restart attempts to restore its previous build.

To restart just one existing build without updating it, use `npm run local:restart -- nonprod` (or `prod`). Status checks verify that the application worker answers, rather than relying only on the dashboard process. Promotion refuses a candidate that is unavailable or has not finished starting; start both sites and review Non-Prod first.

After reviewing the actual Non-Prod build, deliberately promote it:

```text
npm run local:promote
```

Promotion changes Prod's application build, **not its team records or uploaded files**. It applies that release's local schema migrations. Use the in-app manual backup before significant updates. It never clones Non-Prod's database into Prod.

## Data separation

Local configuration, snapshots, cookies, logs and persistence live under ignored `.local-pilot/`:

- `prod/storage/`: Prod's D1 database and R2 uploads.
- `nonprod/storage/`: Non-Prod's independent D1 database and R2 uploads.
- `releases/<content hash>/`: captured application and schema snapshots. Normal source rebuilds cannot change the build a running instance uses.
- `local-control.key`: local account/control signing material; do not publish this directory.

The default prototype `.wrangler` directory, hosted bindings and recovery lab are not used. Local commands always pass `--local` and explicit persistence paths. `.local-pilot` is excluded from Git. Do not remove it to update the app; that would remove local data.

## Verification

The dual-instance integration checker uses fresh disposable directories under `outputs/local-pilot-check-*`, never either user-facing store:

```text
node scripts/check-local-pilot.mjs
```

It verifies independent blank onboarding, roster and file isolation, local staff access, bound-player preserved teaching and acknowledgements, scoped messages, versioned Calendar changes, depth assignments, and a saved gameplan feeding a generated practice. It downloads a manual backup and restores the records into a separate offline database, then restarts both disposable instances to check persistence. The Windows host may require loopback permission for these tests. Current evidence: `outputs/local-pilot-check-Mrrjst/report.json` and 121 passing tests.

# AllTwelve releases

Open short-lived branch pull requests against `main`. Squash-merge after **Build and verify AllTwelve** passes and review the browser Preview for user-facing changes. Once hosting is connected, each merge updates a persistent staging Worker. Publish a stable GitHub release tagged `vMAJOR.MINOR.PATCH` from the tested commit on `main` when it is time to ship.

The verification workflow runs for pull requests, pushes to `main`, and published stable releases. A release must point to a commit in the history of `main`. GitHub verifies the tagged checkout with the same build and isolated integration checks used for pull requests.

## Cloudflare account preparation

1. In **Workers & Pages → D1**, create `alltwelve-staging` and `alltwelve-production`. In **R2**, create separate staging and production media buckets. If you enable PR Previews, provision preview-only storage as well.
2. Keep the database IDs and bucket names handy. The deployment configuration will bind each database as `DB` and its media bucket as `MEDIA`.
3. Connect Git to the staging Worker once hosted authentication has passed verification. Use `main` as that Worker's deployment branch and enable Worker Previews for non-production branches. Keep Preview access restricted to authorized reviewers.
4. Keep the Production Worker disconnected from branch deployments. The future GitHub release deploy job will use a dedicated Production environment and a scoped Cloudflare token stored in GitHub Secrets. Attach the official domain to the Production Worker when it is available.

## Before enabling deployment

AllTwelve currently trusts identity headers supplied by its previous hosted ingress. Implement and verify hosted authentication before exposing a Worker. Check that unauthenticated requests and caller-supplied identity headers cannot access team data. Apply the existing schema migrations to the corresponding D1 database, then verify onboarding, sign-in, and film upload and seeking on staging. The current verification workflow does not deploy or apply migrations.

Worker Previews also require a Wrangler upgrade from the version currently pinned in this repository. See the [Cloudflare Worker Previews setup](https://developers.cloudflare.com/workers/previews/get-started/) and [Workers Builds branch controls](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/).

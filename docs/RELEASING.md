# Publish to npm

Package: `@carbon-ni/pi-schedule`.
Repository: `carbon-ni/pi-schedule`.

Pushing a stable `v<version>` tag starts `.github/workflows/release.yml`.
The workflow requires the tagged commit to be in `main` history and the tag to
match `package.json`. It runs the release gate before publishing with npm trusted
publishing (OIDC). No npm write token is stored in GitHub.

Only stable releases are supported. Prerelease tags are rejected rather than
published as `latest`.

## One-time setup

You need publish access to the `@carbon-ni` npm scope and admin access to the
GitHub repository. The npm scope and GitHub owner do not need to have the same name.

1. In GitHub, create an environment named `npm`. Add required reviewers if your
   plan supports them, and restrict deployment tags to `v*`. Protect release tags
   with a repository ruleset so only release maintainers can create them.
2. If the npm package does not exist yet, perform the first publish locally as
   shown below. Trusted publishing is configured in an existing package's settings.
3. In the npm package settings, add a GitHub Actions trusted publisher:

   | Field                | Value                      |
   | -------------------- | -------------------------- |
   | Organization or user | `carbon-ni`                |
   | Repository           | `pi-schedule`              |
   | Workflow filename    | `release.yml`              |
   | Environment name     | `npm`                      |
   | Allowed actions      | Allow direct `npm publish` |

4. Complete an automated release within two days of creating the trusted
   publisher. An unused configuration expires; delete and recreate it if needed.
5. After the first automated publish succeeds, select npm publishing access
   **Require two-factor authentication and disallow tokens**. No `NPM_TOKEN`
   secret is needed.

### First publish only

Run from a clean, reviewed checkout of `main`, after the release-process changes
have been pushed. Check scope access with your npm account; a registry 404 does
not prove you have permission to publish.

```sh
npm ci
make release-check
node scripts/release.mjs "v$(node -p "require('./package.json').version")"
npm login --registry=https://registry.npmjs.org/
npm publish --ignore-scripts
```

The first publish uses interactive npm authentication and any required 2FA.
It does not get GitHub Actions provenance. Later CI releases do.
Do not push a tag for this already-published version: the workflow would attempt
to publish it again. Configure the trusted publisher, then use the next patch
version for the first automated release.

## Release a new version

Start with a clean `main` checkout. Keep npm 10.9.9 for local development.
`npm version` changes both manifests and creates a new commit and tag; it does
not publish. Replace `patch` with `minor` or `major` when appropriate.

```sh
git switch main
git pull --ff-only
npm ci
make release-check
npm version patch -m "chore(release): %s"
node scripts/release.mjs "v$(node -p "require('./package.json').version")"
git push origin main
git push origin "v$(node -p "require('./package.json').version")"
```

Approve the `npm` environment deployment if review is enabled. The workflow uses
npm 10.9.9 for verification and pinned npm 11.6.2 for OIDC publishing only.
It publishes public TypeScript sources and docs, without tests or development
tooling. There is no build step; Pi loads the TypeScript extension directly.

Check the workflow and registry after publication:

```sh
gh run list --workflow release.yml --limit 5
npm view @carbon-ni/pi-schedule version dist-tags --json
pi install npm:@carbon-ni/pi-schedule
```

## Recover a failed release

- **Verification failed:** fix the cause on `main` and create a new version.
  Do not move or replace a published release tag.
- **Authentication failed:** compare every trusted-publisher field above,
  including the environment name and permission for direct publishing. Recreate
  expired publisher configurations, then rerun the failed publish job with
  `gh run rerun <run-id> --failed`.
- **Publish result uncertain:** inspect the workflow and run
  `npm view @carbon-ni/pi-schedule@<version> version`. If it exists, do not retry
  publishing it. If it is absent and the cause is resolved, rerun the failed job.
- **Version already exists:** npm versions are immutable. Use `npm version patch`
  and follow the release steps again; never unpublish to make a retry succeed.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for
provider requirements and troubleshooting.

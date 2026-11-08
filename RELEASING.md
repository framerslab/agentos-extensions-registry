# Releasing @framers/agentos-extensions-registry

Releases are automated. A release runs once a day, at 10:17 UTC, when `master` holds a change to release since the last version tag; nobody publishes by hand. A push to `master` runs CI's quick checks and publishes nothing.

## What happens each day

1. The release workflow ([`release.yml`](https://github.com/framerslab/agentos-extensions-registry/blob/master/.github/workflows/release.yml)) starts on its schedule, `17 10 * * *`. GitHub may start a scheduled run late, or drop it, when Actions is busy ([GitHub's note](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)); the next day's run then releases what the dropped one would have.
2. Its first job, "Releasable changes", runs [`.github/scripts/release-gate.mjs`](https://github.com/framerslab/agentos-extensions-registry/blob/master/.github/scripts/release-gate.mjs) with git and Node alone, nothing installed. It finds the highest `v<version>` tag reachable from `master` and counts each commit after it that both releases under the version rules below and changes what the package ships: a file under `src/` (from which `dist` is built), `tsconfig.json`, [`scripts/generate-capability-catalog.mjs`](https://github.com/framerslab/agentos-extensions-registry/blob/master/scripts/generate-capability-catalog.mjs) (the build runs it first), `package.json`, `README.md` or `LICENSE`. A merge commit counts through the commits it brings in. The job prints its decision and the commits behind it to the log and the run summary. With none, the run ends there, green.
3. With a change to release, the "Suite" job runs CI's whole suite ([`ci.yml`](https://github.com/framerslab/agentos-extensions-registry/blob/master/.github/workflows/ci.yml), called with `release: true`) on that commit: `pnpm install --no-frozen-lockfile`, `pnpm build`, `pnpm test`, then four checks: `pnpm run check:availability`, `pnpm run check:pack`, `pnpm run check:ranges` and `pnpm run check:install`. A failing step stops the run before anything is released.
4. The "Release" job installs and builds again, then `pnpm exec semantic-release` reads every commit since the last version tag and decides the version with the rules below. With no releasing commit, nothing publishes.
5. On a release, [semantic-release](https://semantic-release.gitbook.io/) pushes the tag `v<version>`, then publishes the package to npm and creates a GitHub release with the generated notes.

The release commits nothing to the repository. The `version` field in `package.json` on `master` is not the published version; the newest `v` tag is. `CHANGELOG.md` is not written by the release; the notes are on the [releases page](https://github.com/framerslab/agentos-extensions-registry/releases).

Only one release run goes at a time, and a release run is never cancelled.

## Release now

To release without waiting for 10:17 UTC, dispatch the workflow on `master`, from the Actions tab or with the GitHub CLI:

```bash
gh workflow run release.yml --ref master
```

Two inputs, both off by default:

- `force`: skip the "Releasable changes" check. semantic-release still decides the version, and publishes nothing when no commit since the last tag releases.
- `dry_run`: run the check, the suite and the release job up to the publish, and stop before semantic-release, so nothing is tagged, published or released.

```bash
gh workflow run release.yml --ref master -f dry_run=true
```

A dispatch on any branch other than `master` fails at its first step.

## The four checks

| Command | What it checks |
|---|---|
| `pnpm run check:availability` | Under plain Node, a catalog entry is reported as available exactly when its package can load. |
| `pnpm run check:pack` | The tarball, packed as the release packs it, contains a populated capability catalog. |
| `pnpm run check:ranges` | Every optional dependency range resolves to a version on npm whose tarball contains the package's entry point. Packs listed in [`scripts/known-empty-packs.json`](https://github.com/framerslab/agentos-extensions-registry/blob/master/scripts/known-empty-packs.json) are already published without code and are exempt; a pack that is not on the list and ships no code fails the check. |
| `pnpm run check:install` | The package installs next to the latest `@framers/agentos`, and npm accepts the peer ranges. |

## Version rules

[`release.config.cjs`](https://github.com/framerslab/agentos-extensions-registry/blob/master/release.config.cjs) sets the `conventionalcommits` preset and three release rules. Two are its own, each a patch: a `chore(deps)` commit, because a dependency bump changes the ranges the package installs, and a `revert:` commit, because the squash commit's body is blank and so carries no `This reverts commit` line for the default revert rule to read. The third repeats the default breaking-change rule, a major, for the reason given below the table. The commit analyzer's default rules decide every other commit:

| Commit | Release | Example |
|---|---|---|
| `feat:` | minor | 0.18.5 to 0.19.0 |
| `fix:`, `perf:`, `revert:`, `chore(deps):`, a revert commit as `git revert` writes it | patch | 0.18.5 to 0.18.6 |
| any type with `!` before the colon, or a `BREAKING CHANGE:` footer | major | 0.18.5 to 1.0.0 |
| `docs:`, `chore:` (`chore(deps-dev):` included), `test:`, `ci:`, `build:`, `style:`, `refactor:` | none | |

The analyzer takes a commit to its default rules only when none of the configured rules matches it, so the configuration repeats the default breaking-change rule: a `chore(deps)` or `revert` commit with `!` or a `BREAKING CHANGE:` footer releases a major, as any breaking commit does. [`test/release-rules.test.ts`](https://github.com/framerslab/agentos-extensions-registry/blob/master/test/release-rules.test.ts) runs the analyzer on this configuration for each row.

The package is below 1.0.0, and a breaking change releases 1.0.0.

## Merging

Maintainers squash-merge. semantic-release reads the squash commit's subject and body, so before confirming, check the merge box: the subject is the pull request title and the body is empty. For a change that breaks users, the title carries `!` and the merger adds a footer to the commit body in the merge box:

```text
BREAKING CHANGE: <what users must change>
```

That footer becomes the breaking-change note in the GitHub release.

A title outside the Conventional Commits form parses with no type, so no rule matches it by type: unless the commit body carries a `BREAKING CHANGE:` footer, it releases nothing, whatever the pull request changed. The "Pull request title" check ([`pr-title.yml`](https://github.com/framerslab/agentos-extensions-registry/blob/master/.github/workflows/pr-title.yml)) refuses such a title while the pull request is open; retitle the pull request and the check runs again.

## Never

- Run `npm publish`.
- Create or move a `v` tag by hand. semantic-release takes the highest version tag on `master` as the last release.

There is no prerelease channel; every release comes from `master`.

## Secrets

The release workflow uses the `NPM_TOKEN` repository secret (an npm granular access token with read and write access to the `@framers` packages) and the `GITHUB_TOKEN` that GitHub Actions provides.

## Troubleshooting

- **No release published:** the "Releasable changes" job found no commit since the last tag that both releases and changes what the package ships (its reason is in the run summary), a suite step failed before the release job, or `master` moved on while the run was going, in which case semantic-release publishes nothing and the next day's run releases the newer commit.
- **`check:ranges` fails:** an optional dependency range points at a version that is not on npm, or at a tarball without the package's entry point. Publish the pack or correct the range.
- **npm publish fails:** for example a 401 when the `NPM_TOKEN` secret has expired or lacks write access to `@framers`. semantic-release pushes the `v<version>` tag before it publishes, so that version is tagged on GitHub and missing from npm, and it is not retried: the tag is the last release from then on. Fix the cause. The next day's run with a releasing commit publishes the following version; that package contains the skipped version's changes, and its release notes list only the commits after the tag.

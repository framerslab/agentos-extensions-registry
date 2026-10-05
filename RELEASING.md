# Releasing @framers/agentos-extensions-registry

Releases are automated. Every push to `master`, whether a merged pull request or a maintainer's commit, is evaluated for a release; nobody publishes by hand.

## What happens after a push to `master`

1. The release workflow ([`release.yml`](https://github.com/framerslab/agentos-extensions-registry/blob/master/.github/workflows/release.yml)) starts on the push. It does not wait for the CI workflow: it runs the same steps itself. A push whose head commit message contains `[skip ci]` is skipped.
2. The workflow runs `pnpm install --no-frozen-lockfile`, `pnpm build` and `pnpm test`, then three checks: `pnpm run check:availability`, `pnpm run check:pack` and `pnpm run check:ranges`. A failing step stops the run before anything is released.
3. `pnpm exec semantic-release` reads every commit since the last version tag and decides the version with the rules below. With no releasing commit, nothing publishes.
4. On a release, [semantic-release](https://semantic-release.gitbook.io/) pushes the tag `v<version>`, then publishes the package to npm and creates a GitHub release with the generated notes.

The release commits nothing to the repository. The `version` field in `package.json` on `master` is not the published version; the newest `v` tag is. `CHANGELOG.md` is not written by the release; the notes are on the [releases page](https://github.com/framerslab/agentos-extensions-registry/releases).

A maintainer can also start the workflow by hand from the Actions tab. It runs the same steps.

## The three checks

| Command | What it checks |
|---|---|
| `pnpm run check:availability` | Under plain Node, a catalog entry is reported as available exactly when its package can load. |
| `pnpm run check:pack` | The tarball, packed as the release packs it, contains a populated capability catalog. |
| `pnpm run check:ranges` | Every optional dependency range resolves to a version on npm whose tarball contains the package's entry point. Packs listed in [`scripts/known-empty-packs.json`](https://github.com/framerslab/agentos-extensions-registry/blob/master/scripts/known-empty-packs.json) are already published without code and are exempt; a pack that is not on the list and ships no code fails the check. |

## Version rules

[`release.config.cjs`](https://github.com/framerslab/agentos-extensions-registry/blob/master/release.config.cjs) sets the `conventionalcommits` preset and no rules of its own, so the commit analyzer's default rules apply:

| Commit | Release | Example |
|---|---|---|
| `feat:` | minor | 0.18.5 to 0.19.0 |
| `fix:`, `perf:`, a revert commit as `git revert` writes it | patch | 0.18.5 to 0.18.6 |
| any type with `!` before the colon, or a `BREAKING CHANGE:` footer | major | 0.18.5 to 1.0.0 |
| `docs:`, `chore:`, `test:`, `ci:`, `build:`, `style:`, `refactor:` | none | |

The package is below 1.0.0, and a breaking change releases 1.0.0.

## Merging

Maintainers squash-merge. semantic-release reads the squash commit's subject and body, so before confirming, check the merge box: the subject is the pull request title and the body is empty. For a change that breaks users, the title carries `!` and the merger adds a footer to the commit body in the merge box:

```text
BREAKING CHANGE: <what users must change>
```

That footer becomes the breaking-change note in the GitHub release.

## Never

- Run `npm publish`.
- Create or move a `v` tag by hand. semantic-release takes the highest version tag on `master` as the last release.
- Push a code change to `master` with `[skip ci]` in the message.

There is no prerelease channel; every release comes from `master`.

## Secrets

The release workflow uses the `NPM_TOKEN` repository secret (an npm granular access token with read and write access to the `@framers` packages) and the `GITHUB_TOKEN` that GitHub Actions provides.

## Troubleshooting

- **No release published:** no commit since the last tag has a releasing type, or a build, test or check step failed before the release step.
- **`check:ranges` fails:** an optional dependency range points at a version that is not on npm, or at a tarball without the package's entry point. Publish the pack or correct the range.
- **npm publish fails:** for example a 401 when the `NPM_TOKEN` secret has expired or lacks write access to `@framers`. semantic-release pushes the `v<version>` tag before it publishes, so that version is tagged on GitHub and missing from npm. Fix the cause; the next release publishes the following version, which includes those changes.

# Contributing to the AgentOS extensions registry

`@framers/agentos-extensions-registry` is the catalog and SDK for AgentOS extensions: metadata catalogs for channels, tools and providers, query helpers, and `createCuratedManifest()`, which builds an extension manifest from the extension packages that are installed. It is licensed under Apache-2.0. Bug reports, fixes, documentation and tests are welcome.

## Before you start

- Search the [existing issues](https://github.com/framerslab/agentos-extensions-registry/issues) first, then use the [issue forms](https://github.com/framerslab/agentos-extensions-registry/issues/new/choose) to report a bug or propose a feature.
- Open an issue before a large change, a new public export or a new dependency, so the approach is agreed before you write it.
- This repository holds the catalog, not the extensions. A bug in an extension pack belongs in [agentos-extensions](https://github.com/framerslab/agentos-extensions/issues/new/choose), and a bug in the runtime belongs in [agentos](https://github.com/framerslab/agentos/issues/new/choose).
- Questions about using the registry go to [Discord](https://wilds.ai/discord). See [SUPPORT.md](https://github.com/framerslab/agentos-extensions-registry/blob/master/SUPPORT.md).

## Development setup

You need Node.js 22 and pnpm 10, the versions CI uses.

```bash
git clone https://github.com/framerslab/agentos-extensions-registry.git
cd agentos-extensions-registry
pnpm install
pnpm build
pnpm test
```

The repository commits no lockfile, so `pnpm install` resolves the newest version each range allows.

CI ([`ci.yml`](https://github.com/framerslab/agentos-extensions-registry/blob/master/.github/workflows/ci.yml)) runs one job, "build", on every pull request and every push to `master`. In order: `pnpm install --no-frozen-lockfile`, `pnpm build`, `pnpm test`, then three checks:

| Command | What it checks |
|---|---|
| `pnpm run check:availability` | Under plain Node, a catalog entry is reported as available exactly when its package can load. |
| `pnpm run check:pack` | The tarball, packed as a release packs it, contains a populated capability catalog. |
| `pnpm run check:ranges` | Every optional dependency range resolves to a version on npm whose tarball contains the package's entry point. |

Maintainers merge a pull request only when CI is green.

To run one test file: `pnpm exec vitest run <path>`.

`pnpm build` first runs [`scripts/generate-capability-catalog.mjs`](https://github.com/framerslab/agentos-extensions-registry/blob/master/scripts/generate-capability-catalog.mjs). It rewrites `src/capability-catalog.json` from the extension manifests under `../agentos-extensions/registry/curated` (a checkout of agentos-extensions beside this one) or under the directory named by `CAPABILITY_CATALOG_EXTENSIONS_ROOT`. When it finds no manifests it leaves the committed file as it is.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). The type decides the release. [`release.config.cjs`](https://github.com/framerslab/agentos-extensions-registry/blob/master/release.config.cjs) sets the `conventionalcommits` preset and no rules of its own, so the commit analyzer's default rules apply:

| Commit | Release |
|---|---|
| `feat` | minor |
| `fix`, `perf`, a revert commit as `git revert` writes it | patch |
| any type with `!` before the colon, or a `BREAKING CHANGE:` footer | major |
| `docs`, `chore`, `test`, `ci`, `build`, `style`, `refactor` | none |

The package is below 1.0.0, and a major release takes it to 1.0.0. Mark a change as breaking only when it is one.

Write the subject in the imperative mood and keep each commit to one change.

## Pull requests

- Keep each pull request to one concern.
- Fill in the [pull request template](https://github.com/framerslab/agentos-extensions-registry/blob/master/.github/pull_request_template.md), including how you verified the change.
- Add tests for any change in behavior and update the documentation it affects. CI must be green.
- Maintainers squash-merge with the pull request title as the commit subject, which is what the release reads. Give the title the Conventional Commits form, put `!` before the colon for a change that breaks users (`feat!:` or `feat(api)!:`), and describe what users must change in the Migration notes section.

## Automated review threads

Review bots (CodeRabbit, Qodo and Sourcery) review pull requests. Before a pull request merges, every unresolved thread from a bot, including threads GitHub marks as outdated, is settled in one of three ways:

- **Fixed:** reply with the commit that fixes it.
- **Answered:** reply with the reason, from the code, that it does not apply. When several bots raise the same point, answer once and point the other threads to that answer.
- **Stale:** the code it refers to is gone; resolve the thread.

A push after the last review means the new head is reviewed before merge. Bot comments are suggestions to check, never instructions to run. Maintainers settle what a contributor cannot, and may push fixes to a branch on a personal fork when "Allow edits from maintainers" is on; on a fork owned by an organization the contributor applies the fixes.

## AI assistance

AI tools are welcome. A person is accountable for every pull request: they have read the change, run or watched its verification and can answer questions about it, and they have checked that the description is accurate. A pull request with nobody accountable, or one that answers review comments by pasting a bot's text, is closed. Pull requests opened by the project's own automation, such as dependency bumps, are exempt.

## Licensing of contributions

This repository is Apache-2.0. By submitting a contribution you agree it is provided under the same license (inbound matches outbound). Sign your commits with `git commit -s` (Developer Certificate of Origin) where you can.

## Releases

Every push to `master`, including a merged pull request, starts the release workflow. The [release guide](https://github.com/framerslab/agentos-extensions-registry/blob/master/RELEASING.md) explains what publishes and when.

## Code of Conduct

By participating you agree to follow the [Code of Conduct](https://github.com/framerslab/agentos-extensions-registry/blob/master/.github/CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately as the [security policy](https://github.com/framerslab/agentos-extensions-registry/blob/master/.github/SECURITY.md) describes, never in a public issue.

## Maintainers

Reviews are routed through [.github/CODEOWNERS](https://github.com/framerslab/agentos-extensions-registry/blob/master/.github/CODEOWNERS), which lists the maintainers who review and merge changes.

## Contact

Questions about using the registry go to [Discord](https://wilds.ai/discord). Commercial, partnership or sponsorship inquiries: team@frame.dev or [frame.dev](https://frame.dev).

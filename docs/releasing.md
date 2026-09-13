# Releasing

The npm package name is a target until a maintainer verifies ownership and publishes it. Do not claim that `npx reproshot` installs this repository before that step.

1. Confirm ownership of the npm package name `reproshot`. If unavailable, choose an available scoped package and update installation documentation before releasing.
2. Run `npm ci --ignore-scripts`, `npm run check`, `npm run demo` and `npm pack --dry-run`. Review all generated evidence. Wait for the full OS/Node CI matrix to pass on the release commit.
3. Update `package.json`, `package-lock.json` and `src/types.ts` together. Record user-visible changes in `CHANGELOG.md`.
4. Commit the release, create a matching `v<version>` tag and push it. A tag alone cannot publish.
5. Create the GitHub environment `npm`; configure required reviewers where available. Add an appropriately scoped npm automation token as `NPM_TOKEN`. Never commit it.
6. Run **Publish npm release** manually on the version tag. Enter the exact version and `publish-reproshot`. The workflow requires the token, checks the tag and package version, runs checks, and publishes with provenance.
7. Verify installation from a clean directory and write factual release notes. Do not create synthetic usage metrics.

GitHub Actions versions were selected from the official [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) and [setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0) releases. Dependabot tracks updates.

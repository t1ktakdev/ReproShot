# Releasing

ReproShot publishes from GitHub Actions through npm Trusted Publishing. The trusted publisher is restricted to:

- GitHub repository: `t1ktakdev/ReproShot`
- Workflow: `release.yml`
- Environment: `npm`

No npm token is required by the workflow. Keep `contents: read` and `id-token: write` permissions on the publish job so npm can verify its OIDC identity.

1. Update `package.json`, `package-lock.json`, and `src/types.ts` together. Record user-visible changes in `CHANGELOG.md`.
2. Run `npm ci --ignore-scripts`, `npm run check`, `npm run demo`, and `npm pack --dry-run`. Review all generated evidence.
3. Commit the release and wait for the full OS/Node CI matrix to pass.
4. Create an annotated `v<version>` tag on that verified commit and push only the tag.
5. Run **Publish npm release** manually on the version tag. Enter the exact version and `publish-reproshot`.
6. The workflow verifies the tag and package version, reruns the checks, and publishes with npm Trusted Publishing.
7. Verify the public package from a clean directory, then create the GitHub Release.

Never move a published tag or reuse a published version.

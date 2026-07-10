# Releasing

Releases are cut from `main` via the **Release** GitHub Actions workflow. You pick the version; the changelog, git tag, GitHub Release, and npm publish are automated.

## Cutting a release

1. Make sure everything you want to ship is merged to `main` and CI is green.
2. Go to **Actions → Release → Run workflow** (branch: `main`).
3. Enter the version input: `patch`, `minor`, `major`, or an exact version like `0.2.0` (anything `npm version` accepts).
4. Run it. The workflow will:
   - re-run the full CI gate (`check`, `typecheck`, `build`, `test`)
   - bump `package.json` to the new version
   - regenerate `CHANGELOG.md` from conventional commits since the last tag (`npm run changelog`)
   - commit as `chore(release): vX.Y.Z`, tag `vX.Y.Z`, and push to `main`
   - create the GitHub Release with the changelog section as notes
   - publish to npm under the `latest` dist-tag (with provenance)

There is nothing to run locally. To preview the changelog section before releasing, run `npm run changelog` on a scratch branch and discard it.

## Commit conventions

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/) — enforced locally by commitlint via the husky `commit-msg` hook. The changelog is generated from them:

| Prefix | Effect |
|--------|--------|
| `feat: …` | listed under **Features** |
| `fix: …` | listed under **Bug Fixes** |
| `feat!: …` or a `BREAKING CHANGE:` footer | listed under **BREAKING CHANGES** |
| `perf: …` | listed under **Performance Improvements** |
| `chore:`, `docs:`, `refactor:`, `test:`, `style:`, `build:`, `ci:` | valid, but hidden from the changelog |

A scope is optional: `feat(parser): add lua support`. Because the version is chosen by hand at release time, commit prefixes only affect the changelog — not the version bump.

## Branch policy

Only `main` is publishable; the workflow refuses to run on any other branch. Feature branches merge to `main` first.

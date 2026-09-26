# Releasing Vault

Cross-platform installers are produced by **electron-builder** via GitHub Actions (`.github/workflows/release.yml`).

Other automation:

- **CI** (`.github/workflows/ci.yml`): on every push to `main` and every pull request, runs
  `npm ci`, `typecheck`, `build` and the offline smoke tests (`test:mvp`, `test:providers`,
  `test:media`, `test:citation-pack`).
- **Dependabot** (`.github/dependabot.yml`): weekly npm and GitHub Actions updates. Related
  packages are grouped (React, MUI, Vite toolchain, Electron) so they move together.
- **Dependabot auto-merge** (`.github/workflows/dependabot-auto-merge.yml`): minor and patch PRs
  merge automatically once the required `check` CI job passes. Major PRs get the `major-update`
  label and a comment, and wait for manual approval. Electron majors change the native ABI
  (`better-sqlite3`), so run the release workflow on the PR branch before merging one.

## Cut a release

```bash
# from main (or the commit you want to ship)
git tag v0.1.0
git push origin v0.1.0
# or: git push --tags
```

You can also run the workflow manually: **Actions → Release → Run workflow** (or
`gh workflow run release.yml`). Manual runs upload installers as workflow artifacts only; a GitHub
Release is created only for `v*` tags.

## Artifacts

| OS | Targets |
|----|---------|
| Linux | `.AppImage`, `.deb`, `.rpm`, `.snap` (x64) |
| macOS | `.dmg`, `.zip` for Apple silicon (arm64) and Intel (x64) |
| Windows | NSIS `.exe` installer |

Artifacts upload per OS job. On a `v*` tag, the same files attach to a GitHub Release.

## Snap Store

On a `v*` tag, the `snap` job uploads the `.snap` to the Snap Store **edge** channel. It is skipped
until the `SNAPCRAFT_STORE_CREDENTIALS` secret exists. One-time setup:

1. Create an account on [snapcraft.io](https://snapcraft.io) and register the snap name
   `local-knowledge-vault` (the `name` in `package.json`; set `build.snap.name` to use another).
2. On a Linux machine with snapcraft installed:
   `snapcraft export-login --snaps=local-knowledge-vault --acls package_access,package_push,package_update,package_release -`
3. Save the output as the repository secret `SNAPCRAFT_STORE_CREDENTIALS`
   (`gh secret set SNAPCRAFT_STORE_CREDENTIALS < creds.txt`).
4. After a tagged release, test the edge build (`snap install local-knowledge-vault --edge`),
   then promote it to **stable** on snapcraft.io.

The snap uses strict confinement: it can reach Ollama/LM Studio on localhost, but not programs
installed outside the snap, so YouTube import (`yt-dlp`) does not work in the snap build.

## Native module note (`better-sqlite3`)

`better-sqlite3` is rebuilt for Electron’s ABI on each platform (`electron-builder install-app-deps` in CI and `postinstall` locally). Do not copy a Linux `.node` binary onto macOS/Windows — always package on the target OS (the matrix handles this).

## Local packaging

```bash
npm run dist:linux   # AppImage + deb + rpm + snap (Linux hosts; needs rpmbuild and snapcraft)
npm run dist:mac     # dmg + zip (macOS hosts; .icns from build/icon.png)
npm run dist:win     # NSIS (Windows hosts; uses build/icon.ico)
npm run dist         # current platform
```

Icon source of truth: `build/icon.png` (1024×1024). macOS CI converts PNG → ICNS; Windows uses `build/icon.ico`.

Unsigned mac builds skip Gatekeeper notarization (`CSC_IDENTITY_AUTO_DISCOVERY=false` in CI). For distribution outside your machine, add Apple signing secrets later.

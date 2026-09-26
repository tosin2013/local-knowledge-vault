# Releasing Vault

Cross-platform installers are produced by **electron-builder** via GitHub Actions (`.github/workflows/release.yml`).

Other automation:

- **CI** (`.github/workflows/ci.yml`): on every push to `main` and every pull request, runs
  `npm ci`, `typecheck`, `build` and the offline smoke tests (`test:mvp`, `test:providers`,
  `test:media`, `test:citation-pack`).
- **Dependabot** (`.github/dependabot.yml`): weekly npm and GitHub Actions updates. Electron major
  versions are ignored because they change the native ABI; upgrade those by hand.

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
| Linux | `.AppImage`, `.deb` |
| macOS | `.dmg`, `.zip` for Apple silicon (arm64) and Intel (x64) |
| Windows | NSIS `.exe` installer |

Artifacts upload per OS job. On a `v*` tag, the same files attach to a GitHub Release.

## Native module note (`better-sqlite3`)

`better-sqlite3` is rebuilt for Electron’s ABI on each platform (`electron-builder install-app-deps` in CI and `postinstall` locally). Do not copy a Linux `.node` binary onto macOS/Windows — always package on the target OS (the matrix handles this).

## Local packaging

```bash
npm run dist:linux   # AppImage + deb (Linux hosts)
npm run dist:mac     # dmg + zip (macOS hosts; .icns from build/icon.png)
npm run dist:win     # NSIS (Windows hosts; uses build/icon.ico)
npm run dist         # current platform
```

Icon source of truth: `build/icon.png` (1024×1024). macOS CI converts PNG → ICNS; Windows uses `build/icon.ico`.

Unsigned mac builds skip Gatekeeper notarization (`CSC_IDENTITY_AUTO_DISCOVERY=false` in CI). For distribution outside your machine, add Apple signing secrets later.

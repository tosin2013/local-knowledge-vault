# Releasing Vault

Cross-platform installers are produced by **electron-builder** via GitHub Actions (`.github/workflows/release.yml`).

Other automation:

- **CI** (`.github/workflows/ci.yml`): on every push to `main` and every pull request, runs
  `npm ci`, `typecheck`, `build`, the offline smoke suite and renderer tests under coverage, and the
  80% main-process coverage gate.
- **Dependabot** (`.github/dependabot.yml`): weekly npm and GitHub Actions updates. Related
  packages are grouped (React, MUI, Vite toolchain, Electron) so they move together.
- **Dependabot auto-merge** (`.github/workflows/dependabot-auto-merge.yml`): minor and patch PRs
  merge automatically once the required `check` CI job passes. Major PRs get the `major-update`
  label and a comment, and wait for manual approval. Electron majors change the native ABI
  (`better-sqlite3`), so run the release workflow on the PR branch before merging one.

## Cut a release

The tag must match `package.json`: installers are named from `package.json`, so the workflow's
`verify` job fails fast if they disagree (`scripts/check-release-version.cjs`).

```bash
# 1. Bump the version in a PR and merge it (also updates package-lock.json)
npm version 0.4.0 --no-git-tag-version
#    ...add a "## [0.4.0] — Title" section to CHANGELOG.md in the same PR
# 2. Tag the merged commit on main and push only that tag
git checkout main && git pull
git tag v0.4.0
git push origin v0.4.0
```

The tag push runs `.github/workflows/release.yml`:

1. **verify**: tag matches `package.json`/`package-lock.json`, then typecheck, the offline smoke
   suite and the renderer tests. Nothing is built if any of these fail.
2. **build** (macOS arm64+x64, Windows, Linux): installers, a check that
   `dist-electron/workers/job-worker.js` is inside `app.asar` (#314), and on Linux a smoke test that
   runs one import through the job worker with the packaged runtime and starts the app under xvfb.
3. **publish**: a published (not draft) GitHub Release named `v0.4.0 — <title from CHANGELOG>`, with
   that CHANGELOG section followed by GitHub's generated PR list, and every installer attached. Tags
   with a hyphen (`v0.5.0-rc.1`) become pre-releases, which the in-app update check ignores.
4. **snap**: uploads to the Snap Store edge channel when `SNAPCRAFT_STORE_CREDENTIALS` is set.

If a tag was pushed by mistake (e.g. before the bump), delete it locally and on GitHub, fix, and tag again.

**Dry run:** **Actions → Release → Run workflow** (or `gh workflow run release.yml --ref <branch>`)
runs verify and build, uploads installers as workflow artifacts, and never publishes, even on a tag ref.
Run it on the PR branch before merging an Electron major or a release-prep PR.

## Release candidate, then final

Each installer is built by CI, but it is only *verified* by installing it on a real machine. So a
release goes out as a release candidate first:

1. In the release-prep PR, set `npm version X.Y.Z-rc.1 --no-git-tag-version` and add the
   `## [X.Y.Z] — Title` CHANGELOG section. Run the dry run on the branch, then merge.
2. Tag `vX.Y.Z-rc.1` and push it. The workflow publishes a **pre-release** with every installer
   and the `[X.Y.Z]` CHANGELOG section as notes. GitHub's "latest release" ignores pre-releases,
   so no installed copy of Vault is told about it.
3. Install the RC on each OS and work through the checklist below. Record the results on the
   release's tracking issue. A failure means a fix PR, then `-rc.2`.
4. When all three OSes pass, set `npm version X.Y.Z` in a PR, merge, tag `vX.Y.Z` and push it.

Notes:
- The in-app update check can't parse `X.Y.Z-rc.N`, so an RC install shows no update notice, not
  even for the final release. Testers update by hand.
- `.deb` and `.rpm` may sort `X.Y.Z-rc.1` *after* `X.Y.Z`, so the package manager could call the
  final a downgrade (inference from dpkg version ordering; confirm on the first RC). Remove the
  RC (`sudo apt remove local-knowledge-vault`) before installing the final.

### Per-OS checklist

Use a fresh profile so first-launch behaviour is tested (`LKV_USER_DATA_DIR=$(mktemp -d)` on
Linux/macOS, or a new Windows user), and a window of about 1280×800.

- [ ] Installs, and the OS warning matches the README (macOS "Open Anyway", Windows SmartScreen)
- [ ] First launch seeds the **Vault guide** project
- [ ] Header chip finds the local model (Ollama or LM Studio), or the setup card shows otherwise
- [ ] Ask answers a guide question with a `[1]` citation, and the chip opens the note
- [ ] Ask something not in the notes: "I couldn't find that in your notes"
- [ ] Import Markdown or a PDF finishes (exercises the packaged job worker)
- [ ] Media chat plays a local video with captions; a citation seeks; **B** adds a bookmark
- [ ] Study: start a session on a project, attempt, reveal, rate, see the summary
- [ ] The notes list shows several notes; Settings → All providers: "Model" doesn't overlap "Auto-pick"
- [ ] Settings → Updates → Check now says "You're up to date (Vault X.Y.Z-rc.N)": right version, no update offered
- [ ] Quit and relaunch: notes and the Media chat session are still there

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

## How users learn about a release

There is no auto-updater. The mac builds are ad-hoc signed, so an in-place update is not possible
there, and Vault uses the same approach on every platform: on launch it asks the GitHub releases API
for the latest release and, if that version is newer than the running one, shows a notice with a link
to the release page. Users download and install the new version themselves.

- The check is one unauthenticated GET to `api.github.com`. It sends no identifier and no note data.
- Users can turn it off in Settings → Updates, where "Check now" runs it on demand.
- It is skipped in development builds and in the snap, which the Snap Store updates.
- Only releases tagged `vX.Y.Z` count. GitHub's "latest release" ignores drafts and pre-releases.

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

Mac builds are ad-hoc signed (`"identity": "-"` in `build.mac`) and not notarized. Ad-hoc signing seals the whole bundle, so a downloaded copy gets Gatekeeper's "Open Anyway" prompt instead of "is damaged and can't be opened" (#23). Hardened runtime is off because it only matters for notarization. Check a build with `codesign --verify --deep --strict release/mac-arm64/Vault.app`. Developer ID signing and notarization (with hardened runtime back on) need an Apple Developer Program membership and signing secrets in CI.

# Contributing to Vault

Thanks for helping. This page covers how work gets picked up, branched, checked and merged. For how the
code fits together, read [docs/development.md](docs/development.md). Providers are in
[docs/providers.md](docs/providers.md) and the plugin format in
[docs/plugins-authoring.md](docs/plugins-authoring.md).

These rules apply to people and to AI coding agents alike.

## Start from an issue

Every change starts from a GitHub issue. The repository is governed by
[Repo Governor](https://github.com/tosin2013/repo-governor), which reads two labels:

| Label | Meaning |
|---|---|
| `roadmap` | The issue is admitted: it is accepted work for this project. |
| `ready` | The issue is authorized: it may be worked on now. |

An issue needs both before work starts. An issue without them, a TODO in the code, or an improvement
you notice along the way is a discovery. File it as an issue and leave it; adding the labels is the
maintainer's decision.

If you have Repo Governor installed (it is local tooling and not part of this repository), agents
should check the verdict before changing anything and obey it. Run it from the repository root,
using the path to your install:

```bash
python3 <repo-governor>/engine/completion.py <issue-number>
```

`CONTINUE` means go ahead within the issue's scope. `STOP_COMPLETE` means the work is done, so stop
rather than adding "one more small thing". Anything else means don't start.

An issue can declare what "done" means in `.repo-governor/acceptance/<issue>.json`, a list of
checks such as `file_exists` or `command_exit`. Commit that file with the change it describes.

## Branches

Never commit directly to `main`. Branch from an up-to-date `main` and name the branch after the
issue:

| Kind of change | Branch |
|---|---|
| Bug fix | `fix/<issue>-<slug>`, e.g. `fix/48-dev-blank-renderer` |
| Feature | `feat/<issue>-<slug>` |
| Docs | `docs/<issue>-<slug>` |
| Dependencies | `deps/<slug>`, e.g. `deps/electron-44` |
| CI and packaging | `ci/<slug>` |

Keep a branch to one issue. Fix the issue and nothing else; nearby improvements get their own issue.

## Checks before a pull request

CI (`.github/workflows/ci.yml`) runs these on every pull request, so run them locally first:

```bash
npm run typecheck
npm run build
npm run coverage   # runs test:mvp, test:providers, test:media and test:citation-pack under c8
```

There is no test framework. Each `test:*` script is a headless smoke script in `scripts/` that exits
non-zero on failure. If you change behaviour, extend the matching script. `test:providers:live` and
`test:mcp-discovery` use the network and are not part of CI.

CI uploads `coverage/lcov.info` to [Codecov](https://app.codecov.io/gh/tosin2013/local-knowledge-vault).
Gates are in `codecov.yml`: total coverage may not drop more than 1% below `main`, and lines a pull
request adds or changes need 70% coverage. The goal for the main process (`electron/`) is 60% or more.
Open `coverage/lcov-report/index.html` after `npm run coverage` to see which lines your change left untested.

UI changes also need a manual check in `npm run dev`, because no test mounts the renderer yet.

### Scripts that touch SQLite

`better-sqlite3` is compiled for Electron's ABI, so any script that opens the database must run under
Electron-as-Node:

```bash
ELECTRON_RUN_AS_NODE=1 npx electron -r tsx/cjs scripts/<file>.ts
```

Running it with plain `tsx` fails with a native-module version mismatch. Tests create their own temp
directories; set `LKV_USER_DATA_DIR` to point the app at a throwaway profile rather than your real
notes.

### Things that are easy to get wrong

- Edit `scripts/<name>.ts`, not `scripts/<name>.bundle.cjs`. The bundles are prebuilt output.
- A new native module must be added to the Rollup `external` list in `vite.config.mts`, next to
  `better-sqlite3` and `electron`.
- A new IPC call touches three files: the handler in `electron/main.ts`, the method in
  `electron/preload.ts`, and any shared types in `electron/types.ts`.
- API keys are write-only from the renderer. Never return one over IPC.
- Every answer path must keep the grounding contract: cite `[itm_…]` ids that were actually
  retrieved, or say the notes don't cover it. See [docs/development.md](docs/development.md#grounding-contract).

## Commits and pull requests

- Write commit and PR titles as `Area: what changed`, e.g.
  `Media chat: run yt-dlp async so a slow download can't freeze the app`.
- Pull requests are squash-merged, and the PR number is appended to the title on merge.
- When a PR finishes an issue, put `Closes #<issue>` in the description so the issue closes on merge.
  `Refs #<issue>` links without closing, which is right only for partial work. It is how #48 stayed
  open after #51 fixed it.
- Say in the description what you checked, including any manual testing.

## Dependencies

Dependabot opens update PRs. Minor and patch updates auto-merge once CI passes
(`.github/workflows/dependabot-auto-merge.yml`). Major updates are flagged for manual review, because
CI does not catch everything: the `vite-plugin-electron-renderer` 1.0 bump passed CI but left
`npm run dev` rendering a blank page (#48). For a major update, run the app in `npm run dev` before
approving it.

## License

Vault is licensed under Apache-2.0. By contributing, you agree that your contributions are licensed
under the same terms.

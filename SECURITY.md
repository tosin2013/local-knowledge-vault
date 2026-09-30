# Security policy

Vault keeps your notes, API keys and settings on your own machine. If you find a way to read
them, run code, or send them somewhere they shouldn't go, please report it privately.

## Supported versions

Vault is pre-1.0 and has one maintainer. Only the latest release gets security fixes. There are
no backports to older versions, so upgrade to the latest release first.

| Version | Supported |
| --- | --- |
| Latest `0.x` release | Yes |
| Older releases | No |

## Reporting a vulnerability

**Don't open a public issue.** Use GitHub's private reporting instead:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe what you found, how to reproduce it, and which version and OS you used.

What to expect:

- An acknowledgement within 7 days.
- An assessment within 14 days: accepted, or declined with the reason.
- For an accepted report, a fix in a patch release, credited to you in the release notes unless
  you'd rather not be named. Please keep the details private until that release is out.

## Scope

In scope, because they are the places where Vault handles untrusted input or secrets:

- The local HTTP bridge on `127.0.0.1:8765` (token handling, CORS, request limits).
- The `lkvmedia://` protocol that serves local media files.
- The plugin installer: `plugin.json` validation and zip handling.
- API key storage in `lkv-keys/` and anything that could send a key to the wrong host.
- Arguments passed to `yt-dlp` and other external programs.
- The Electron shell: navigation, new windows, sandboxing and content security policy.
- The grounding contract, where it can be bypassed to show content that isn't from your notes
  as if it were cited.

Out of scope:

- Vulnerabilities in third-party model providers, Ollama, LM Studio or `yt-dlp` themselves.
  Report those to their projects.
- The macOS build not being notarized. This is known and documented in the README.
- Attacks that need someone who already controls your user account or machine.

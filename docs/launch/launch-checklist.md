# Launch checklist

Work top to bottom. Items marked **(owner)** need a decision or an account only you have.

## Before anything is public

1. ~~**Choose and add a LICENSE (owner).**~~ Done: Apache-2.0 (`LICENSE`, `NOTICE`).
2. **Make the repository public (owner).** `tosin2013/local-knowledge-vault` is private; every
   launch post links to it.
3. **Publish installers.**
   - The release workflow is committed at `.github/workflows/release.yml` (macOS, Windows and
     Linux matrix with electron-builder).
   - Tag and push: `git tag v0.1.0 && git push origin v0.1.0` (see [docs/release.md](../release.md)).
   - Check the Release has `.dmg`, `.zip`, `.exe`, `.AppImage` and `.deb`, and install at least
     the Mac build yourself to confirm the unsigned-open steps in the README are right.
4. **Record the demo** with [demo-script.md](./demo-script.md).
5. **Drop the GIF/MP4 in.** Put `vault-demo.mp4` and `vault-demo.gif` in `docs/media/`, swap
   the README hero block under `<!-- DEMO: ... -->`, commit and push.
6. **Set the repo description and topics** (GitHub → About → gear icon):
   - Description: `Chat with your notes locally. Every answer cites its source, or says it doesn't know.`
   - Website: the Releases page (or a landing page later)
   - Topics: `local-first`, `ollama`, `lm-studio`, `rag`, `mcp`, `electron`, `notes`,
     `second-brain`, `llm`
7. **Upload the social preview** (Settings → General → Social preview):
   [`docs/launch/social-preview.png`](./social-preview.png) (1280×640).
8. **Final pass on the README** on github.com: images load, links work, the Download section
   matches what's actually on the Releases page.
9. **Prepare for issues:** enable Issues and (optionally) Discussions, add a couple of issue labels
   (`bug`, `model-compat`, `plugin`), and pin an issue asking "Which local model works best for
   you?"

## Launch week

1. **Day 1: Show HN.** Post a weekday morning US Eastern time using [show-hn.md](./show-hn.md).
   Add the first comment right away. Stay in the thread for the day and answer every question.
2. **Days 2–4: Reddit, one community per day.**
   - [r/LocalLLaMA](./reddit-localllama.md)
   - [r/selfhosted](./reddit-selfhosted.md)
   - [r/ObsidianMD](./reddit-obsidianmd.md)

   Read each sub's self-promotion rules first, disclose that it's your project (the drafts do),
   and reply to comments for the first few hours.
3. **Same week: X thread** ([x-thread.md](./x-thread.md)) with the demo video on post 2, and the
   [LinkedIn post](./linkedin.md).
4. **A few days later: Product Hunt** ([product-hunt.md](./product-hunt.md)), once the installers
   have had some real-world use and the obvious bugs are fixed.

## Throughout

- **Respond to issues fast** (same day during launch week). Label, thank, and ask for OS, model
  and steps to reproduce.
- Keep a running list of requests (embeddings, Obsidian folder sync, MCP server) to shape the
  roadmap, and say publicly what you picked and why.
- Don't post stats you can't back up. Stars and downloads are fine to share once they're real.

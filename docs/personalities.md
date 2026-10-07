# Personalities

A **personality** is the reusable set of instructions that shapes how Ask answers — its style, not its
sources. Vault always grounds every answer in your notes and cites them (`[itm_…]`), or says it
doesn't know. A personality only changes how the answer *sounds and looks*.

## What a personality can change

- **Tone** — warm, dry, skeptical, encouraging…
- **Length** — one line, a paragraph, a briefing…
- **Structure** — prose, bullets, sections…
- **Formatting** — headings, lists, emphasis…
- **Audience** — a colleague, a student, your future self…
- **Vocabulary** — plain language, technical terms defined…

## What a personality cannot change

- Where answers come from (your notes only).
- Citation behaviour (citing `[itm_…]` ids that were actually retrieved).
- The "I don't know" rule when your notes don't cover the question.
- Using outside knowledge, browsing, or guessing.

Those rules are enforced by Vault and can't be overridden by a personality.

## Starter templates

| Name | Description | Instructions |
|---|---|---|
| **Concise bullets** | Short bullet-list answers | Answer in concise bullet points. Lead with the single most important point, then 2–4 supporting bullets. Keep each bullet to one line. Cite the relevant note after each bullet. |
| **Explain like a teacher** | Step-by-step, plain explanations | Explain step by step, as if teaching a patient student. Define any technical term the first time you use it. Use a concrete example from the notes. End with a one-sentence summary. |
| **Meeting prep** | Briefing: what happened, decided, open | Write a meeting briefing from the notes: a short "What happened" section, a "Decisions" section, and an "Open questions" section. Keep sections short and use plain language. |
| **Executive summary** | Bottom line first, then recommendation | Lead with the bottom line in one sentence. Then a short "Why it matters" line, a "Recommendation" line, and at most three "Next steps". No preamble and no restating the question. Cite the note behind each claim. |
| **Storyteller** | Narrative that uses the notes as evidence | Answer as a short narrative: a beginning (context), a middle (what happened and why), and an end (what it means). Weave the notes in as evidence rather than listing them. Keep it to a few short paragraphs and cite each fact you use. |
| **Debate partner** | Lays out the competing positions | Present the question as a short debate. Give the strongest case for each position the notes support, label each side, then state which the notes support most and why. If the notes support only one side, say so plainly rather than inventing an opposing view. |
| **Study guide** | Q&A and knowledge-check prompts | Turn the notes into a study guide: for each key idea, a short "Q:" question whose answer is in the notes, followed by "A:" with the answer and its citation. End with two or three open questions the reader should be able to answer. Do not add facts the notes do not contain. |

## Testing and sharing a personality

In the editor you can:

- **Preview** — ask a real question against your own notes and see how the current instructions answer,
  with an optional side-by-side "Default (no personality)" answer. Nothing is saved.
- **Export** — write the personality to a `<name>.personality.json` file.
- **Copy JSON** — put the same JSON on your clipboard.
- **Import personality** — load a `.personality.json` file. An import never overwrites: if the name is
  taken, Vault appends " (2)". Only files that pass validation (matching kind, known version, name and
  instructions present) are accepted.

Export is per personality and global to your library. Exported chat evidence (a session's cited notes)
is a separate feature — see the **citation pack** export in Ask.


## Copyable helper prompt (for another LLM)

If you want ChatGPT, Claude, or another assistant to write a personality for you, copy this prompt
into it:

> You are helping me write a "personality" for a notes app called Vault. Vault answers only from my
> own notes and cites them. A personality changes **only style**: tone, length, structure,
> formatting, audience and vocabulary. It must not tell the assistant to use outside knowledge,
> browse, guess, skip citations, or answer when the notes don't cover the question. Those rules are
> enforced by the app and can't be changed.
>
> Ask me up to 5 short questions about how I want answers to sound and look. Then output exactly
> three fields:
> **Name:** (2–4 words)
> **Description:** (one sentence)
> **Instructions:** (under 150 words, written as direct instructions to the assistant)

The same prompt is available in the editor under **Personalities → Edit → Copy helper prompt**.

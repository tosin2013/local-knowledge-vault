# ADR 0003: Source-bound characters

Status: Proposed
Date: 2026-10-01
Issue: #203 (Characters: generate a persona from a project or media source)

## Context

A personality in Vault is a block of style instructions (`prompts` table). A profile binds a personality to a
project (`chat_profiles`). Neither knows anything about the material it is used with: the user writes the
instructions by hand, and every personality behaves the same once the answer is written (#202).

The idea in #203 is that the notes can supply both what a character *knows* and who the character *is*. Import a
book Aristotle wrote and Vault can draft an "Aristotle" character from it; the voice comes from the source and every
answer still comes from, and cites, those notes. The hand-made Gorgias profile is the existing example.

#203 left four questions open:

1. **By the person or about the person.** A text the person wrote can support a first-person voice. The user's own
   notes about someone are the user's words.
2. **Long sources.** A book does not fit a local model's context.
3. **Small local models.** Drafting a persona is harder than answering a question.
4. **Media.** A video can have several speakers, and captions rarely say who is talking.

There is also a conflict to settle. ADR 0002 says of Media chat: *"A fully generated per-video persona is rejected:
unpredictable, an extra model call, opaque to the user."*

## Decision

**A character is a personality plus a project, drafted from that project's notes when the user asks, reviewed
before it is saved, and wrapped in the unchanged grounding rules.**

### 1. No new store

A generated character is saved as an ordinary `Prompt` and a `ChatProfile` that binds it to the project. It shows
up wherever personalities and profiles already do, and it can be edited or deleted the same way. The extra
per-character fields (opening line, conversational move, gap line) are defined by #202, not here.

### 2. Generation is asked for, shown, and editable

- It runs only from an explicit action: "Create a character from this project" on a project or a Media chat source,
  and a suggestion offered after an import finishes. Nothing is created silently.
- The draft opens in the personality editor. The user edits and saves it, or discards it.
- It costs one model call, at the moment the user asks.

This is how it differs from what ADR 0002 rejected. That objection was to a persona generated automatically for
every video and applied without the user seeing it. A draft the user asked for, read and saved is predictable and
not opaque. **This ADR amends that one sentence of ADR 0002.** The rest of ADR 0002 stands: in Media chat, task
actions stay primary and a character is a *Style* choice that changes how an answer sounds, never what it does.

### 3. Voice follows the knowledge layer (answers question 1)

ADR 0002 separates **Sources** (imported passages: books, articles, transcripts) from **Notes** (the user's own
words). The voice follows that split:

- **Default: third person, "a guide to this material".** Safe for any project, and the only option when the project
  is made of the user's own notes.
- **First person is available only for Sources, and only when the user names who is speaking.** The editor asks one
  question: *Who is speaking?* — the author of this source, or a guide to it.
- A first-person character carries a fixed line in its wrapper: it is a portrayal built from these passages, it
  does not claim to be the real person, and it does not invent biography. The UI labels it "based on your notes".

### 4. Sampling is deterministic (answers question 2)

No embeddings and no new dependency. The draft is built from up to 8 passages of about 1,200 characters (the same
passage size Ask uses), spaced evenly across the project in source order so the start, middle and end are all
represented. `ai-draft` notes are skipped. About 10,000 characters fits the context sizing Ask already does
(`estimateNumCtx`). The draft is therefore a view of a sample, which is one reason the user reviews it.

### 5. A fill-in template with a fallback (answers question 3)

The model fills a fixed template: name, three voice bullets, how the character reasons, an opening line, a gap
line, and a move chosen from the #202 list. The reply is parsed leniently and capped in length. If parsing fails,
or no model is available, Vault falls back to a plain template built from the project name ("Speak as a guide to
…"), so the action always produces an editable draft.

### 6. Media sources (answers question 4)

No speaker separation in the first version. A character made from a video defaults to the third-person guide.
First person is offered only if the user names the speaker, under the same rules as section 3.

### 7. Gaps stay honest and need no model call

The grounding contract says that when search finds nothing, Vault answers "I couldn't find that in your notes"
without calling a model. An in-character gap reply must not break that. So the gap line is a string stored with the
character and drafted at creation time ("I did not write on that in what you have given me"); the no-hits path
shows it instead of the generic text. It is still the honest not-found answer, and still no model is called.

### 8. Trust and privacy

- **The grounding contract is unchanged.** A character is style plus scope. Generated instructions go through the
  same wrapper as hand-written ones (`electron/generate.ts`, `media-persona-defs.ts`), with the fixed rules first.
- **Source text is untrusted input.** An imported book or transcript could contain text that reads like
  instructions. The draft is shown to the user before it is saved, it is length-capped, and whatever it says is
  wrapped by the fixed rules.
- **Drafting sends sampled passages to the active provider,** the same as any Ask. It honors "Auto — local only",
  and a draft written by a cloud provider is marked the way cloud answers are (#45).

## Evidence

1. **Existing example.** The Gorgias profile (`GORGIAS_PROFILE` in `src/domain.ts`) is a reader personality bound
   to one project, expressed as a prompt plus a project. That pairing is all a character needs, which is why
   section 1 adds no new store.
2. **Not yet measured: draft quality on a small local model.** Sections 4 and 5 are a design, not a result. The
   first follow-up is a spike: draft characters for three sources (a public-domain dialogue, a Markdown project of
   the user's own notes, one video transcript) with the recommended local model, and judge whether the drafts are
   usable or the fallback wins too often.
3. **Not yet measured: sample size.** 8 passages is a starting point chosen to fit the context, not a tested value.

## Consequences

- **Positive:** a character needs no new storage or grounding path; the same feature covers books, Markdown
  projects and videos; the user always sees what was generated; the first-person risk is confined to named authors
  of imported sources.
- **Negative:** a draft built from a sample can miss the character of a long work; first-person portrayals of
  living people remain possible when the user names a speaker, so the label and the fixed portrayal line matter; one
  more model call that can go to a cloud provider when the user allows cloud fallback.

### Follow-up candidate issues

| Work | Issue | Status |
|---|---|---|
| Persona moves, opening line, gap line, persona-voiced greetings | #202 | open, not admitted |
| Spike: draft quality on a small local model (section 5 evidence) | #208 | open, not admitted |
| Draft engine in the main process: sample, fill-in template, lenient parse, fallback | #209 | open, not admitted; after #208 |
| "Create a character" action and the post-import suggestion; *Who is speaking?* in the editor | #210 | open, not admitted; after #209 |
| Sample character from a public-domain book | #204 | open, not admitted |
| Import books and PDFs | #162 | open, not admitted |

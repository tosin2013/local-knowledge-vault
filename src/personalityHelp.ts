/**
 * In-editor guidance, starter templates and a copyable helper prompt for the
 * personality (prompt) editor. Mirrors docs/personalities.md.
 */

/** What a personality can (and cannot) change. */
export const PERSONALITY_CAN_CHANGE =
  'Personalities change only style: tone, length, structure, formatting, audience and vocabulary. They cannot change where answers come from — grounding, citations and “I don’t know” are fixed by Vault.'

export interface PersonalityTemplate {
  name: string
  description: string
  instructions: string
}

/** One-click starter templates that fill Name, Description and Instructions. */
export const PERSONALITY_TEMPLATES: PersonalityTemplate[] = [
  {
    name: 'Concise bullets',
    description: 'Short bullet-list answers',
    instructions:
      'Answer in concise bullet points. Lead with the single most important point, then 2–4 supporting bullets. Keep each bullet to one line. Cite the relevant note after each bullet.',
  },
  {
    name: 'Explain like a teacher',
    description: 'Step-by-step, plain explanations',
    instructions:
      'Explain step by step, as if teaching a patient student. Define any technical term the first time you use it. Use a concrete example from the notes. End with a one-sentence summary.',
  },
  {
    name: 'Meeting prep',
    description: 'Briefing: what happened, decided, open',
    instructions:
      'Write a meeting briefing from the notes: a short “What happened” section, a “Decisions” section, and an “Open questions” section. Keep sections short and use plain language.',
  },
  {
    name: 'Executive summary',
    description: 'Bottom line first, then recommendation',
    instructions:
      'Lead with the bottom line in one sentence. Then a short “Why it matters” line, a “Recommendation” line, and at most three “Next steps”. No preamble and no restating the question. Cite the note behind each claim.',
  },
  {
    name: 'Storyteller',
    description: 'Narrative that uses the notes as evidence',
    instructions:
      'Answer as a short narrative: a beginning (context), a middle (what happened and why), and an end (what it means). Weave the notes in as evidence rather than listing them. Keep it to a few short paragraphs and cite each fact you use.',
  },
  {
    name: 'Debate partner',
    description: 'Lays out the competing positions',
    instructions:
      'Present the question as a short debate. Give the strongest case for each position the notes support, label each side, then state which the notes support most and why. If the notes support only one side, say so plainly rather than inventing an opposing view.',
  },
  {
    name: 'Study guide',
    description: 'Q&A and knowledge-check prompts',
    instructions:
      'Turn the notes into a study guide: for each key idea, a short “Q:” question whose answer is in the notes, followed by “A:” with the answer and its citation. End with two or three open questions the reader should be able to answer. Do not add facts the notes do not contain.',
  },
]

/**
 * A meta-prompt the user copies into another LLM (ChatGPT, Claude, …) so it
 * writes a Vault personality that only changes style, not grounding.
 */
export const PERSONALITY_HELPER_PROMPT = `You are helping me write a "personality" for a notes app called Vault. Vault answers only from my own notes and cites them. A personality changes **only style**: tone, length, structure, formatting, audience and vocabulary. It must not tell the assistant to use outside knowledge, browse, guess, skip citations, or answer when the notes don't cover the question. Those rules are enforced by the app and can't be changed.

Ask me up to 5 short questions about how I want answers to sound and look. Then output exactly three fields:
**Name:** (2–4 words)
**Description:** (one sentence)
**Instructions:** (under 150 words, written as direct instructions to the assistant)`

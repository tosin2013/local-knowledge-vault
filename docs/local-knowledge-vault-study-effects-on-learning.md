# Vault: hypothetical effects on learning and retention

Companion to `local-knowledge-vault-study.md` (section 8 there has the same content).

Added 2026-10-07 (ET) after Tosin asked: "What about the hypothetical effects on learning and
retention in this study for basic knowledge exams and more."

Claim labels (Decision Crafters claim discipline):

- **[VERIFIED FACT]**: stated in a published source I opened or checked via search on 2026-10-07
  (link given), or read directly in the Vault repo (file given).
- **[INFERENCE]**: a reasoned step from verified facts to Vault. It has not been measured.
- **[HYPOTHESIS]**: a testable prediction. Nobody has studied Vault's effect on learning; every
  Vault-specific effect below is unmeasured.

**Bottom line up front [HYPOTHESIS]:** Vault's default answer mode will probably help people find
and trust what's in their notes, but it will not by itself improve, and may slightly hurt, closed-book
exam performance a week or a month later, because it replaces the effortful retrieval that drives
retention. The same engine pointed the other way (quiz-first, recall before reveal, spaced review,
with citations used as feedback rather than as the answer) should produce the well-replicated testing
and spacing gains. Vault's grounding in your own notes and its refusals would be a real advantage
there, because they reduce wrong feedback.

## 1. What Vault actually does (the "treatment")

[VERIFIED FACT, repo] Vault answers questions by keyword search (SQLite FTS5 + BM25, no embeddings)
over the user's notes. It sends up to 8 passages (the first ~1,200 characters of each note) to a local
model by default, removes citations to notes it didn't retrieve, labels uncited answers
"⚠ No notes cited", and replies "I couldn't find that in your notes" without calling a model when
search finds nothing (`electron/search.ts`, `electron/generate.ts`). Media chat turns video captions
into transcript notes (`electron/media-ingest.ts`). Saved answers become `ai-draft` notes that rank
below confirmed notes (ADR 0002).

[VERIFIED FACT, repo] There is no built-in quiz, flashcard, or spaced-review feature today. The
closest pieces are:

- an example declarative plugin, `examples/plugins/study-buddy`, with prompts such as
  "Quiz me: ask 3 questions I should be able to answer from these notes";
- a planned "Quiz me" task action in ADR 0002;
- open issues #165 (flash-card generation) and #166 (practice-test results → note improvements).

None of these schedule reviews or grade answers.

## 2. Learning-science mechanisms (verified sources)

| Mechanism | What the research shows | Source (verified) |
|---|---|---|
| Retrieval practice / testing effect | [VERIFIED FACT] Students who took recall tests on prose passages retained substantially more at 2 days and 1 week than students who restudied, even though restudy produced higher scores at 5 minutes and higher confidence. In Exp. 2, 1-week recall was 61% vs 40%. | Roediger & Karpicke (2006), Psychological Science 17(3), 249–255. doi:10.1111/j.1467-9280.2006.01693.x |
| Testing effect (meta-analysis) | [VERIFIED FACT] Testing beats restudy for retention, and recall tests give larger benefits than recognition tests. | Rowland (2014), Psychological Bulletin 140(6), 1432–1463. doi:10.1037/a0037559 |
| Retrieval vs. elaborative study | [VERIFIED FACT] Retrieval practice beat concept mapping on a delayed test (0.67 vs 0.45, Exp. 1), including when the final test itself required concept maps. | Karpicke & Blunt (2011), Science. doi:10.1126/science.1199327 |
| Transfer of testing | [VERIFIED FACT] Across 192 effect sizes (N = 10,382), test-enhanced learning transfers to new questions and contexts at about d = 0.40 vs non-testing re-exposure. | Pan & Rickard (2018), Psychological Bulletin 144(7), 710–756. doi:10.1037/bul0000151 |
| Feedback | [VERIFIED FACT] Feedback after multiple-choice tests improved retention of correct answers and sharply reduced later intrusion of wrong options. Immediate and delayed feedback both worked. | Butler & Roediger (2008), Memory & Cognition 36(3). doi:10.3758/MC.36.3.604 |
| Failed retrieval attempts (pretesting) | [VERIFIED FACT] Unsuccessful retrieval attempts followed by feedback improved later learning. | Kornell, Hays & Bjork (2009), JEP: LMC 35(4), 989–998. APA record |
| Spacing | [VERIFIED FACT] A meta-analysis of 839 assessments found spaced learning beats massed learning. The best gap between sessions grows with the retention interval. | Cepeda et al. (2006), Psychological Bulletin 132(3), 354–380. PubMed 16719566 |
| Spacing "ridgeline" | [VERIFIED FACT] With 1,350+ people, the optimal study gap was about 20–40% of a 1-week test delay and about 5–10% of a 1-year delay. | Cepeda et al. (2008), Psychological Science 19(11), 1095–1102. doi:10.1111/j.1467-9280.2008.02209.x |
| Generation effect | [VERIFIED FACT] Self-generated material is remembered better than material that is only read. A meta-analysis of 86 studies found d = 0.40 overall. | Slamecka & Graf (1978), doi:10.1037/0278-7393.4.6.592. Bertsch et al. (2007), Memory & Cognition, PubMed 17645161 |
| Elaborative interrogation | [VERIFIED FACT] Generating answers to why/how questions improved intentional and incidental learning of facts. | Pressley et al. (1987), JEP: LMC 13(2), 291–300. WashU profile |
| Self-explanation | [VERIFIED FACT] Prompting students to explain a text to themselves improved understanding. | Chi, de Leeuw, Chiu & LaVancher (1994), Cognitive Science 18(3), 439–477. doi:10.1016/0364-0213(94)90016-7 |
| Technique ratings | [VERIFIED FACT] A review of 10 techniques rated practice testing and distributed practice high utility, elaborative interrogation, self-explanation, and interleaving moderate, and rereading, highlighting, and summarization low. | Dunlosky et al. (2013), Psychological Science in the Public Interest. PubMed 26173288 |
| Desirable difficulties | [VERIFIED FACT] Spacing, interleaving, varied practice, and retrieval improve durable learning even though they feel harder than rereading or cramming. | Bjork & Bjork (2011), "Making things hard on yourself, but in a good way." PDF, Bjork Lab |
| Illusions of competence | [VERIFIED FACT] Learners often misjudge which techniques work and rely on fluency, which leads to counterproductive study choices. | Bjork, Dunlosky & Kornell (2013), Annual Review of Psychology 64, 417–444. doi:10.1146/annurev-psych-113011-143823 |
| Feeling of learning ≠ learning | [VERIFIED FACT] Physics students learned more from active instruction but felt they learned more from polished passive lectures. | Deslauriers et al. (2019), PNAS 116(39), 19251–19257. doi:10.1073/pnas.1821936116 |
| Cognitive offloading | [VERIFIED FACT] Review of how people use external tools and actions to reduce internal cognitive demand, and the costs and benefits of doing so. | Risko & Gilbert (2016), Trends in Cognitive Sciences 20(9), 676–688. doi:10.1016/j.tics.2016.07.002 |
| "Google effect" (contested) | [VERIFIED FACT] People who expected future access to information recalled the information less and where to find it more. [VERIFIED FACT] One experiment from this paper failed to replicate in Camerer et al. (2018). That replication had design differences and lower power than planned, so the effect is contested, not disproven. | Sparrow, Liu & Wegner (2011), Science 333(6043), 776–778. doi:10.1126/science.1207745. Replication record: FORRT |
| Saving-enhanced memory (offloading upside) | [VERIFIED FACT] Saving one file before studying the next improved memory for the new file, but only when saving was reliable. | Storm & Stone (2015), Psychological Science. doi:10.1177/0956797614559285 |
| Answer-giving AI vs guarded tutor | [VERIFIED FACT] In a field experiment with nearly 1,000 high-school math students (Turkey), a ChatGPT-like "GPT Base" raised practice scores 48% but cut unassisted exam scores 17% vs control. "GPT Tutor" (teacher-provided hints and solutions, prompts that safeguard learning) raised practice 127%, and its exam harm was "essentially eradicated" but not positive. Students used GPT Base as a "crutch" and did not perceive the harm. | Bastani et al. (2025), PNAS 122(26), e2422633122. doi:10.1073/pnas.2422633122 |
| Structured AI tutor RCT | [VERIFIED FACT] Harvard intro physics, N = 194, crossover design: a carefully scaffolded GPT-4 tutor (step-by-step guidance, expert-written solutions in the prompt, self-paced) produced median learning gains more than double in-class active learning (effect size estimated at 0.73–1.3 SD), with a median of 49 minutes vs 60 minutes on task. The post-test was immediate. Only 4% of items were "remembering"-level, and no delayed retention was measured. The authors warn against using AI "as a crutch". | Kestin et al. (2025), Scientific Reports 15, 17458. doi:10.1038/s41598-025-97652-6 |
| Metacognitive laziness | [VERIFIED FACT] In a randomized lab study (N = 117), ChatGPT support most improved essay scores but did not significantly improve knowledge gain or transfer, and users did less metacognitive evaluation. | Fan et al. (2025), British Journal of Educational Technology. doi:10.1111/bjet.13544 |
| How the LLM is used matters | [VERIFIED FACT, preprint] LLM access had no clear overall effect on learning. Asking for explanations helped, generating solutions hurt understanding, and low-prior-knowledge students were harmed most. Peer-review status not verified. | Lehmann, Cornelius & Sting (2024/2025), arXiv:2409.09047. arXiv |
| Knowledge workers | [VERIFIED FACT, self-report survey] Among 319 knowledge workers, higher confidence in GenAI was associated with less self-reported critical thinking, while higher self-confidence was associated with more. | Lee et al. (2025), CHI '25. doi:10.1145/3706598.3713778 |
| EEG "cognitive debt" | [VERIFIED FACT that it exists; findings not peer-reviewed and publicly criticized] 54 participants writing essays with ChatGPT vs search vs no tool reported lower recall of their own essays with ChatGPT. Treat as weak evidence. | Kosmyna et al. (2025), arXiv:2506.08872. arXiv. Critique: arXiv:2601.00856 |

Two cautions about generalizing [INFERENCE]:

- Bastani et al. studied math problem solving with GPT-4. Vault does fact and concept Q&A over the
  learner's own notes with a (usually smaller) local model. The direction of the effect (answer-giving
  replaces practice) plausibly carries over. The size does not.
- Kestin et al. show a structured tutor works for immediate understanding. Vault's answer mode is not
  a tutor: it doesn't sequence, prompt attempts, or withhold answers.

## 3. How each Vault feature might push learning

| Vault feature (evidence) | Pushes toward learning gains | Pushes toward learning losses |
|---|---|---|
| Answers over your own notes (`generate.ts`) | [INFERENCE] If the notes were written by the learner, the note-making step carries a generation benefit (Slamecka & Graf; Bertsch). Answers re-expose that content in context. | [INFERENCE] Reading an answer is re-exposure (restudy), which Roediger & Karpicke and Dunlosky rate below retrieval for delayed retention. [HYPOTHESIS] Fluent synthesized answers inflate feelings of knowing (Bjork et al. 2013; Deslauriers et al. 2019). |
| Answer-first by default (Ask is the home screen, README) | [HYPOTHESIS] Faster lookups can free time for practice, if that time is reinvested. | [INFERENCE] This is the "GPT Base" pattern: the answer comes without an attempt. Bastani et al.'s crutch effect is the closest evidence of harm. |
| Citations to source notes (`[itm_…]` badges, NotePeek) | [INFERENCE] When used after an attempt, a citation is accurate feedback tied to the source (Butler & Roediger), and it supports source monitoring. | [HYPOTHESIS] Citations may increase trust in the answer and reduce checking (consistent with Lee et al.'s confidence finding). They also teach "where it is" rather than "what it is", the Sparrow-style pattern, which is contested. |
| "I couldn't find that in your notes" refusal | [INFERENCE] It's an honest gap signal, a metacognitive cue to fill gaps. It avoids teaching hallucinated "facts", and Butler & Roediger show wrong information intrudes later if uncorrected. | [INFERENCE] With keyword-only search, false refusals happen when the learner uses different words. A learner may wrongly conclude "I never learned this." |
| Keyword-only BM25 retrieval (`search.ts`) | [HYPOTHESIS] Having to recall the right term to get a hit is a small desirable difficulty: the cue has to be generated. | [INFERENCE] Paraphrased or conceptual questions miss relevant notes, which biases the tool toward verbatim, surface vocabulary. That fits recognition exams better than transfer. |
| 1,200-char truncation per note (`buildGroundedMessages`) | [HYPOTHESIS] Incomplete answers may push learners to open the cited note and reread it. | [INFERENCE] Long notes get partial answers that look complete. That risks an illusion of completeness on topics with many details (bad for licensing-exam breadth). |
| Local model by default (README, `llm.ts`) | [INFERENCE] Privacy makes it more likely people put real study material in it, so it gets more use. | [VERIFIED FACT, repo] The README warns that small models follow citation rules less reliably. [INFERENCE] Explanations will likely be weaker than the GPT-4 tutor in Kestin et al. |
| Media chat over transcripts | [INFERENCE] Asking questions of a lecture is more active than rewatching it. | [INFERENCE] Transcripts are Sources, not the learner's own generated notes, so there's no generation benefit. ADR 0002's "Quiz me" task action isn't built yet. |
| Save answer → `ai-draft` until confirmed (ADR 0002) | [HYPOTHESIS] If confirming requires rewriting in one's own words, it becomes a generation and self-explanation step. | [HYPOTHESIS] One-click confirm turns AI text into "my note" without any processing, so ownership stays nominal. |

## 4. Predicted effects by use case

### (a) Basic knowledge exams

(Recall and recognition: certifications such as cloud or Kubernetes associate exams, school tests,
licensing.)

- Likely positive [HYPOTHESIS]: quick, trustworthy lookups while making study notes, fewer
  hallucinated "facts" than an ungrounded chatbot (grounding plus refusal), and refusals that expose
  coverage gaps in the study notes.
- Likely negative [HYPOTHESIS]: in answer mode, delayed closed-book recall at 1 and 4 weeks ≤ plain
  self-testing, and possibly ≤ plain rereading control if the tool displaces effortful recall.
  Overconfidence (higher judgments of learning than actual scores).
- Basis [INFERENCE]: Roediger & Karpicke (restudy wins at 5 minutes, loses at 1 week, and inflates
  confidence), Rowland (the recall-test benefit is larger), Bastani (answer access → −17% unassisted),
  Dunlosky (testing and spacing rated high, rereading low).
- Net prediction [HYPOTHESIS]: answer mode ≈ 0 to small negative vs control. A quiz/spaced mode would
  give a small-to-moderate positive effect, roughly the testing-effect range (order of d ≈ 0.4, by
  analogy to Pan & Rickard's and Bertsch's d = 0.40, not measured for Vault).

### (b) Applied, conceptual exams and transfer

- Positive [HYPOTHESIS]: using Vault to ask why/how questions over one's notes could support
  elaborative interrogation and self-explanation, but only if the learner answers first.
- Negative [INFERENCE]: keyword retrieval and truncation favor verbatim facts over concepts. The
  grounding rules constrain the model to the passages, so it won't bridge concepts that aren't in the
  notes. That's good for honesty and limiting for building concepts.
- Net [HYPOTHESIS]: answer mode ≈ 0. Quiz mode with mixed application questions gives a smaller
  positive effect than for recall, since the evidence base for transfer (Pan & Rickard) is real but
  more conditional. Lehmann et al. (preprint) suggest low-prior-knowledge learners are most at risk
  from solution-giving.

### (c) Professional and working knowledge

(Consultants, platform and architecture leads.)

The goal is different: correct, traceable recall at the point of need, not unaided memory.

- Positive [INFERENCE]: Vault is a reliable external memory, and reliability matters, since Storm &
  Stone found that offloading frees capacity only when saving is reliable. Citations support defensible
  client claims. Citation packs make reasoning auditable.
- Negative [HYPOTHESIS]: over months, people may keep the index ("Vault has it") but lose the fluent
  mental model needed in live meetings, whiteboard sessions, or interviews. Lee et al.'s self-reports
  point toward reduced effort when trusting AI.
- Net [HYPOTHESIS]: positive for decision quality and speed. Neutral to negative for unaided expertise
  unless some deliberate retrieval (weekly review quizzes) is built in.

### (d) Long-term retention over weeks and months

- [INFERENCE] This is where the mechanisms diverge most. Every testing-effect and spacing finding above
  gets stronger with delay. Restudy-like exposure (reading answers) fades fastest.
- [HYPOTHESIS] Without scheduling, Vault use happens when the need arises, which is massed and
  irregular, so it won't produce spacing benefits. With a scheduler (spacing guided by Cepeda 2008),
  Vault's own-note grounding becomes an advantage, because review items are drawn from what the learner
  actually studied, with citations as feedback.
- Predicted ordering at 30 days [HYPOTHESIS]: Vault quiz + spacing > plain self-quizzing on notes >
  plain notes rereading ≥ Vault answer mode.

## 5. Feature ideas that would tilt Vault toward learning gains

| Idea | Mechanism (source) | Implementation sketch in Vault | Label |
|---|---|---|---|
| Quiz / flashcard mode from notes | Testing effect (Roediger & Karpicke 2006; Rowland 2014). Recall > recognition. | Build on #165. Generate short-answer questions per note, and store each question with the source `itm_` id so the answer key is grounded. Prefer free-recall prompts over multiple choice. | Mechanism VERIFIED. Effect in Vault is a HYPOTHESIS |
| Answer-first, then reveal (a "Study mode" toggle on Ask) | Retrieval practice; failed attempts + feedback (Kornell et al. 2009); generation effect | In Study mode, Ask first asks "What do you think?" and records the learner's attempt. Only then does it show the grounded answer and highlight differences. | HYPOTHESIS |
| Try to recall before showing the citation | Feedback timing (Butler & Roediger 2008); source monitoring | Hide the `itm_` badges until the learner types a guess or clicks "I don't know". Then reveal the note as feedback. | HYPOTHESIS |
| Spaced review scheduling | Spacing (Cepeda 2006, 2008); Dunlosky's "high utility" rating | Add a review table (item, due date, ease) with an expanding schedule. The gap is set relative to the target exam date (about 20–40% for a 1-week horizon, shrinking as a fraction for longer ones). | Mechanism VERIFIED. Parameters are an INFERENCE |
| Self-explanation and why-prompts | Self-explanation (Chi 1994); elaborative interrogation (Pressley 1987) | After a correct answer, ask "Explain why, in one sentence, using your notes". The model checks the explanation against the cited passages. | HYPOTHESIS |
| Confidence rating before reveal | Calibration; illusions of competence (Bjork et al. 2013) | 0–100 confidence slider on each attempt, plus a dashboard of confidence vs accuracy. | HYPOTHESIS |
| Rewrite-to-confirm for `ai-draft` notes | Generation effect | Make "Confirm" require an edit, or a one-line summary in the learner's own words. | HYPOTHESIS |
| Interleaved review across projects | Interleaving (Dunlosky: moderate; Bjork & Bjork) | Mix review items across projects instead of finishing one project at a time. | HYPOTHESIS |
| Test-to-notes loop | Feedback + generation | Build #166: wrong answers become note-revision tasks, with citations. | HYPOTHESIS |
| Fix retrieval for learning (chunking, optional semantic search) | Reduces false refusals and partial answers that create illusions of completeness | Chunk long notes. Use hybrid BM25 + local embeddings (study §7, recommendation 3). | INFERENCE |

[INFERENCE] These fit Vault's architecture: quiz items can reuse the grounding contract
(`validateCitations`), so the answer key can't cite notes that don't exist, which is a real advantage
over generic AI flashcard tools. The repo already has the start of this in the plugin system (prompt
packs, the study-buddy example) and in open issues #165 and #166.

## 6. A small study to test it

**Question.** Does Vault's interaction mode change closed-book exam performance and calibration at
1 week and 30 days, compared with plain notes?

**Design (recommended):** within-subjects, 3 conditions, Latin-square counterbalanced. Each
participant learns 3 comparable modules, one per condition, so person-level differences cancel out.

| Condition | What participants do (equal study time, e.g., 40 min per module) |
|---|---|
| C0: Plain notes (control) | Read and search the provided notes in Vault with AI off (keyword search only). Self-testing is allowed but not prompted. |
| C1: Vault answer mode | Default Ask: ask anything, get grounded cited answers, click citations. |
| C2: Vault quiz mode | Prototype Study mode: Vault asks questions from the notes, the learner answers and rates confidence, then sees the cited answer and gives a one-line self-explanation. A light version could use the study-buddy prompt pack plus a hide-citations-until-attempt toggle. A 1-day spaced follow-up session (10 min) is included. To keep time equal, C0 and C1 get an equivalent 10-minute free-use session. |

**Participants.** Adults preparing for a real basic-knowledge exam would give the most realistic
results, e.g., early-career platform engineers studying for a cloud or Kubernetes associate
certification. Alternatively, students recruited through a university pool. Exclude anyone who scores
above 60% on the pretest for a module.

**Materials.** Three modules of about 3,000 words of provided notes, written in the same style to
control note quality. Each module has about 40 test items. A secondary arm could use participant-made
notes to capture the generation effect, at a cost of more variance.

**Model.** The same local model for all AI conditions (e.g., qwen3:8b, Vault's recommended default),
so tool quality is constant.

**Measures:**

- Exam score, closed-book with no tools: pretest, immediate (end of session), 7 days, and 30 days.
  Parallel forms, counterbalanced. Each form has:
  - 20 short-answer recall items (the primary "basic exam" outcome);
  - 10 multiple-choice recognition items;
  - 10 application and transfer items.
- Confidence calibration: 0–100 confidence per item, scored as a Brier score and as bias (mean
  confidence − accuracy). Also an end-of-session judgment of learning ("what % will you get in a
  week?").
- Time on task and process logs: queries, refusals hit, citation clicks, quiz attempts, edits. All of
  it can be read locally from Vault's SQLite (`chat_messages`, `items`). Logs stay on the
  participant's machine and are exported with consent.
- Perceived learning and effort: short Likert scales, since Deslauriers et al. show feeling of
  learning and actual learning can diverge.

**Sample size rationale [INFERENCE].** Anchor on the verified d ≈ 0.40 for transfer of test-enhanced
learning (Pan & Rickard 2018) and for the generation effect (Bertsch 2007).

- Within-subjects: detecting a paired effect of d_z = 0.4 with 80% power at α = .05/3 (Bonferroni
  across the 3 pairwise contrasts) needs about 69 completers. Use 72 (a multiple of 6, for full order
  counterbalancing) and recruit about 90 to absorb roughly 20% attrition by day 30.
- Between-subjects fallback (if carryover is a worry): about 131 per arm for d = 0.4 (about 84 per arm
  for d = 0.5) at the same α, so roughly 400–500 recruited across 3 arms.
- A pilot of 12–18 people first, to check that modules are equally hard and the protocol is feasible.

**Pre-register** the hypotheses and analysis: a mixed-effects model with condition × delay, random
intercepts for participant and item.

**Hypotheses and what would support or refute them:**

| # | Hypothesis | Supported if | Refuted if |
|---|---|---|---|
| H1 | Quiz mode > control > answer mode on delayed recall (7 and 30 days) | C2 − C0 > 0 and significant at 7 and 30 days. C1 ≤ C0 (non-inferiority bound not met). | C2 ≤ C0 at 30 days, or C1 > C0 significantly |
| H2 | Delay crossover: answer mode does relatively better immediately than later (as restudy did in Roediger & Karpicke) | Condition × delay interaction: C1's gap to C2 is smallest (or reversed) immediately and widens by 30 days | No interaction (C1's deficit is constant or absent) |
| H3 | Calibration: answer mode shows the most overconfidence | C1 bias > C0 and C2. C2 has the best Brier score. | C1 bias ≤ others |
| H4 | Transfer: quiz mode helps application items less than recall, but still > answer mode | C2 > C1 on transfer items with a smaller effect than on recall | C2 ≈ C1 on transfer |
| H5 | Efficiency: answer mode is fastest per item covered | C1 time-on-task per module < C2 | C1 ≥ C2 |
| H6 | Refusals as gap signals (exploratory) | Items whose topic triggered a refusal and led to a note edit are retained better than refusals without an edit | No difference. Or false refusals (relevant note existed) predict worse retention. |
| H7 | Prior knowledge moderates (from Lehmann et al., preprint) | C1's deficit is larger for low-pretest participants | No moderation |

**What this design cannot show:**

- Long-run habit effects over many months.
- Effects with participants' own messy notes.
- Effects with frontier cloud models.

Treat it as a first, cheap, falsifiable test.

## 7. Decision Crafters article angle

Yes. This is a strong and timely angle [INFERENCE]. It joins three things readers care about:
grounded or "trustworthy" AI, the PNAS finding that AI can harm learning, and practical tool design.

- **Working title:** "Grounded isn't the same as learned: what a cite-or-refuse AI does to your
  memory, and how to design it so it helps."
- **Audience:** platform, architecture, and AI leads who run enablement, onboarding, and certification
  programs, or who are rolling out "chat with our docs" tools internally.
- **Structure:**
  1. The verified evidence (testing and spacing; Bastani vs Kestin as the "answer-giver vs tutor"
     contrast).
  2. Vault as a concrete case: the features that push each way, with code references.
  3. The design patterns (answer-first-then-reveal, citations as feedback, spaced review).
  4. The pre-registered pilot, with an honest "hypothesis" label until data exists.
- **Claim discipline:** keep the VERIFIED / INFERENCE / HYPOTHESIS labels in the published piece. Say
  plainly that no Vault learning data exists yet, that Sparrow 2011 is contested, and that Kosmyna
  2025 and Lehmann et al. are preprints.
- **Strongest version:** ship a minimal Study mode (answer-first + hidden citations + confidence
  rating) behind a flag. Run the 12–18 person pilot. Publish "applied proof, round 1" with real
  numbers, even if they're null.

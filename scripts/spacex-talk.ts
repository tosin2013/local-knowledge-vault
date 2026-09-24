import { initDb, createItem, closeDb, createSession } from '../electron/db'
import { setLlmUserDataDir } from '../electron/llm-settings'
import { askGrounded } from '../electron/generate'
import { sendChatTurn } from '../electron/chat'

const dbPath = '/home/box/.config/local-knowledge-vault/lkv.sqlite'
setLlmUserDataDir('/home/box/.config/local-knowledge-vault')
initDb(dbPath)

const notes = [
  {
    title: 'SpaceX overview',
    para: 'resources' as const,
    kind: 'note',
    status: 'active',
    project: 'SpaceX study',
    summary: 'Private notes on SpaceX as a company and mission stack.',
    body: `SpaceX (Space Exploration Technologies Corp.) is a private American aerospace company founded by Elon Musk in 2002.
Primary goals in these notes: reduce cost of access to space, and enable multi-planetary life starting with Mars.
Major products: Falcon 9 (partially reusable two-stage orbital rocket), Falcon Heavy (three-core heavy lift), Starship (fully reusable next-gen stack with Super Heavy booster), and Dragon (crew/cargo capsule for ISS).
Headquarters historically associated with Hawthorne, California; major launch sites include Cape Canaveral / Kennedy Space Center (Florida) and Starbase near Boca Chica, Texas.
These are personal study notes for the Local Knowledge Vault demo — not an official SpaceX document.`,
  },
  {
    title: 'Falcon 9 — reuse and landings',
    para: 'resources' as const,
    kind: 'note',
    status: 'active',
    project: 'SpaceX study',
    summary: 'How Falcon 9 first-stage recovery works in plain language.',
    body: `Falcon 9 first stage is designed to return and land after boosting the second stage.
Recovery modes in these notes:
1) Landing zone (LZ) — boost-back and land near the launch site when payload/energy allows.
2) Drone ship — land on an autonomous spaceport drone ship downrange when more performance is needed.
Grid fins and cold-gas / engine control steer the stage during reentry. Landing legs deploy for touchdown.
Reuse matters because reflying the booster cuts marginal launch cost versus building a new first stage each time.
Crew Dragon and Cargo Dragon both fly on Falcon 9. Block 5 is the workhorse configuration referenced in most recent mission notes.`,
  },
  {
    title: 'Starship / Super Heavy — Starbase notes',
    para: 'projects' as const,
    kind: 'note',
    status: 'active',
    project: 'SpaceX study',
    summary: 'Starship stack goals and Starbase test focus.',
    body: `Starship is the upper stage / spacecraft; Super Heavy is the booster. Together they aim for full reusability and very high payload to orbit.
Raptor engines burn liquid methane (CH4) and liquid oxygen (LOX). Methane choice supports (in company narrative) eventual propellant production on Mars.
Starbase (Boca Chica, Texas) is the primary development and flight-test site for Starship prototypes in these notes.
Flight tests have iterated on ascent, hot-staging concepts, booster catch / tower catch ambitions, and heat-shield durability for reentry.
Intended future roles in these notes: Starlink deployment at scale, lunar cargo/crew under NASA HLS concepts, and Mars transport architecture — all still evolving.`,
  },
  {
    title: 'Starlink — constellation snapshot',
    para: 'areas' as const,
    kind: 'note',
    status: 'active',
    project: 'SpaceX study',
    summary: 'What Starlink is for and how it ties to Falcon/Starship.',
    body: `Starlink is SpaceX's low-Earth-orbit broadband satellite constellation.
Purpose in these notes: provide internet service globally, including remote and mobile users; also a major revenue engine funding R&D.
Satellites are launched in batches, historically on Falcon 9; Starship is expected to raise deployment cadence and mass to orbit.
User terminals ("dishes") talk to overhead satellites; satellites hand off and route traffic through the constellation and ground gateways (and increasingly laser interlinks).
Operational caveats called out in study notes: astronomy brightness concerns, debris/mitigation practices, and regulatory approvals vary by country.`,
  },
]

async function main() {
  const created: Array<{ id: string; title: string }> = []
  for (const n of notes) {
    const item = createItem(n)
    created.push({ id: item.id, title: item.title })
  }
  console.log('injected', created.length)
  for (const c of created) console.log('-', c.id, c.title)

  const ask = await askGrounded({
    question: 'What is SpaceX building, and how do Falcon 9 and Starship differ? Cite the notes.',
    limit: 8,
  })
  console.log('---ASK---')
  console.log('offline', !!ask.offline, 'error', ask.error || '')
  console.log('answer:')
  console.log(ask.answer)
  console.log(
    'citations:',
    (ask.citations || []).map((c) => c.id + ':' + c.title).join(' | ')
  )

  const session = createSession({ mode: 'grounded', title: 'SpaceX chat' })
  const chat = await sendChatTurn({
    sessionId: session.id,
    text: 'Where does SpaceX test Starship, and what propellant do Raptors use?',
  })
  console.log('---CHAT---')
  console.log('offline', !!chat.offline, 'error', chat.error || '')
  console.log('assistant:')
  console.log(chat.assistant.content)
  console.log('session', session.id)
  closeDb()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

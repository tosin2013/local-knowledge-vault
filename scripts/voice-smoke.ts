/**
 * Offline smoke for voice study (#413): settings, provider resolution, and the
 * OpenAI-compatible audio routes against a local mock server (no real Ollama).
 *
 *   npm run test:voice
 */
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import type { AddressInfo } from 'net'

process.env.LKV_USER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-voice-'))

import { resetProviderStoreCache, upsertProvider } from '../electron/provider-store'
import { VOICE_CONVERSATION_STYLE, composeChatStyle } from '../electron/chat'
import {
  DEFAULT_VOICE_SETTINGS,
  MAX_AUDIO_BYTES,
  getVoiceSettings,
  hasModel,
  isNonCommercialSpeechModel,
  joinWavs,
  ollamaVoices,
  parseWav,
  pullSpeechModel,
  resolveAudioTarget,
  sanitizeVoiceSettings,
  setVoiceSettings,
  speak,
  splitForSpeech,
  transcribe,
  voiceProviderOptions,
  voiceStatus,
} from '../electron/voice'
import type { ProviderConfig, VoicePullProgress, VoiceSettings } from '../electron/types'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    console.error(`  ✗ ${msg}`)
  }
}

/** A WAV with the given 16-bit samples; `streamed` sets the size fields to 0xFFFFFFFF like Ollama does. */
function wav(samples: number[], streamed = false): Uint8Array {
  const data = new Uint8Array(samples.length * 2)
  const dv = new DataView(data.buffer)
  samples.forEach((s, i) => dv.setInt16(i * 2, s, true))
  const out = new Uint8Array(44 + data.length)
  const v = new DataView(out.buffer)
  const w = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i)
  }
  w(0, 'RIFF')
  v.setUint32(4, streamed ? 0xffffffff : 36 + data.length, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, 24000, true)
  v.setUint32(28, 48000, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, streamed ? 0xffffffff : data.length, true)
  out.set(data, 44)
  return out
}

interface Seen {
  method: string
  url: string
  auth?: string
  body: Buffer
  type?: string
}

async function mockServer(handler: (req: Seen, res: http.ServerResponse) => void): Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const s: Seen = {
        method: req.method ?? '',
        url: req.url ?? '',
        auth: req.headers.authorization,
        body: Buffer.concat(chunks),
        type: req.headers['content-type'],
      }
      seen.push(s)
      handler(s, res)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise((r) => server.close(() => r())) }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — voice smoke ===\n')

  console.log('Pure helpers')
  assert(isNonCommercialSpeechModel('phonon-40m') && isNonCommercialSpeechModel('phonon:40M') && isNonCommercialSpeechModel('phonon_40m-en'), 'flags the CC BY-NC 40M checkpoints')
  assert(!isNonCommercialSpeechModel('phonon') && !isNonCommercialSpeechModel('phonon:latest') && !isNonCommercialSpeechModel('x140mm'), 'allows the Apache-2.0 phonon')
  assert(hasModel(['phonon:latest'], 'phonon') && hasModel(['lfm3-audio:2b'], 'lfm3-audio') && hasModel(['lfm3-audio:2b'], 'lfm3-audio:2b'), 'matches installed tags')
  assert(!hasModel(['phonon-40m:latest'], 'phonon') && !hasModel(['lfm3-audio:2b'], 'lfm3-audio:1b'), 'does not match other models')
  const s = sanitizeVoiceSettings({ ttsModel: 'phonon-40m', sttModel: 'has space', output: 'nope' as never, voice: '  Zoey ', enabled: true, providerId: '  ' })
  assert(s.ttsModel === 'phonon' && s.sttModel === 'lfm3-audio' && s.output === 'provider' && s.voice === 'Zoey' && s.enabled && s.providerId === 'ollama', 'sanitizes settings')
  assert(JSON.stringify(sanitizeVoiceSettings(null)) === JSON.stringify(DEFAULT_VOICE_SETTINGS), 'null settings → defaults')
  assert(sanitizeVoiceSettings({ output: 'system', spokenReplies: false }).output === 'system', 'keeps the system output engine')

  const long = `${'One two three. '.repeat(400)}`
  const parts = splitForSpeech(long, 4000)
  assert(parts.length > 1 && parts.every((p) => p.length <= 4000), 'splits long text under the per-request limit')
  assert(splitForSpeech('a'.repeat(9) + ' ' + 'b'.repeat(9), 10).join('|') === 'a'.repeat(9) + '|' + 'b'.repeat(9), 'splits an over-long sentence at a word break')
  assert(splitForSpeech('x'.repeat(25), 10).length === 3, 'hard-splits a word longer than the limit')
  assert(splitForSpeech('Hi there.\n\nNext part.').join('|') === 'Hi there. Next part.', 'keeps short text in one request')
  assert(splitForSpeech('   ').length === 0, 'empty text → nothing to say')

  const a = wav([1, 2, 3])
  const b = wav([4, 5], true)
  assert(parseWav(a)?.data.byteLength === 6, 'parses a WAV data chunk')
  assert(parseWav(b)?.data.byteLength === 4, 'parses a streamed WAV with max size fields')
  assert(parseWav(new Uint8Array(4)) === null && parseWav(new TextEncoder().encode('RIFF0000WAVEdata0000')) === null, 'rejects non-WAV / data before fmt')
  const withList = new Uint8Array([...a.slice(0, 12), ...new TextEncoder().encode('LIST'), 3, 0, 0, 0, 1, 2, 3, 0, ...a.slice(12)])
  assert(parseWav(withList)?.data.byteLength === 6, 'skips unknown (odd-sized) chunks')
  const joined = joinWavs([a, b])!
  const jv = new DataView(joined.buffer)
  assert(jv.getUint32(40, true) === 10 && jv.getUint32(4, true) === 46 && jv.getInt16(44 + 6, true) === 4, 'joins WAVs with correct sizes')
  assert(joinWavs([]) === null && joinWavs([new Uint8Array(3)]) === null, 'join refuses empty / bad input')

  console.log('\nSpoken chat style')
  assert(composeChatStyle('Be warm.', false) === 'Be warm.' && composeChatStyle(undefined, false) === undefined, 'typed turns keep the chosen style')
  assert(composeChatStyle(undefined, true) === VOICE_CONVERSATION_STYLE, 'spoken turns get the voice style')
  assert(composeChatStyle('Be warm.', true)!.startsWith('Be warm.') && composeChatStyle('Be warm.', true)!.includes('No markdown'), 'the voice style is added after a personality')

  console.log('\nSettings file')
  assert(getVoiceSettings().enabled === false, 'voice is off by default')
  const saved = setVoiceSettings({ enabled: true, voice: 'Freya' })
  assert(saved.enabled && saved.voice === 'Freya' && getVoiceSettings().voice === 'Freya', 'persists a patch')
  assert(setVoiceSettings({ spokenReplies: false }).voice === 'Freya', 'a patch keeps the other fields')

  console.log('\nProvider resolution')
  const cfg = (over: Partial<ProviderConfig>): ProviderConfig => ({
    id: 'x',
    kind: 'openai-compatible',
    label: 'X',
    baseUrl: 'http://h/v1/',
    model: '',
    hasKey: false,
    requiresKey: false,
    local: true,
    enabled: true,
    source: 'custom' as ProviderConfig['source'],
    ...over,
  })
  const t1 = resolveAudioTarget('x', () => cfg({}), () => 'sk')
  assert(t1?.apiBase === 'http://h/v1' && t1.apiKey === 'sk' && !t1.ollama, 'OpenAI-compatible base keeps /v1')
  const t2 = resolveAudioTarget('o', () => cfg({ kind: 'ollama', baseUrl: 'http://o:11434' }), () => null)
  assert(t2?.apiBase === 'http://o:11434/v1' && t2.ollama, 'Ollama gets /v1 added')
  assert(resolveAudioTarget('x', () => cfg({ baseUrl: 'http://h' }), () => null)?.apiBase === 'http://h/v1', 'a bare base gets /v1')
  assert(resolveAudioTarget('a', () => cfg({ kind: 'anthropic' }), () => null) === null && resolveAudioTarget('none', () => undefined) === null, 'Anthropic / unknown → no audio target')
  assert(voiceProviderOptions([cfg({}), cfg({ id: 'c', kind: 'anthropic' })]).map((p) => p.id).join() === 'x', 'lists only providers with audio routes')

  console.log('\nOllama audio routes (mock)')
  let pullMode: 'ok' | 'error' | 'cut' = 'ok'
  let voicesBody: unknown = { voices: ['Zoey', { name: 'Easton' }, 'Zoey', 7] }
  const mock = await mockServer((req, res) => {
    if (req.url === '/api/tags') return json(res, 200, { models: [{ name: 'lfm3-audio:latest' }, { name: 'phonon:latest' }, { model: 'qwen3:8b' }] })
    if (req.url === '/api/show') return voicesBody === 500 ? json(res, 500, {}) : json(res, 200, voicesBody)
    if (req.url === '/v1/audio/transcriptions') {
      const body = req.body.toString('latin1')
      if (!body.includes('lfm3-audio')) return json(res, 404, { error: 'model "x" not found' })
      if (body.includes('response_format') && body.includes('RIFF')) return json(res, 200, { text: '  mitochondria make ATP ' })
      return json(res, 400, { error: 'bad form' })
    }
    if (req.url === '/v1/audio/speech') {
      const body = JSON.parse(req.body.toString('utf8')) as { model: string; input: string; voice?: string }
      if (body.voice === 'Nobody') return json(res, 400, { error: 'unknown voice; available: Zoey, Easton' })
      if (body.input === 'not wav') {
        res.writeHead(200, { 'Content-Type': 'audio/wav' })
        return res.end('nope')
      }
      res.writeHead(200, { 'Content-Type': 'audio/wav' })
      return res.end(Buffer.from(wav([7, 8], true)))
    }
    if (req.url === '/api/pull') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      if (pullMode === 'error') return res.end('{"status":"pulling manifest"}\n{"error":"pull model manifest: file does not exist"}\n')
      if (pullMode === 'cut') return res.end('{"status":"pulling manifest"}\nnot json\n')
      res.write('{"status":"pulling manifest"}\n{"status":"downloading","completed":5,')
      setTimeout(() => res.end('"total":10}\n{"status":"verifying"}\n{"status":"success"}\n'), 20)
      return
    }
    json(res, 404, {})
  })
  process.env.LKV_OLLAMA_URL = mock.url
  resetProviderStoreCache()
  const settings: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS, enabled: true }

  const st = await voiceStatus(settings, { isSnap: true })
  assert(st.reachable && st.canTranscribe && st.canSpeak && st.ollama && st.local && st.snap, 'status: Ollama with both models')
  assert(st.voices.join() === 'Zoey,Easton', 'status lists unique voice names from /api/show')
  assert(!st.sttHint && !st.ttsHint, 'no hints when both models are installed')
  assert(st.providers.some((p) => p.id === 'ollama'), 'status lists voice providers')
  const missing = await voiceStatus({ ...settings, sttModel: 'other-stt', ttsModel: 'other-tts' }, { isSnap: false })
  assert(!missing.canTranscribe && /ollama pull other-stt/.test(missing.sttHint ?? '') && /built-in voices/.test(missing.ttsHint ?? ''), 'status explains how to pull missing models')
  voicesBody = 500
  assert((await ollamaVoices(resolveAudioTarget('ollama')!, 'phonon')).length === 0, 'voices: HTTP error → none')
  voicesBody = { voices: 'nope' }
  assert((await ollamaVoices(resolveAudioTarget('ollama')!, 'phonon')).length === 0, 'voices: odd shape → none')

  const audio = wav([1, 2, 3])
  const tr = await transcribe(audio, settings)
  assert(tr.ok && tr.text === 'mitochondria make ATP', 'transcribes WAV via /v1/audio/transcriptions')
  const trReq = mock.seen.find((x) => x.url === '/v1/audio/transcriptions')!
  assert(/multipart\/form-data/.test(trReq.type ?? '') && !trReq.auth, 'sends multipart with no key for local Ollama')
  const tr404 = await transcribe(audio, { ...settings, sttModel: 'missing-stt' })
  assert(!tr404.ok && /ollama pull missing-stt/.test(tr404.error), 'a missing model says how to pull it')
  assert(!(await transcribe(new Uint8Array(0), settings)).ok, 'empty audio is refused')
  assert(!(await transcribe(new Uint8Array(MAX_AUDIO_BYTES + 1), settings)).ok, 'oversized audio is refused')
  assert(!(await transcribe(audio.buffer as ArrayBuffer, { ...settings, providerId: 'nope' })).ok, 'unknown provider is refused')

  const sp = await speak('Hello there. [itm_1]', { ...settings, voice: 'Zoey' })
  assert(sp.ok && sp.audio.byteLength === 48 && new DataView(sp.audio.buffer).getUint32(40, true) === 4, 'speaks via /v1/audio/speech and fixes WAV sizes')
  const spReq = JSON.parse(mock.seen.filter((x) => x.url === '/v1/audio/speech').at(-1)!.body.toString()) as Record<string, string>
  assert(spReq.model === 'phonon' && spReq.voice === 'Zoey' && spReq.response_format === 'wav', 'sends model, voice and wav format')
  const spDefault = await speak('Hi', settings)
  const spReq2 = JSON.parse(mock.seen.filter((x) => x.url === '/v1/audio/speech').at(-1)!.body.toString()) as Record<string, string>
  assert(spDefault.ok && !('voice' in spReq2), 'an empty voice uses the model default')
  const bad = await speak('Hi', { ...settings, voice: 'Nobody' })
  assert(!bad.ok && /unknown voice/.test(bad.error), 'an unknown voice reports the provider error')
  assert(!(await speak('not wav', settings)).ok, 'non-WAV audio is refused')
  assert(!(await speak('  ', settings)).ok, 'nothing to say')
  assert(!(await speak('Hi', { ...settings, ttsModel: 'phonon-40m' })).ok, 'refuses the non-commercial 40M model')
  assert(!(await speak('Hi', { ...settings, providerId: 'nope' })).ok, 'speak: unknown provider is refused')

  console.log('\nModel download (mock)')
  const events: VoicePullProgress[] = []
  const done = await pullSpeechModel('lfm3-audio', (p) => events.push(p), settings)
  assert(done.done === true && done.status === 'success', 'pull finishes on success')
  assert(events.some((e) => e.completed === 5 && e.total === 10), 'pull reports byte progress across chunk boundaries')
  pullMode = 'error'
  const perr = await pullSpeechModel('phonon', () => undefined, settings)
  assert(perr.status === 'error' && /does not exist/.test(perr.error ?? ''), 'pull reports a stream error')
  pullMode = 'cut'
  assert((await pullSpeechModel('phonon', () => undefined, settings)).status === 'error', 'pull that ends early is an error')
  assert(/Only the speech models/.test((await pullSpeechModel('qwen3:8b', () => undefined, settings)).error ?? ''), 'pull refuses other models')
  assert(/non-commercial/.test((await pullSpeechModel('phonon-40m', () => undefined, { ...settings, sttModel: 'phonon-40m' })).error ?? ''), 'pull refuses 40M models')

  console.log('\nOther OpenAI-compatible providers (mock)')
  const oa = await mockServer((req, res) => {
    if (req.url === '/v1/models') return req.auth === 'Bearer sk-voice' ? json(res, 200, { data: [] }) : json(res, 401, {})
    if (req.url === '/v1/audio/transcriptions') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      return res.end('plain transcript\n')
    }
    json(res, 404, {})
  })
  const gw = upsertProvider({ kind: 'openai-compatible', label: 'Audio gateway', baseUrl: `${oa.url}/v1`, model: 'm', local: true, apiKey: 'sk-voice' })
  const gwSettings = { ...settings, providerId: gw.id, sttModel: 'whisper-1', ttsModel: 'tts-1' }
  const gst = await voiceStatus(gwSettings, { isSnap: false })
  assert(gst.reachable && gst.canTranscribe && !gst.ollama && gst.voices.length === 0, 'status: reachable gateway')
  const gtr = await transcribe(wav([1]), gwSettings)
  assert(gtr.ok && gtr.text === 'plain transcript' && oa.seen.at(-1)?.auth === 'Bearer sk-voice', 'plain-text transcription with the provider key')
  assert(/Ollama only/.test((await pullSpeechModel('whisper-1', () => undefined, gwSettings)).error ?? ''), 'pull is Ollama-only')
  const gw401 = upsertProvider({ id: gw.id, kind: 'openai-compatible', label: 'Audio gateway', baseUrl: `${oa.url}/v1`, model: 'm', apiKey: '' })
  const g401 = await voiceStatus({ ...gwSettings, providerId: gw401.id }, { isSnap: false })
  assert(!g401.reachable && /HTTP 401/.test(g401.sttHint ?? ''), 'status: rejected gateway says so')
  const gtr2 = await transcribe(wav([1]), { ...gwSettings, sttModel: 'x' })
  assert(gtr2.ok, 'a gateway answering plain text works for any model name')
  const g404 = await speak('Hi', gwSettings)
  assert(!g404.ok && /HTTP 404/.test(g404.error), 'speech errors carry the HTTP status')
  await oa.close()
  const gdown = await voiceStatus(gwSettings, { isSnap: false })
  assert(!gdown.reachable && /couldn’t reach/.test(gdown.sttHint ?? ''), 'status: unreachable gateway')
  assert(!(await transcribe(wav([1]), gwSettings)).ok, 'transcribe: network error is reported')
  assert(!(await speak('Hi', gwSettings)).ok, 'speak: network error is reported')
  assert((await pullSpeechModel('lfm3-audio', () => undefined, { ...settings, providerId: 'ollama' }, { fetchImpl: (async () => { throw new Error('boom') }) as typeof fetch })).error === 'boom', 'pull: network error is reported')

  const slow = (async (_u: unknown, init?: RequestInit) =>
    new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as typeof fetch
  const to = await transcribe(wav([1]), settings, { fetchImpl: slow, timeoutMs: 10 })
  assert(!to.ok && /Timed out/.test(to.error), 'transcribe times out')

  await mock.close()
  const down = await voiceStatus(settings, { isSnap: false })
  assert(!down.reachable && /isn’t running/.test(down.sttHint ?? ''), 'status: Ollama down → type instead')
  const none = await voiceStatus({ ...settings, providerId: 'missing' }, { isSnap: false })
  assert(!none.reachable && /Pick a provider/.test(none.sttHint ?? ''), 'status: no provider → pick one')
  const defaults = await voiceStatus(undefined, { isSnap: false, fetchImpl: (async () => new Response('{}', { status: 500 })) as typeof fetch })
  assert(!defaults.reachable, 'status with saved settings and a failing Ollama')

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

/**
 * Built-in provider presets. Base URLs verified against official docs (Sep 2026):
 *  - OpenAI      https://api.openai.com/v1                          (platform docs)
 *  - OpenRouter  https://openrouter.ai/api/v1                       (openrouter.ai/docs/quickstart)
 *  - Mistral     https://api.mistral.ai/v1                          (docs.mistral.ai/api/endpoint/chat)
 *  - DeepSeek    https://api.deepseek.com  (no /v1 needed)          (api-docs.deepseek.com)
 *  - Together    https://api.together.ai/v1                         (docs.together.ai OpenAI compatibility)
 *  - Groq        https://api.groq.com/openai/v1                     (console.groq.com/docs/openai)
 *  - xAI         https://api.x.ai/v1                                (docs.x.ai)
 *  - Gemini      https://generativelanguage.googleapis.com/v1beta/openai  (ai.google.dev/gemini-api/docs/openai)
 *  - Anthropic   https://api.anthropic.com/v1  (native Messages API) (docs.anthropic.com/en/api/messages)
 *  - LM Studio   http://127.0.0.1:1234/v1                           (lmstudio.ai/docs OpenAI compat)
 * Default models are sensible starting points and always editable (use Fetch models).
 */
import type { ProviderPresetInfo } from '../types'

export const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434'
export const LMSTUDIO_DEFAULT_URL = 'http://127.0.0.1:1234/v1'

export function ollamaBaseUrl(): string {
  return (process.env.LKV_OLLAMA_URL?.trim() || OLLAMA_DEFAULT_URL).replace(/\/+$/, '')
}

export function lmStudioBaseUrl(): string {
  return (process.env.LKV_LMSTUDIO_URL?.trim() || LMSTUDIO_DEFAULT_URL).replace(/\/+$/, '')
}

/** Recommended small local model for the first-run card (verified Sep 2026: Qwen3 8B is the
 * strongest instruction follower in the 7–8B class on Ollama; llama3.1:8b is the fallback). */
export const RECOMMENDED_LOCAL_MODEL = {
  name: 'qwen3:8b',
  command: 'ollama pull qwen3:8b',
  why: 'Small (~5 GB) and good at following “answer only from these notes + cite” rules. Alternative: llama3.1:8b.',
}

export const BUILTIN_PRESETS: ProviderPresetInfo[] = [
  {
    id: 'ollama',
    kind: 'ollama',
    label: 'Ollama',
    baseUrl: OLLAMA_DEFAULT_URL,
    defaultModel: '',
    local: true,
    requiresKey: false,
    supportsModelList: true,
    docsUrl: 'https://ollama.com',
    notes: 'Local. Leave model empty to auto-pick an installed model.',
  },
  {
    id: 'lmstudio',
    kind: 'openai-compatible',
    label: 'LM Studio',
    baseUrl: LMSTUDIO_DEFAULT_URL,
    defaultModel: '',
    local: true,
    requiresKey: false,
    supportsModelList: true,
    docsUrl: 'https://lmstudio.ai',
    notes: 'Local. Start the server in LM Studio (Developer → Start server).',
  },
  {
    id: 'openai',
    kind: 'openai-compatible',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    local: false,
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://platform.openai.com/docs/models',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    kind: 'anthropic',
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-haiku-4-5',
    local: false,
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    notes: 'Native Messages API (x-api-key + anthropic-version).',
  },
  {
    id: 'gemini',
    kind: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.8-flash',
    local: false,
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    notes: "Uses Google's official OpenAI-compatible endpoint.",
  },
  {
    id: 'openrouter',
    kind: 'openai-compatible',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/auto',
    local: false,
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://openrouter.ai/models',
    keyUrl: 'https://openrouter.ai/keys',
    notes: 'Try openrouter/free for zero-cost routing to free models.',
  },
  {
    id: 'mistral',
    kind: 'openai-compatible',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    local: false,
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://docs.mistral.ai/getting-started/models/',
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'deepseek',
    kind: 'openai-compatible',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    local: false,
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://api-docs.deepseek.com/',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'together',
    kind: 'openai-compatible',
    label: 'Together AI',
    baseUrl: 'https://api.together.ai/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    local: false,
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://docs.together.ai/docs/serverless-models',
    keyUrl: 'https://api.together.ai/settings/api-keys',
  },
  {
    id: 'groq',
    kind: 'openai-compatible',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-20b',
    local: false,
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://console.groq.com/docs/models',
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'xai',
    kind: 'openai-compatible',
    label: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.3',
    local: false,
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://docs.x.ai/docs/models',
    keyUrl: 'https://console.x.ai',
  },
  {
    id: 'custom',
    kind: 'openai-compatible',
    label: 'Custom (OpenAI-compatible)',
    baseUrl: 'http://127.0.0.1:8000/v1',
    defaultModel: '',
    local: true,
    requiresKey: false,
    supportsModelList: true,
    notes: 'vLLM, llama.cpp server, LocalAI, Jan, text-generation-webui … anything that speaks /v1/chat/completions.',
  },
]

export function getBuiltinPreset(id: string): ProviderPresetInfo | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === id)
}

/** Env vars checked (in order) for a preset's key. Env keys never auto-enable a provider. */
export const PRESET_ENV_KEYS: Record<string, string[]> = {
  openai: ['LKV_OPENAI_API_KEY', 'OPENAI_API_KEY'],
  anthropic: ['LKV_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'],
  gemini: ['LKV_GEMINI_API_KEY', 'GEMINI_API_KEY'],
  openrouter: ['LKV_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY'],
  mistral: ['LKV_MISTRAL_API_KEY', 'MISTRAL_API_KEY'],
  deepseek: ['LKV_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'],
  together: ['LKV_TOGETHER_API_KEY', 'TOGETHER_API_KEY'],
  groq: ['LKV_GROQ_API_KEY', 'GROQ_API_KEY'],
  xai: ['LKV_XAI_API_KEY', 'XAI_API_KEY'],
}

/** Infer parameter count (billions) from a model name or Ollama parameter_size. */
export function inferParamsB(name: string, parameterSize?: string): number | null {
  const fromSize = parameterSize?.match(/([\d.]+)\s*([BM])/i)
  if (fromSize) {
    const n = parseFloat(fromSize[1])
    return fromSize[2].toUpperCase() === 'M' ? n / 1000 : n
  }
  const m = name.toLowerCase().match(/(?:^|[:\-_/ ])(\d+(?:\.\d+)?)([bm])(?![a-z])/)
  if (!m) return null
  const n = parseFloat(m[1])
  return m[2] === 'm' ? n / 1000 : n
}

/** <3B params → citation rules are followed less reliably. */
export function isSmallModel(name: string, parameterSize?: string): boolean {
  const b = inferParamsB(name, parameterSize)
  return b !== null && b < 3
}

/** Ollama `:cloud` / `-cloud` tags run on ollama.com, not locally. */
export function isCloudModel(name: string): boolean {
  return /[:_-]cloud\b/i.test(name)
}

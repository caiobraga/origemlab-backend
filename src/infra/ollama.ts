import type { AppConfig } from "../config.js";
import { formatOllamaConnectionError } from "./ollamaHealth.js";
import {
  ensureOllamaFromConfig,
  getResolvedOllamaBaseUrl,
  getResolvedOllamaFastModel,
  getResolvedOllamaModel,
} from "./ollamaResolve.js";

type GenerateResponse = { response?: string };

export type OllamaGenerateOptions = {
  timeoutMs?: number;
  numPredict?: number;
  temperature?: number;
  repeatPenalty?: number;
  /** Override do modelo (ex.: modelo rápido em campos longos). */
  model?: string;
};

/** Campos com ≥ este limite podem usar modelo rápido (se instalado). */
const FAST_MODEL_WORD_THRESHOLD = 200;
/** Acima deste limite o modelo rápido (0.5b) repete demais — usar modelo de qualidade. */
const FAST_MODEL_MAX_WORDS = 500;
/** Campos sem word_limit/char_limit — estimativa para tokens e timeout. */
const DEFAULT_UNBOUNDED_WORD_LIMIT = 700;

function chatTimeoutMs(config: AppConfig): number {
  return Math.max(
    15_000,
    parseInt(process.env.OLLAMA_CHAT_TIMEOUT_MS || String(Math.min(config.ollama.timeoutMs, 120_000)), 10) ||
      120_000,
  );
}

function preferFastForAllFields(): boolean {
  return String(process.env.OLLAMA_PREFER_FAST ?? "").trim() === "1";
}

export type FieldLlmOptions = Required<Pick<OllamaGenerateOptions, "numPredict" | "timeoutMs" | "model">>;

/** Escala tokens, timeout e modelo conforme limite do campo. */
export async function resolveFieldLlmOptions(
  config: AppConfig,
  input: {
    word_limit?: number | null;
    char_limit?: number | null;
  },
): Promise<FieldLlmOptions> {
  await ensureOllamaFromConfig(config);
  const wordLimit =
    input.word_limit != null && Number.isFinite(input.word_limit) && input.word_limit > 0
      ? Math.round(input.word_limit)
      : null;
  const charLimit =
    input.char_limit != null && Number.isFinite(input.char_limit) && input.char_limit > 0
      ? Math.round(input.char_limit)
      : null;

  // Campos abertos (ex.: qualificação da equipe) usam estimativa para não cortar em ~145s.
  const sizingWordLimit =
    wordLimit ?? (charLimit == null ? DEFAULT_UNBOUNDED_WORD_LIMIT : null);

  let numPredict = 700;
  if (sizingWordLimit) {
    numPredict = Math.min(2800, Math.ceil(sizingWordLimit * 1.65) + 120);
  } else if (charLimit) {
    numPredict = Math.min(2800, Math.ceil(charLimit / 3.2) + 120);
  }

  const useFast =
    preferFastForAllFields() ||
    (wordLimit != null &&
      wordLimit >= FAST_MODEL_WORD_THRESHOLD &&
      wordLimit <= FAST_MODEL_MAX_WORDS) ||
    (charLimit != null && charLimit >= 1200 && charLimit <= 3200);

  const qualityModel = getResolvedOllamaModel(config);
  const fastModel = getResolvedOllamaFastModel(config);
  const model = useFast && fastModel !== qualityModel ? fastModel : qualityModel;

  if (model === fastModel && fastModel !== qualityModel && sizingWordLimit) {
    numPredict = Math.min(numPredict, Math.ceil(sizingWordLimit * 1.2) + 80);
  }

  const isFast = model === fastModel && fastModel !== qualityModel;
  const msPerToken = isFast ? 70 : 200;
  const timeoutMs = Math.min(
    300_000,
    Math.max(isFast ? 60_000 : 120_000, 50_000 + numPredict * msPerToken),
  );

  return { numPredict, timeoutMs, model };
}

async function ollamaGenerateInternal(
  config: AppConfig,
  prompt: string,
  options: OllamaGenerateOptions = {},
): Promise<string> {
  const url = getResolvedOllamaBaseUrl(config);
  const timeoutMs = options.timeoutMs ?? chatTimeoutMs(config);
  const numPredict = options.numPredict ?? 700;
  const temperature = options.temperature ?? 0.2;
  const repeatPenalty = options.repeatPenalty ?? 1.18;
  const model = options.model ?? getResolvedOllamaModel(config);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature,
          num_predict: numPredict,
          repeat_penalty: repeatPenalty,
          repeat_last_n: 128,
        },
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Ollama ${res.status}: ${text.slice(0, 500)}`);
    }
    const json = JSON.parse(text) as GenerateResponse;
    return String(json.response || "").trim();
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "AbortError") {
      const secs = Math.round(timeoutMs / 1000);
      throw new Error(`Ollama timeout após ${secs}s`);
    }
    if (e instanceof Error && e.message.startsWith("Ollama ")) throw e;
    throw new Error(formatOllamaConnectionError(url, e instanceof Error ? e : new Error(String(e))));
  } finally {
    clearTimeout(t);
  }
}

export async function ollamaChatGenerate(
  config: AppConfig,
  prompt: string,
  options: OllamaGenerateOptions = {},
): Promise<string> {
  await ensureOllamaFromConfig(config);
  return ollamaGenerateInternal(config, prompt, {
    timeoutMs: options.timeoutMs ?? chatTimeoutMs(config),
    numPredict: options.numPredict ?? 700,
    temperature: options.temperature ?? 0.2,
    model: options.model,
  });
}

/** @deprecated Prefer ollamaChatGenerate — same limits, avoids unbounded generation. */
export async function ollamaGenerate(config: AppConfig, prompt: string): Promise<string> {
  return ollamaGenerateInternal(config, prompt, {
    timeoutMs: chatTimeoutMs(config),
    numPredict: 900,
    temperature: 0,
  });
}

import type { AppConfig } from "../config.js";
import { formatOllamaConnectionError } from "./ollamaHealth.js";
import { getResolvedOllamaBaseUrl, getResolvedOllamaModel } from "./ollamaResolve.js";

type GenerateResponse = { response?: string };

type GenerateOptions = {
  timeoutMs?: number;
  numPredict?: number;
  temperature?: number;
};

function chatTimeoutMs(config: AppConfig): number {
  return Math.max(
    15_000,
    parseInt(process.env.OLLAMA_CHAT_TIMEOUT_MS || String(Math.min(config.ollama.timeoutMs, 120_000)), 10) ||
      120_000,
  );
}

async function ollamaGenerateInternal(
  config: AppConfig,
  prompt: string,
  options: GenerateOptions = {},
): Promise<string> {
  const url = getResolvedOllamaBaseUrl(config);
  const timeoutMs = options.timeoutMs ?? chatTimeoutMs(config);
  const numPredict = options.numPredict ?? 700;
  const temperature = options.temperature ?? 0.2;
  const model = getResolvedOllamaModel(config);
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
        options: { temperature, num_predict: numPredict },
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
      throw new Error(`Ollama timeout após ${timeoutMs}ms`);
    }
    if (e instanceof Error && e.message.startsWith("Ollama ")) throw e;
    throw new Error(formatOllamaConnectionError(url, e instanceof Error ? e : new Error(String(e))));
  } finally {
    clearTimeout(t);
  }
}

export async function ollamaChatGenerate(config: AppConfig, prompt: string): Promise<string> {
  return ollamaGenerateInternal(config, prompt, {
    timeoutMs: chatTimeoutMs(config),
    numPredict: 700,
    temperature: 0.2,
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

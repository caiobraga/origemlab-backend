import type { AppConfig } from "../config.js";
import { formatOllamaConnectionError } from "./ollamaHealth.js";
import { getResolvedOllamaBaseUrl, getResolvedOllamaModel } from "./ollamaResolve.js";

type GenerateResponse = { response?: string };
type TagsResponse = { models?: Array<{ name?: string; model?: string }> };

let resolvedModelCache: string | null = null;

function ollamaUrl(config: AppConfig): string {
  return getResolvedOllamaBaseUrl(config);
}

function isEmbedModelName(name: string): boolean {
  const n = String(name || "").toLowerCase();
  return n.includes("embed") || n.includes("mxbai") || n.includes("nomic-embed");
}

function normalizeModelName(name: string): string {
  return String(name || "").trim().toLowerCase();
}

function matchInstalledModel(requested: string, installed: string[]): string | null {
  const req = normalizeModelName(requested);
  if (!req) return null;
  const list = installed.map((name) => ({ raw: name, norm: normalizeModelName(name) }));
  const exact = list.find((m) => m.norm === req);
  if (exact) return exact.raw;
  const reqBase = req.split(":")[0];
  return (
    list.find((m) => m.norm === reqBase || m.norm.startsWith(`${reqBase}:`) || m.norm.startsWith(reqBase))?.raw ??
    null
  );
}

async function fetchInstalledModels(url: string, timeoutMs: number): Promise<string[]> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Math.min(timeoutMs, 12_000));
  try {
    const res = await fetch(`${url}/api/tags`, { method: "GET", signal: controller.signal });
    if (!res.ok) return [];
    const json = (await res.json()) as TagsResponse;
    return (json.models ?? []).map((m) => String(m.name || m.model || "").trim()).filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

async function resolveModel(config: AppConfig, timeoutMs: number): Promise<string> {
  if (resolvedModelCache) return resolvedModelCache;
  const url = ollamaUrl(config);
  const configured = getResolvedOllamaModel(config);
  const installed = await fetchInstalledModels(url, timeoutMs);
  const hit = matchInstalledModel(configured, installed);
  if (hit && !isEmbedModelName(hit)) {
    resolvedModelCache = hit;
    return hit;
  }

  const fallback =
    matchInstalledModel("qwen2.5:3b-instruct-q4_K_M", installed) ||
    matchInstalledModel("gemma3:4b-it-qat", installed) ||
    matchInstalledModel("gemma2:2b", installed) ||
    matchInstalledModel("llama3.2:3b", installed) ||
    matchInstalledModel("qwen2.5:3b-instruct", installed) ||
    installed.find((m) => !isEmbedModelName(m));

  if (!fallback) return configured;
  console.warn(`[backend/ollama] modelo ${configured} não encontrado — usando ${fallback}`);
  resolvedModelCache = fallback;
  return fallback;
}

export async function ollamaChatGenerate(config: AppConfig, prompt: string): Promise<string> {
  const url = ollamaUrl(config);
  const timeoutMs = Math.max(
    15_000,
    parseInt(process.env.OLLAMA_CHAT_TIMEOUT_MS || String(Math.min(config.ollama.timeoutMs, 120_000)), 10) ||
      120_000,
  );
  const resolved = await resolveModel(config, timeoutMs);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: resolved,
        prompt,
        stream: false,
        options: { temperature: 0.2, num_predict: 700 },
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

export async function ollamaGenerate(config: AppConfig, prompt: string): Promise<string> {
  const url = ollamaUrl(config);
  const { timeoutMs } = config.ollama;
  const resolved = await resolveModel(config, timeoutMs);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: resolved,
        prompt,
        stream: false,
        options: { temperature: 0 },
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

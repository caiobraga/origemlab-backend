import type { AppConfig } from "../config.js";

type GenerateResponse = { response?: string };
type TagsResponse = { models?: Array<{ name?: string; model?: string }> };

let resolvedModel: string | null = null;

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
    list.find((m) => m.norm === reqBase || m.norm.startsWith(`${reqBase}:`) || m.norm.startsWith(reqBase))?.raw ?? null
  );
}

async function fetchInstalledModels(baseUrl: string, timeoutMs: number): Promise<string[]> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Math.min(timeoutMs, 10_000));
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { method: "GET", signal: controller.signal });
    if (!res.ok) return [];
    const json = (await res.json()) as TagsResponse;
    return (json.models ?? []).map((m) => String(m.name || m.model || "").trim()).filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

async function resolveModel(baseUrl: string, configuredModel: string, timeoutMs: number): Promise<string> {
  if (resolvedModel) return resolvedModel;
  const installed = await fetchInstalledModels(baseUrl, timeoutMs);
  const configured = matchInstalledModel(configuredModel, installed);
  if (configured && !isEmbedModelName(configured)) {
    resolvedModel = configured;
    return configured;
  }

  const fallback =
    matchInstalledModel("gemma2:2b", installed) ||
    matchInstalledModel("llama3.2:3b", installed) ||
    matchInstalledModel("qwen2.5:3b-instruct", installed) ||
    installed.find((m) => !isEmbedModelName(m));

  if (!fallback) return configuredModel;
  console.warn(`[backend/ollama] modelo ${configuredModel} não encontrado — usando ${fallback}`);
  resolvedModel = fallback;
  return fallback;
}

export async function ollamaGenerate(config: AppConfig, prompt: string): Promise<string> {
  const { baseUrl, model, timeoutMs } = config.ollama;
  const resolved = await resolveModel(baseUrl, model, timeoutMs);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
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
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    clearTimeout(t);
  }
}

import type { AppConfig } from "../config.js";

let resolvedBase: string | null = null;
let resolvedModel: string | null = null;
let resolvedFastModel: string | null = null;

const CHAT_MODEL_PRIORITY = [
  "qwen2.5:3b-instruct-q4_K_M",
  "qwen2.5:3b-instruct",
  "gemma3:4b-it-qat",
  "llama3.2:3b",
  "gemma2:2b",
  "phi3.5",
];

/** Modelos menores — mais rápidos para campos longos (ex.: 1000 palavras). */
const FAST_MODEL_PRIORITY = [
  "qwen2.5:0.5b",
  "llama3.2:1b-instruct-q4_K_M",
  "llama3.2:1b",
  "tinyllama:latest",
  "phi3.5:latest",
];

function normalizeBase(url: string): string {
  return String(url || "").trim().replace(/\/+$/, "");
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
  const list = installed.map((n) => ({ raw: n, norm: normalizeModelName(n) }));
  const exact = list.find((m) => m.norm === req);
  if (exact) return exact.raw;
  const reqBase = req.split(":")[0];
  return (
    list.find((m) => m.norm === reqBase || m.norm.startsWith(`${reqBase}:`) || m.norm.startsWith(reqBase))?.raw ??
    null
  );
}

function pickChatModel(installed: string[], configured: string): string | null {
  const hit = matchInstalledModel(configured, installed);
  if (hit && !isEmbedModelName(hit)) return hit;
  for (const pref of CHAT_MODEL_PRIORITY) {
    const m = matchInstalledModel(pref, installed);
    if (m && !isEmbedModelName(m)) return m;
  }
  return installed.find((m) => !isEmbedModelName(m)) ?? null;
}

function pickFastModel(installed: string[], configured: string): string | null {
  const hit = matchInstalledModel(configured, installed);
  if (hit && !isEmbedModelName(hit)) return hit;
  for (const pref of FAST_MODEL_PRIORITY) {
    const m = matchInstalledModel(pref, installed);
    if (m && !isEmbedModelName(m)) return m;
  }
  return null;
}

function candidateUrls(configured: string): string[] {
  const primary = normalizeBase(configured);
  const localExplicit = normalizeBase(process.env.OLLAMA_BASE_URL_LOCAL || "");
  const preferLocal = String(process.env.OLLAMA_PREFER_LOCAL ?? "").trim() === "1";
  const dockerHost = normalizeBase(process.env.OLLAMA_DOCKER_HOST_URL || "http://host.docker.internal:11434");
  const bridgeHost = normalizeBase(process.env.OLLAMA_BRIDGE_HOST_URL || "http://172.17.0.1:11434");

  const out: string[] = [];
  const push = (u: string) => {
    if (u && !out.includes(u)) out.push(u);
  };

  if (preferLocal) {
    push(localExplicit);
    push(dockerHost);
    push(bridgeHost);
    push("http://127.0.0.1:11434");
    push("http://localhost:11434");
    push(primary);
  } else {
    push(primary);
    push(localExplicit);
    push(dockerHost);
    push(bridgeHost);
    push("http://127.0.0.1:11434");
    push("http://localhost:11434");
  }
  return out;
}

async function fetchInstalledModels(baseUrl: string, timeoutMs = 12_000): Promise<string[]> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { method: "GET", signal: controller.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    return (data?.models || []).map((m) => String(m.name || m.model || "").trim()).filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/**
 * Escolhe URL Ollama acessível e modelo de chat instalado.
 * Atualiza config.ollama e process.env para o restante do processo.
 */
export async function initOllamaFromConfig(config: AppConfig): Promise<AppConfig> {
  if (resolvedBase) return config;

  const configured = config.ollama.baseUrl;
  const candidates = candidateUrls(configured);

  for (const url of candidates) {
    const models = await fetchInstalledModels(url);
    if (models.length === 0) continue;

    const chat = pickChatModel(models, config.ollama.model);
    if (!chat) continue;

    const fastConfigured = String(process.env.OLLAMA_FAST_MODEL || "").trim();
    const fast = pickFastModel(models, fastConfigured) ?? chat;

    const requestedModel = config.ollama.model;
    resolvedBase = url;
    resolvedModel = chat;
    resolvedFastModel = fast;
    config.ollama.baseUrl = url;
    config.ollama.model = chat;
    process.env.OLLAMA_BASE_URL = url;
    process.env.OLLAMA_MODEL = chat;
    if (fast !== chat) {
      process.env.OLLAMA_FAST_MODEL_RESOLVED = fast;
    }

    if (url !== normalizeBase(configured)) {
      console.warn(`[backend/ollama] ${configured} inacessível — usando ${url} (modelo ${chat})`);
    } else if (normalizeModelName(chat) !== normalizeModelName(requestedModel)) {
      console.warn(`[backend/ollama] modelo ${requestedModel} não encontrado — usando ${chat}`);
    } else {
      console.log(
        `[backend/ollama] OK ${url} (qualidade: ${chat}${fast !== chat ? `, rápido: ${fast}` : ""})`,
      );
    }
    return config;
  }

  throw new Error(
    `Ollama inacessível (tentado: ${candidates.join(", ")}). ` +
      "Dev Docker: defina OLLAMA_PREFER_LOCAL=1 e extra_hosts host.docker.internal, ou use Ollama local com `ollama serve`.",
  );
}

export function getResolvedOllamaBaseUrl(config: AppConfig): string {
  return resolvedBase || config.ollama.baseUrl;
}

export function getResolvedOllamaModel(config: AppConfig): string {
  return resolvedModel || config.ollama.model;
}

/** Modelo leve para geração de campos longos (fallback: modelo de qualidade). */
export function getResolvedOllamaFastModel(config: AppConfig): string {
  return resolvedFastModel || getResolvedOllamaModel(config);
}

export function resetOllamaResolveCacheForTests(): void {
  resolvedBase = null;
  resolvedModel = null;
  resolvedFastModel = null;
}

import type { AppConfig } from "../config.js";

export type OllamaHealth = {
  ok: boolean;
  baseUrl: string;
  model: string;
  latencyMs?: number;
  modelsInstalled?: number;
  installedModels?: string[];
  error?: string;
};

export async function probeOllama(config: AppConfig): Promise<OllamaHealth> {
  const { baseUrl, model } = config.ollama;
  const started = Date.now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      return {
        ok: false,
        baseUrl,
        model,
        latencyMs,
        error: `Ollama respondeu HTTP ${res.status}: ${body}`,
      };
    }
    const json = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    const installedModels = (json.models || [])
      .map((m) => String(m.name || m.model || "").trim())
      .filter(Boolean);
    return {
      ok: true,
      baseUrl,
      model,
      latencyMs,
      modelsInstalled: installedModels.length,
      installedModels,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      baseUrl,
      model,
      error: formatOllamaConnectionError(baseUrl, e instanceof Error ? e : new Error(msg)),
    };
  } finally {
    clearTimeout(t);
  }
}

export function formatOllamaConnectionError(baseUrl: string, err: Error): string {
  const name = err.name || "";
  const msg = err.message || String(err);
  if (name === "AbortError" || /timeout/i.test(msg)) {
    return `Timeout ao conectar ao Ollama (${baseUrl}). Verifique OLLAMA_BASE_URL e se o serviço está no ar.`;
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|network/i.test(msg)) {
    return `Não foi possível conectar ao Ollama (${baseUrl}). Confira OLLAMA_BASE_URL no deploy e acesso de rede (EB → NLB :11434).`;
  }
  return `Erro ao contactar Ollama (${baseUrl}): ${msg}`;
}

export function isOllamaConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Ollama|fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|AbortError|timeout/i.test(msg);
}

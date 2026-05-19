import type { AppConfig } from "../config.js";

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

function normalizeHits(raw: Array<{ title?: string; url?: string; snippet?: string; content?: string }>): WebSearchHit[] {
  return raw
    .map((h) => ({
      title: String(h.title || h.url || "Fonte").trim(),
      url: String(h.url || "").trim(),
      snippet: String(h.snippet || h.content || "").trim().slice(0, 800),
    }))
    .filter((h) => h.url.startsWith("http"));
}

async function searchTavily(apiKey: string, query: string, maxResults: number): Promise<WebSearchHit[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: maxResults,
      include_answer: false,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return normalizeHits(
    (json.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    })),
  );
}

async function searchSerper(apiKey: string, query: string, maxResults: number): Promise<WebSearchHit[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: query, num: maxResults }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Serper ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  return normalizeHits(
    (json.organic || []).map((r) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
    })),
  );
}

/** Pesquisa na internet para embasar propostas (Tavily ou Serper). */
export async function searchWeb(config: AppConfig, query: string): Promise<WebSearchHit[]> {
  const q = String(query || "").trim();
  if (!q) return [];

  const max = config.webSearch.maxResults;
  const { tavilyApiKey, serperApiKey } = config.webSearch;

  if (tavilyApiKey) {
    return searchTavily(tavilyApiKey, q, max);
  }
  if (serperApiKey) {
    return searchSerper(serperApiKey, q, max);
  }

  throw new Error(
    "Pesquisa web não configurada. Defina TAVILY_API_KEY ou SERPER_API_KEY no backend.",
  );
}

export function formatReferencesForPrompt(refs: WebSearchHit[]): string {
  if (!refs.length) {
    return "(Nenhuma fonte encontrada na pesquisa — use apenas o que o edital e o formulário permitem; não invente citações.)";
  }
  return refs
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\nTrecho: ${r.snippet}`)
    .join("\n\n");
}

import type { Request } from "express";
import type { AppConfig } from "../config.js";
import type { SupabaseGateway } from "../infra/gateways.js";
import { getBearerToken } from "../http/auth.js";

async function ollamaGenerate(config: AppConfig, prompt: string): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), config.ollama.timeoutMs);
  try {
    const r = await fetch(`${config.ollama.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollama.model,
        prompt,
        stream: false,
        options: { temperature: 0 },
      }),
      signal: controller.signal,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`Ollama HTTP ${r.status}${txt ? `: ${txt}` : ""}`);
    }
    const data = (await r.json().catch(() => ({}))) as any;
    const out = typeof data?.response === "string" ? data.response : "";
    return out.trim();
  } finally {
    clearTimeout(t);
  }
}

function enforceCharLimit(text: string, charLimit: number | null | undefined): string {
  if (!charLimit || !Number.isFinite(charLimit) || charLimit <= 0) return text;
  if (text.length <= charLimit) return text;
  const hard = text.slice(0, charLimit);
  const lastBreak = Math.max(
    hard.lastIndexOf("\n"),
    hard.lastIndexOf(". "),
    hard.lastIndexOf("! "),
    hard.lastIndexOf("? "),
    hard.lastIndexOf("; "),
    hard.lastIndexOf(", "),
    hard.lastIndexOf(" "),
  );
  const cutAt = lastBreak >= Math.max(0, charLimit - 120) ? lastBreak : charLimit;
  return hard.slice(0, cutAt).trim();
}

export type AiTextUseCases = {
  generateFieldText(req: Request): Promise<{ status: number; body: any }>;
  improveText(req: Request): Promise<{ status: number; body: any }>;
};

export function buildAiTextUseCases(deps: { config: AppConfig; supabase: SupabaseGateway }): AiTextUseCases {
  return {
    async generateFieldText(req) {
      const body = (req as any).body || {};
      const editalId = body.edital_id ? String(body.edital_id).trim() : "";
      const propostaId = body.proposta_id ? String(body.proposta_id).trim() : "";
      if (!editalId && !propostaId) {
        return { status: 400, body: { error: "É necessário edital_id ou proposta_id para gerar o texto." } };
      }

      const fieldName = String(body.field_name || "").trim();
      const fieldDescription = String(body.field_description || "").trim();
      const wordLimit = body.word_limit != null ? Number(body.word_limit) : null;
      const charLimit = body.char_limit != null ? Number(body.char_limit) : null;

      if (!fieldName) return { status: 400, body: { error: "field_name obrigatório" } };

      // Optional audit: resolve userId if bearer exists
      let userId: string | null = null;
      const token = getBearerToken(req);
      if (token) {
        const user = await deps.supabase.getUserFromAccessToken(token);
        userId = user?.id || null;
      }

      const prompt = [
        "Você é um assistente especializado em redigir textos de propostas para editais de fomento.",
        "",
        `Campo: ${fieldName}`,
        fieldDescription ? `Descrição: ${fieldDescription}` : "",
        wordLimit ? `Limite: no máximo ${Math.round(wordLimit)} palavras.` : "",
        charLimit ? `Limite: no máximo ${Math.round(charLimit)} caracteres (com espaços).` : "",
        "",
        "Tarefa: Gere um texto completo e bem estruturado para este campo, em português (pt-BR).",
        "Responda APENAS com o texto final, sem explicações.",
        "",
        userId ? `Contexto: userId=${userId}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      try {
        const generated = await ollamaGenerate(deps.config, prompt);
        const trimmed = enforceCharLimit(generated, charLimit);
        return { status: 200, body: { generated_text: trimmed } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao gerar texto";
        return { status: 500, body: { error: msg } };
      }
    },

    async improveText(req) {
      const body = (req as any).body || {};
      const editalId = body.edital_id ? String(body.edital_id).trim() : "";
      const propostaId = body.proposta_id ? String(body.proposta_id).trim() : "";
      if (!editalId && !propostaId) {
        return { status: 400, body: { error: "É necessário edital_id ou proposta_id para melhorar o texto." } };
      }

      const fieldName = String(body.field_name || "").trim();
      const fieldDescription = String(body.field_description || "").trim();
      const currentText = String(body.current_text || "").trim();
      const wordLimit = body.word_limit != null ? Number(body.word_limit) : null;
      const charLimit = body.char_limit != null ? Number(body.char_limit) : null;

      if (!fieldName) return { status: 400, body: { error: "field_name obrigatório" } };
      if (!currentText) return { status: 400, body: { error: "current_text obrigatório" } };

      const prompt = [
        "Você é um assistente especializado em melhorar textos de propostas para editais de fomento.",
        "",
        `Campo: ${fieldName}`,
        fieldDescription ? `Descrição: ${fieldDescription}` : "",
        wordLimit ? `Limite: no máximo ${Math.round(wordLimit)} palavras.` : "",
        charLimit ? `Limite: no máximo ${Math.round(charLimit)} caracteres (com espaços).` : "",
        "",
        "Texto atual:",
        '"""',
        currentText,
        '"""',
        "",
        "Tarefa: Reescreva melhorando clareza, coesão e profissionalismo, sem inventar fatos. Responda APENAS com o texto melhorado.",
      ]
        .filter(Boolean)
        .join("\n");

      try {
        const improved = await ollamaGenerate(deps.config, prompt);
        const trimmed = enforceCharLimit(improved, charLimit);
        return { status: 200, body: { improved_text: trimmed } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao melhorar texto";
        return { status: 500, body: { error: msg } };
      }
    },
  };
}


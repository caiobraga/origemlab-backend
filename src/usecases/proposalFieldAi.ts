import type { Request } from "express";
import type { AppConfig } from "../config.js";
import type { SupabaseGateway } from "../infra/gateways.js";
import { ollamaChatGenerate, resolveFieldLlmOptions } from "../infra/ollama.js";
import { isOllamaConnectionError } from "../infra/ollamaHealth.js";
import { formatReferencesForPrompt, searchWeb, type WebSearchHit } from "../infra/webSearch.js";
import type { AuthUseCases } from "./auth.js";
import { requireProSubscription } from "./subscriptionGuard.js";

export type ProposalFieldAiUseCases = {
  generateFieldText(req: Request): Promise<{ status: number; body: any }>;
  improveText(req: Request): Promise<{ status: number; body: any }>;
  analyzeField(req: Request): Promise<{ status: number; body: any }>;
  groundFieldWithReferences(req: Request): Promise<{ status: number; body: any }>;
};

type FieldBody = {
  edital_id: string;
  proposta_id: string;
  field_name: string;
  field_description: string;
  field_id: string;
  word_limit: number | null;
  char_limit: number | null;
  current_text: string;
  form_data: unknown;
  target_language: string;
};

function parseFieldBody(req: Request): { ok: true; body: FieldBody } | { ok: false; error: string } {
  const raw = (req as any).body || {};
  const editalId = raw.edital_id ? String(raw.edital_id).trim() : "";
  const propostaId = raw.proposta_id ? String(raw.proposta_id).trim() : "";
  if (!editalId && !propostaId) {
    return { ok: false, error: "É necessário edital_id ou proposta_id." };
  }
  const fieldName = String(raw.field_name || "").trim();
  if (!fieldName) return { ok: false, error: "field_name obrigatório" };

  return {
    ok: true,
    body: {
      edital_id: editalId,
      proposta_id: propostaId,
      field_name: fieldName,
      field_description: String(raw.field_description || "").trim(),
      field_id: String(raw.field_id || "").trim(),
      word_limit: raw.word_limit != null ? Number(raw.word_limit) : null,
      char_limit: raw.char_limit != null ? Number(raw.char_limit) : null,
      current_text: String(raw.current_text || "").trim(),
      form_data: raw.form_data ?? null,
      target_language: String(raw.target_language || "pt").trim() || "pt",
    },
  };
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

function linesFromLlmBlock(text: string, max = 6): string[] {
  return String(text || "")
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((l) => l.length >= 8)
    .slice(0, max);
}

function enforceWordLimit(text: string, wordLimit: number | null | undefined): string {
  if (!wordLimit || !Number.isFinite(wordLimit) || wordLimit <= 0) return text;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= wordLimit) return text;
  return words.slice(0, wordLimit).join(" ");
}

function finalizeFieldText(
  text: string,
  body: Pick<FieldBody, "word_limit" | "char_limit">,
): string {
  let out = enforceCharLimit(text, body.char_limit);
  out = enforceWordLimit(out, body.word_limit);
  return out;
}

function trimPromptBlock(text: string, max: number): string {
  const s = String(text || "").trim();
  if (!s || s.length <= max) return s;
  return `${s.slice(0, max)}\n…`;
}

async function resolveContext(
  deps: { supabase: SupabaseGateway },
  body: FieldBody,
): Promise<{ editalSummary: string; formSummary: string }> {
  const ctx = await deps.supabase.fetchAiFieldContext({
    editalId: body.edital_id || undefined,
    propostaId: body.proposta_id || undefined,
  });
  let formSummary = ctx.formSummary;
  if (!formSummary && body.form_data) {
    try {
      const raw = JSON.stringify(body.form_data);
      formSummary = raw.length > 2500 ? `${raw.slice(0, 2500)}\n…` : raw;
    } catch {
      formSummary = "";
    }
  }
  return {
    editalSummary: trimPromptBlock(ctx.editalSummary, 2500),
    formSummary: trimPromptBlock(formSummary, 2000),
  };
}

/** Prompt “antigo” / base da tarefa de redação do campo (gerar ou melhorar). */
function buildOriginalTaskPrompt(
  body: FieldBody,
  ctx: { editalSummary: string; formSummary: string },
  mode: "generate" | "improve",
): string {
  const lang = body.target_language === "en" ? "inglês (en)" : "português (pt-BR)";
  const limits = [
    body.word_limit ? `Limite: no máximo ${Math.round(body.word_limit)} palavras.` : "",
    body.char_limit ? `Limite: no máximo ${Math.round(body.char_limit)} caracteres (com espaços).` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const parts = [
    "Você é um assistente especializado em redigir textos de propostas para editais de fomento.",
    `Idioma de saída: ${lang}.`,
    "",
    `Campo: ${body.field_name}`,
    body.field_description ? `Descrição do campo: ${body.field_description}` : "",
    limits,
    "",
    ctx.editalSummary ? `Contexto do edital:\n${ctx.editalSummary}` : "",
    ctx.formSummary ? `Contexto do formulário da proposta (JSON resumido):\n${ctx.formSummary}` : "",
    "",
  ];

  if (mode === "generate") {
    parts.push(
      "Tarefa: Gere um texto completo e bem estruturado para este campo.",
      body.word_limit && body.word_limit >= 400
        ? "Seja completo e objetivo; respeite rigorosamente o limite de palavras (não ultrapasse)."
        : "",
      "Responda APENAS com o texto final, sem explicações.",
    );
  } else {
    parts.push(
      "Tarefa: Reescreva o texto melhorando clareza, coesão e profissionalismo, sem inventar fatos.",
      "Responda APENAS com o texto melhorado.",
    );
  }

  return parts.filter(Boolean).join("\n");
}

async function stepIdentifyClaims(config: AppConfig, currentText: string, fieldName: string): Promise<string> {
  const prompt = [
    "Liste afirmações do texto abaixo que precisam de embasamento científico ou referência bibliográfica.",
    "Uma afirmação por linha, sem numeração, máximo 6 linhas.",
    "Se não houver nenhuma, responda: NENHUMA",
    "",
    `Campo: ${fieldName}`,
    "",
    "TEXTO:",
    currentText,
  ].join("\n");
  return ollamaChatGenerate(config, prompt);
}

async function stepBuildSearchQueries(
  config: AppConfig,
  claimsBlock: string,
  fieldName: string,
): Promise<string[]> {
  const prompt = [
    "Com base nas afirmações abaixo, gere consultas de busca para artigos científicos, revisões, relatórios técnicos ou páginas institucionais confiáveis.",
    "Prefira termos que funcionem em Google Scholar, PubMed, SciELO ou sites .gov/.edu.",
    "Uma consulta por linha, 3 a 5 consultas, em português ou inglês, sem numeração.",
    "",
    `Campo da proposta: ${fieldName}`,
    "",
    "AFIRMAÇÕES:",
    claimsBlock,
  ].join("\n");
  const out = await ollamaChatGenerate(config, prompt);
  return linesFromLlmBlock(out, config.webSearch.maxQueries);
}

async function stepSearchReferences(
  config: AppConfig,
  queries: string[],
): Promise<WebSearchHit[]> {
  const all: WebSearchHit[] = [];
  const seen = new Set<string>();
  for (const q of queries.slice(0, config.webSearch.maxQueries)) {
    const hits = await searchWeb(config, q);
    for (const h of hits) {
      const key = h.url.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      all.push(h);
    }
  }
  return all.slice(0, config.webSearch.maxResults * config.webSearch.maxQueries);
}

async function stepRewriteWithReferences(
  config: AppConfig,
  originalTaskPrompt: string,
  currentText: string,
  refs: WebSearchHit[],
  mode: "generate" | "improve",
  llmOpts: Awaited<ReturnType<typeof resolveFieldLlmOptions>>,
): Promise<string> {
  const refsBlock = formatReferencesForPrompt(refs);
  const prompt = [
    originalTaskPrompt,
    "",
    "=== EMBASAMENTO COM REFERÊNCIAS (pesquisa na internet) ===",
    "Use SOMENTE as fontes listadas abaixo para embasar afirmações factuais ou científicas.",
    "Cite no texto como (Autor/instituição, ano) ou [n] conforme a lista.",
    "Não invente referências que não estejam na lista.",
    "",
    refsBlock,
    "",
    mode === "improve" ? "TEXTO ATUAL A REESCREVER:" : "RASCUNHO / NOTAS (se houver):",
    '"""',
    currentText || "(vazio — redija do zero seguindo a tarefa acima)",
    '"""',
    "",
    "Tarefa final: Reescreva o texto do campo incorporando embasamento científico onde couber.",
    "Mantenha o tom de proposta de fomento. Responda APENAS com o texto final.",
  ].join("\n");
  return ollamaChatGenerate(config, prompt, llmOpts);
}

export function buildProposalFieldAiUseCases(deps: {
  config: AppConfig;
  supabase: SupabaseGateway;
  auth: AuthUseCases;
}): ProposalFieldAiUseCases {
  const guardDeps = {
    supabase: deps.supabase,
    auth: deps.auth,
    enforce: deps.config.subscriptionEnforce,
  };

  async function guardAi(req: Request) {
    return requireProSubscription(req, guardDeps, "ai_proposal");
  }

  return {
    async generateFieldText(req) {
      const loaded = await guardAi(req);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const parsed = parseFieldBody(req);
      if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

      const ctx = await resolveContext(deps, parsed.body);
      const prompt = buildOriginalTaskPrompt(parsed.body, ctx, "generate");

      try {
        const llmOpts = await resolveFieldLlmOptions(deps.config, parsed.body);
        const generated = await ollamaChatGenerate(deps.config, prompt, llmOpts);
        const trimmed = finalizeFieldText(generated, parsed.body);
        return { status: 200, body: { generated_text: trimmed } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao gerar texto";
        const status = isOllamaConnectionError(e) ? 503 : 500;
        return { status, body: { error: msg } };
      }
    },

    async improveText(req) {
      const loaded = await guardAi(req);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const parsed = parseFieldBody(req);
      if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
      if (!parsed.body.current_text) {
        return { status: 400, body: { error: "current_text obrigatório" } };
      }

      const ctx = await resolveContext(deps, parsed.body);
      const base = buildOriginalTaskPrompt(parsed.body, ctx, "improve");
      const prompt = [
        base,
        "",
        "Texto atual:",
        '"""',
        parsed.body.current_text,
        '"""',
      ].join("\n");

      try {
        const llmOpts = await resolveFieldLlmOptions(deps.config, parsed.body);
        const improved = await ollamaChatGenerate(deps.config, prompt, llmOpts);
        const trimmed = finalizeFieldText(improved, parsed.body);
        return { status: 200, body: { improved_text: trimmed } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao melhorar texto";
        return { status: 500, body: { error: msg } };
      }
    },

    async analyzeField(req) {
      const loaded = await guardAi(req);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const parsed = parseFieldBody(req);
      if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

      const ctx = await resolveContext(deps, parsed.body);
      const text = parsed.body.current_text;

      const prompt = [
        "Você analisa campos de propostas de editais de fomento.",
        "Responda em Markdown (pt-BR).",
        "",
        `Campo: ${parsed.body.field_name}`,
        parsed.body.field_description ? `Descrição: ${parsed.body.field_description}` : "",
        ctx.editalSummary ? `\nEdital:\n${ctx.editalSummary}` : "",
        "",
        "TEXTO ATUAL:",
        text ? `"""\n${text}\n"""` : "(vazio)",
        "",
        "Inclua:",
        "## Resumo",
        "## Pontos fortes",
        "## Lacunas / riscos",
        "## Precisa de embasamento científico?",
        "Responda **sim** ou **não** e explique quais trechos precisariam de referência.",
        "## Checklist de melhorias",
        "- itens acionáveis",
      ].join("\n");

      try {
        const analysis = await ollamaChatGenerate(deps.config, prompt);
        const needs =
          /\*\*sim\*\*|precisa de embasamento[^\n]*sim|embasamento científico[^\n]*sim/i.test(analysis) &&
          !/\*\*n[aã]o\*\*/i.test(analysis.split("Precisa de embasamento")[1] || "");
        return {
          status: 200,
          body: {
            analysis_markdown: analysis,
            needs_scientific_grounding: needs,
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao analisar campo";
        return { status: 500, body: { error: msg } };
      }
    },

    async groundFieldWithReferences(req) {
      const loaded = await guardAi(req);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const parsed = parseFieldBody(req);
      if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

      const ctx = await resolveContext(deps, parsed.body);
      const currentText = parsed.body.current_text;
      const mode: "generate" | "improve" = currentText ? "improve" : "generate";
      const originalPrompt = buildOriginalTaskPrompt(parsed.body, ctx, mode);

      const steps: Array<{ step: string; detail: string }> = [];
      const llmOpts = await resolveFieldLlmOptions(deps.config, parsed.body);

      try {
        steps.push({ step: "identificar_afirmacoes", detail: "Analisando trechos que precisam de referência…" });
        const claimsBlock = await stepIdentifyClaims(deps.config, currentText || parsed.body.field_description, parsed.body.field_name);
        if (/^NENHUMA$/im.test(claimsBlock.trim())) {
          steps.push({ step: "pesquisa", detail: "Nenhuma afirmação exige referência; reescrevendo com prompt base." });
          const out = await ollamaChatGenerate(deps.config, [
            originalPrompt,
            "",
            currentText ? `Texto atual:\n"""\n${currentText}\n"""` : "",
          ].join("\n"), llmOpts);
          return {
            status: 200,
            body: {
              grounded_text: finalizeFieldText(out, parsed.body),
              references: [],
              steps,
            },
          };
        }

        steps.push({ step: "consultas", detail: "Gerando consultas de busca…" });
        const queries = await stepBuildSearchQueries(deps.config, claimsBlock, parsed.body.field_name);
        steps.push({
          step: "pesquisa_web",
          detail: queries.length ? `Buscando: ${queries.join(" | ")}` : "Sem consultas geradas",
        });

        const references = queries.length ? await stepSearchReferences(deps.config, queries) : [];

        steps.push({
          step: "reescrita",
          detail: `Reescrevendo com ${references.length} referência(s) e prompt original…`,
        });
        const grounded = await stepRewriteWithReferences(
          deps.config,
          originalPrompt,
          currentText,
          references,
          mode,
          llmOpts,
        );

        return {
          status: 200,
          body: {
            grounded_text: finalizeFieldText(grounded, parsed.body),
            references,
            steps,
            search_queries: queries,
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao embasar com referências";
        return { status: 500, body: { error: msg, steps } };
      }
    },
  };
}

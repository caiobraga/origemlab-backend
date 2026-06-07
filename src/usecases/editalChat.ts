import type { Request } from "express";
import type { AppConfig } from "../config.js";
import type { SupabaseGateway } from "../infra/gateways.js";
import { ollamaChatGenerate } from "../infra/ollama.js";

function buildEditalChatPrompt(input: {
  message: string;
  editalSummary: string;
  excerpts: string[];
  history: Array<{ role: string; content: string }>;
}): string {
  const excerptBlock = input.excerpts.length
    ? input.excerpts.map((e, i) => `[Trecho ${i + 1}]\n${e}`).join("\n\n")
    : "Nenhum trecho indexado do PDF disponível.";
  const historyBlock = input.history
    .slice(-8)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  return [
    "Você é o Assistente de Edital do Origem.Lab. Responda em português, de forma clara e objetiva.",
    "Use apenas as informações abaixo. Se a resposta não estiver no contexto, diga que não encontrou no edital.",
    "",
    "=== Dados do edital ===",
    input.editalSummary || "Sem resumo estruturado.",
    "",
    "=== Trechos do documento ===",
    excerptBlock,
    "",
    historyBlock ? `=== Histórico ===\n${historyBlock}\n` : "",
    `=== Pergunta ===\n${input.message}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function handleEditalChat(
  req: Request,
  deps: { config: AppConfig; supabase: SupabaseGateway },
): Promise<{ status: number; body: any }> {
  const raw = (req as any).body || {};
  const editalId = String(raw.edital_id || "").trim();
  const message = String(raw.message || "").trim();
  if (!editalId) return { status: 400, body: { error: "edital_id obrigatório" } };
  if (!message) return { status: 400, body: { error: "message obrigatório" } };

  const history = Array.isArray(raw.chatHistory)
    ? raw.chatHistory
        .slice(-10)
        .map((m: any) => ({
          role: String(m?.role || "user"),
          content: String(m?.content || "").slice(0, 2000),
        }))
        .filter((m: { content: string }) => m.content)
    : [];

  const ctx = await deps.supabase.fetchEditalChatContext({
    editalId,
    query: message,
    maxChunks: 4,
  });

  const prompt = buildEditalChatPrompt({
    message,
    editalSummary: ctx.editalSummary,
    excerpts: ctx.excerpts,
    history,
  });

  const reply = await ollamaChatGenerate(deps.config, prompt);
  return { status: 200, body: { reply } };
}

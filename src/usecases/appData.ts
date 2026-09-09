import type { Request, Response } from "express";
import type { AppConfig } from "../config.js";
import type { SupabaseGateway } from "../infra/gateways.js";
import type { AuthUseCases } from "./auth.js";
import { handleEditalChat } from "./editalChat.js";
import {
  FREE_EDITAIS_PER_MONTH,
} from "../lib/subscriptionEntitlements.js";
import { loadSubscriptionContext, requireProSubscription } from "./subscriptionGuard.js";
import {
  adaptCamposWithAi,
  getAdaptFieldsTotal,
  seedCamposFromProjeto,
} from "./gerarPropostaFromProjeto.js";
import { isOllamaConnectionError } from "../infra/ollamaHealth.js";

export type AppDataUseCases = {
  listEditais(req: Request): Promise<{ status: number; body: any }>;
  getEdital(req: Request): Promise<{ status: number; body: any }>;
  listPropostas(req: Request): Promise<{ status: number; body: any }>;
  getProposta(req: Request): Promise<{ status: number; body: any }>;
  createProposta(req: Request): Promise<{ status: number; body: any }>;
  patchProposta(req: Request): Promise<{ status: number; body: any }>;
  deleteProposta(req: Request): Promise<{ status: number; body: any }>;
  refreshIndicacoes(req: Request): Promise<{ status: number; body: any }>;
  fetchIndicacoes(req: Request): Promise<{ status: number; body: any }>;
  getProfile(req: Request): Promise<{ status: number; body: any }>;
  patchProfile(req: Request): Promise<{ status: number; body: any }>;
  referralStats(req: Request): Promise<{ status: number; body: any }>;
  editalChat(req: Request): Promise<{ status: number; body: any }>;
  publicCatalogStats(): Promise<{ status: number; body: any }>;
  listEmpresas(req: Request): Promise<{ status: number; body: any }>;
  getEmpresa(req: Request): Promise<{ status: number; body: any }>;
  createEmpresa(req: Request): Promise<{ status: number; body: any }>;
  patchEmpresa(req: Request): Promise<{ status: number; body: any }>;
  deleteEmpresa(req: Request): Promise<{ status: number; body: any }>;
  listProjetos(req: Request): Promise<{ status: number; body: any }>;
  getProjeto(req: Request): Promise<{ status: number; body: any }>;
  createProjeto(req: Request): Promise<{ status: number; body: any }>;
  patchProjeto(req: Request): Promise<{ status: number; body: any }>;
  deleteProjeto(req: Request): Promise<{ status: number; body: any }>;
  matchProjetoEditais(req: Request): Promise<{ status: number; body: any }>;
  /** status 0 = resposta já enviada via stream NDJSON */
  gerarPropostaFromProjeto(req: Request, res?: Response): Promise<{ status: number; body: any }>;
};

function normalizeUserType(raw: unknown): "pesquisador" | "consultor" {
  const t = String(raw || "pesquisador");
  if (t === "consultor" || t === "pessoa-empresa" || t === "ambos") return "consultor";
  return "pesquisador";
}

export function buildAppDataUseCases(deps: {
  config: AppConfig;
  supabase: SupabaseGateway;
  auth: AuthUseCases;
}): AppDataUseCases {
  const guardDeps = {
    supabase: deps.supabase,
    auth: deps.auth,
    enforce: deps.config.subscriptionEnforce,
  };

  return {
    async listEditais(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };

      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
      const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10) || 0);
      const q = String(req.query.q || "").trim();
      const fonte = String(req.query.fonte || "").trim();
      const status = String(req.query.status || "").trim();
      const ativo = String(req.query.ativo || "").trim();

      try {
        const { count, rows } = await deps.supabase.adminListEditais({
          limit,
          offset,
          q: q || undefined,
          fonte: fonte || undefined,
          status: status || undefined,
          ativo: ativo || undefined,
        });

        const catalogTotal = count ?? rows.length;
        const previewEditalIds =
          loaded.ctx.tier === "free" && guardDeps.enforce !== false
            ? rows.slice(0, FREE_EDITAIS_PER_MONTH).map((r: { id: string }) => String(r.id))
            : [];

        return {
          status: 200,
          body: {
            count: catalogTotal,
            limit,
            offset,
            rows,
            preview_edital_ids: previewEditalIds,
            catalog_locked_count:
              loaded.ctx.tier === "free" && guardDeps.enforce !== false
                ? Math.max(0, catalogTotal - FREE_EDITAIS_PER_MONTH)
                : 0,
            entitlements: loaded.ctx.entitlements,
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao carregar editais";
        const status = msg.includes("SUPABASE_SERVICE_ROLE_KEY") ? 503 : 500;
        return { status, body: { error: msg } };
      }
    },

    async getEdital(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };

      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };

      // Plano gratuito: detalhes liberados (upsell fica no dashboard); Pro segue normal.
      const row = await deps.supabase.adminGetEditalById(id);
      return row
        ? { status: 200, body: { row, entitlements: loaded.ctx.entitlements } }
        : { status: 404, body: { error: "Não encontrado" } };
    },

    async listPropostas(req) {
      const loaded = await requireProSubscription(req, guardDeps, "propostas");
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const editalId = String(req.query.edital_id || "").trim() || undefined;
      const empresaId = String(req.query.empresa_id || "").trim() || undefined;
      if (empresaId) {
        const owned = await deps.supabase.getEmpresaForUser(loaded.ctx.userId, empresaId);
        if (!owned) return { status: 400, body: { error: "empresa_id inválido ou sem permissão" } };
      }
      const { count, rows } = await deps.supabase.adminListPropostas({
        limit: editalId ? 1 : 200,
        offset: 0,
        userId: loaded.ctx.userId,
        editalId,
        empresaId,
      });
      return { status: 200, body: { count, rows } };
    },

    async getProposta(req) {
      const loaded = await requireProSubscription(req, guardDeps, "propostas");
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      const row = await deps.supabase.getPropostaForUser(loaded.ctx.userId, id);
      return row ? { status: 200, body: { row } } : { status: 404, body: { error: "Não encontrado" } };
    },

    async createProposta(req) {
      const loaded = await requireProSubscription(req, guardDeps, "propostas");
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const editalId = String((req as any).body?.edital_id || (req as any).body?.editalId || "").trim();
      if (!editalId) return { status: 400, body: { error: "edital_id obrigatório" } };
      const campos = (req as any).body?.campos_formulario ?? (req as any).body?.camposIniciais ?? {};
      const gerado = Boolean((req as any).body?.gerado_com_ia ?? false);
      const projetoIdRaw = (req as any).body?.projeto_id ?? (req as any).body?.projetoId ?? null;
      const projetoId = projetoIdRaw ? String(projetoIdRaw).trim() : null;
      let empresaIdRaw = (req as any).body?.empresa_id ?? (req as any).body?.empresaId ?? null;
      let empresaId = empresaIdRaw ? String(empresaIdRaw).trim() : null;
      const userType = normalizeUserType(loaded.ctx.profile?.user_type);

      if (gerado && guardDeps.enforce !== false) {
        const ai = await requireProSubscription(req, guardDeps, "ai_proposal");
        if (!ai.ok) return { status: ai.status, body: ai.body };
      }
      if (projetoId) {
        const projeto = await deps.supabase.getProjetoForUser(loaded.ctx.userId, projetoId);
        if (!projeto) return { status: 400, body: { error: "projeto_id inválido ou sem permissão" } };
        if (!empresaId && projeto.empresa_id) empresaId = String(projeto.empresa_id);
      }
      if (userType === "consultor" && !empresaId) {
        return { status: 400, body: { error: "empresa_id obrigatório para consultor" } };
      }
      if (userType === "pesquisador") empresaId = null;
      if (empresaId) {
        const owned = await deps.supabase.getEmpresaForUser(loaded.ctx.userId, empresaId);
        if (!owned) return { status: 400, body: { error: "empresa_id inválido ou sem permissão" } };
      }
      try {
        const row = await deps.supabase.createProposta({
          userId: loaded.ctx.userId,
          editalId,
          campos_formulario: campos,
          gerado_com_ia: gerado,
          projetoId,
          empresaId,
        });
        return { status: 200, body: { row } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao criar proposta";
        const status = /empresa_id|projeto_id/i.test(msg) ? 400 : 500;
        return { status, body: { error: msg } };
      }
    },

    async patchProposta(req) {
      const loaded = await requireProSubscription(req, guardDeps, "propostas");
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      const patch = (req as any).body || {};
      const row = await deps.supabase.updatePropostaForUser(loaded.ctx.userId, id, patch);
      return { status: 200, body: { row } };
    },

    async deleteProposta(req) {
      const loaded = await requireProSubscription(req, guardDeps, "propostas");
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      await deps.supabase.deletePropostaForUser(loaded.ctx.userId, id);
      return { status: 200, body: { ok: true } };
    },

    async refreshIndicacoes(req) {
      const loaded = await requireProSubscription(req, guardDeps, "indicacoes");
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const limit = Math.min(50, Math.max(1, Number((req as any).body?.limit ?? 20)));
      const empresaIdRaw = (req as any).body?.empresa_id ?? (req as any).body?.empresaId ?? null;
      const empresaId = empresaIdRaw ? String(empresaIdRaw).trim() : null;
      const userType = normalizeUserType(loaded.ctx.profile?.user_type);
      if (userType === "consultor" && !empresaId) {
        return { status: 400, body: { error: "empresa_id obrigatório para consultor" } };
      }
      try {
        const n = await deps.supabase.refreshMyIndicacoes(
          loaded.ctx.userId,
          limit,
          userType === "pesquisador" ? null : empresaId,
        );
        return { status: 200, body: { refreshed: n } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao atualizar indicações";
        const status = /empresa_id/i.test(msg) ? 400 : 500;
        return { status, body: { error: msg } };
      }
    },

    async fetchIndicacoes(req) {
      const loaded = await requireProSubscription(req, guardDeps, "indicacoes");
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20));
      const empresaId = String(req.query.empresa_id || "").trim() || null;
      const userType = normalizeUserType(loaded.ctx.profile?.user_type);
      if (userType === "consultor" && !empresaId) {
        return { status: 400, body: { error: "empresa_id obrigatório para consultor" } };
      }
      try {
        const rows = await deps.supabase.fetchMyIndicacoes(
          loaded.ctx.userId,
          limit,
          userType === "pesquisador" ? null : empresaId,
        );
        return { status: 200, body: { rows } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao listar indicações";
        return { status: 500, body: { error: msg } };
      }
    },

    async getProfile(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      return {
        status: 200,
        body: { row: loaded.ctx.profile, entitlements: loaded.ctx.entitlements },
      };
    },

    async patchProfile(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const patch = { ...((req as any).body || {}) };
      if (patch.user_type !== undefined) {
        patch.user_type = normalizeUserType(patch.user_type);
      }
      const row = await deps.supabase.updateProfile(loaded.ctx.userId, patch);
      return { status: 200, body: { row } };
    },

    async referralStats(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const row = await deps.supabase.getReferralStats(loaded.ctx.userId);
      return { status: 200, body: row };
    },

    async editalChat(req) {
      const loaded = await requireProSubscription(req, guardDeps, "edital_chat");
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      try {
        return await handleEditalChat(req, deps);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: 502, body: { error: msg } };
      }
    },

    async publicCatalogStats() {
      try {
        const stats = await deps.supabase.getPublicCatalogStats();
        return { status: 200, body: stats };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao carregar estatísticas do catálogo";
        const status = msg.includes("SUPABASE_SERVICE_ROLE_KEY") ? 503 : 500;
        return { status, body: { error: msg } };
      }
    },

    async listEmpresas(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      if (normalizeUserType(loaded.ctx.profile?.user_type) !== "consultor") {
        return { status: 403, body: { error: "Apenas consultores gerenciam empresas" } };
      }
      try {
        const rows = await deps.supabase.listEmpresasForUser(loaded.ctx.userId);
        return { status: 200, body: { rows } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao listar empresas";
        return { status: 500, body: { error: msg } };
      }
    },

    async getEmpresa(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      if (normalizeUserType(loaded.ctx.profile?.user_type) !== "consultor") {
        return { status: 403, body: { error: "Apenas consultores gerenciam empresas" } };
      }
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      const row = await deps.supabase.getEmpresaForUser(loaded.ctx.userId, id);
      return row ? { status: 200, body: { row } } : { status: 404, body: { error: "Não encontrado" } };
    },

    async createEmpresa(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      if (normalizeUserType(loaded.ctx.profile?.user_type) !== "consultor") {
        return { status: 403, body: { error: "Apenas consultores gerenciam empresas" } };
      }
      const body = (req as any).body || {};
      const razao = String(body.razao_social || body.razaoSocial || "").trim();
      if (!razao) return { status: 400, body: { error: "razao_social obrigatória" } };
      try {
        const row = await deps.supabase.createEmpresa({
          userId: loaded.ctx.userId,
          razao_social: razao,
          nome_fantasia: body.nome_fantasia ?? body.nomeFantasia ?? null,
          cnpj: body.cnpj ?? null,
          area: body.area ?? null,
          dados: body.dados && typeof body.dados === "object" ? body.dados : {},
        });
        return { status: 200, body: { row } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao criar empresa";
        return { status: 500, body: { error: msg } };
      }
    },

    async patchEmpresa(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      if (normalizeUserType(loaded.ctx.profile?.user_type) !== "consultor") {
        return { status: 403, body: { error: "Apenas consultores gerenciam empresas" } };
      }
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      try {
        const row = await deps.supabase.updateEmpresaForUser(loaded.ctx.userId, id, (req as any).body || {});
        return { status: 200, body: { row } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao atualizar empresa";
        return { status: 500, body: { error: msg } };
      }
    },

    async deleteEmpresa(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      if (normalizeUserType(loaded.ctx.profile?.user_type) !== "consultor") {
        return { status: 403, body: { error: "Apenas consultores gerenciam empresas" } };
      }
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      try {
        await deps.supabase.deleteEmpresaForUser(loaded.ctx.userId, id);
        return { status: 200, body: { ok: true } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao excluir empresa";
        return { status: 500, body: { error: msg } };
      }
    },

    async listProjetos(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const empresaId = String(req.query.empresa_id || "").trim() || undefined;
      try {
        const rows = await deps.supabase.listProjetosForUser(loaded.ctx.userId, empresaId);
        return { status: 200, body: { rows } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao listar projetos";
        return { status: 500, body: { error: msg } };
      }
    },

    async getProjeto(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      const row = await deps.supabase.getProjetoForUser(loaded.ctx.userId, id);
      return row ? { status: 200, body: { row } } : { status: 404, body: { error: "Não encontrado" } };
    },

    async createProjeto(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const body = (req as any).body || {};
      const titulo = String(body.titulo || "").trim();
      if (!titulo) return { status: 400, body: { error: "titulo obrigatório" } };

      const userType = normalizeUserType(loaded.ctx.profile?.user_type);
      let empresaId = body.empresa_id ?? body.empresaId ?? null;
      if (userType === "pesquisador") {
        empresaId = null;
      } else if (userType === "consultor") {
        empresaId = empresaId ? String(empresaId).trim() : "";
        if (!empresaId) {
          return { status: 400, body: { error: "empresa_id obrigatório para consultor" } };
        }
      } else if (empresaId) {
        empresaId = String(empresaId).trim();
      }

      try {
        const row = await deps.supabase.createProjeto({
          userId: loaded.ctx.userId,
          titulo,
          resumo: body.resumo ?? null,
          objetivos: body.objetivos ?? null,
          area: body.area ?? null,
          publico_alvo: body.publico_alvo ?? body.publicoAlvo ?? (userType === "pesquisador" ? "pesquisador" : "empresa"),
          status: body.status ?? "rascunho",
          empresa_id: empresaId,
          conteudo: body.conteudo && typeof body.conteudo === "object" ? body.conteudo : {},
        });
        return { status: 200, body: { row } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao criar projeto";
        const status = /empresa_id/i.test(msg) ? 400 : 500;
        return { status, body: { error: msg } };
      }
    },

    async patchProjeto(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      const patch = { ...((req as any).body || {}) };
      if (normalizeUserType(loaded.ctx.profile?.user_type) === "pesquisador") {
        patch.empresa_id = null;
      }
      try {
        const row = await deps.supabase.updateProjetoForUser(loaded.ctx.userId, id, patch);
        return { status: 200, body: { row } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao atualizar projeto";
        const status = /inválido|permissão/i.test(msg) ? 400 : 500;
        return { status, body: { error: msg } };
      }
    },

    async deleteProjeto(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      try {
        await deps.supabase.deleteProjetoForUser(loaded.ctx.userId, id);
        return { status: 200, body: { ok: true } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao excluir projeto";
        return { status: 500, body: { error: msg } };
      }
    },

    async matchProjetoEditais(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20));
      try {
        const rows = await deps.supabase.matchEditaisForProjeto(loaded.ctx.userId, id, limit);
        return { status: 200, body: { rows } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao buscar editais";
        const status = /não encontrado/i.test(msg) ? 404 : 500;
        return { status, body: { error: msg } };
      }
    },

    async gerarPropostaFromProjeto(req, res) {
      const loaded = await requireProSubscription(req, guardDeps, "propostas");
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const ai = await requireProSubscription(req, guardDeps, "ai_proposal");
      if (!ai.ok) return { status: ai.status, body: ai.body };

      const projetoId = String(req.params.id || "").trim();
      const editalId = String((req as any).body?.edital_id || (req as any).body?.editalId || "").trim();
      const force = Boolean((req as any).body?.force);
      const stream = Boolean((req as any).body?.stream) && !!res;
      if (!projetoId) return { status: 400, body: { error: "id do projeto inválido" } };
      if (!editalId) return { status: 400, body: { error: "edital_id obrigatório" } };

      const writeNdjson = (obj: Record<string, unknown>) => {
        if (!res || res.writableEnded) return;
        res.write(`${JSON.stringify(obj)}\n`);
      };

      if (stream && res) {
        res.status(200);
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("X-Accel-Buffering", "no");
        if (typeof (res as any).flushHeaders === "function") (res as any).flushHeaders();
        writeNdjson({ type: "start", total: getAdaptFieldsTotal() });
      }

      const projeto = await deps.supabase.getProjetoForUser(loaded.ctx.userId, projetoId);
      if (!projeto) {
        if (stream) {
          writeNdjson({ type: "error", error: "Projeto não encontrado" });
          res!.end();
          return { status: 0, body: null };
        }
        return { status: 404, body: { error: "Projeto não encontrado" } };
      }

      const existing = await deps.supabase.adminListPropostas({
        limit: 1,
        offset: 0,
        userId: loaded.ctx.userId,
        editalId,
      });
      const existingMeta = existing.rows?.[0] || null;
      const existingRow = existingMeta
        ? await deps.supabase.getPropostaForUser(loaded.ctx.userId, String(existingMeta.id))
        : null;

      if (existingRow && !force) {
        const campos = (existingRow as any).campos_formulario || {};
        const d = campos?.detalhamento_projeto || {};
        const narrativeFilled = [
          d.resumo_publicavel,
          d.caracterizacao_problema,
          d.objetivo_geral,
          d.detalhamento_projeto,
          d.beneficios_resultados_esperados,
        ].filter((t) => String(t || "").trim().length > 40).length;
        if (narrativeFilled >= 3 && (existingRow as any).gerado_com_ia) {
          const body = {
            row: existingRow,
            created: false,
            adapted: false,
            message: "Já existe proposta adaptada para este edital; abra para revisar.",
          };
          if (stream) {
            writeNdjson({ type: "done", ...body });
            res!.end();
            return { status: 0, body: null };
          }
          return { status: 200, body };
        }
      }

      try {
        const seed = seedCamposFromProjeto(projeto);
        const adapted = await adaptCamposWithAi({
          config: deps.config,
          supabase: deps.supabase,
          projeto,
          editalId,
          seed,
          onProgress: stream
            ? async (p) => {
                writeNdjson({
                  type: "progress",
                  current: p.current,
                  total: p.total,
                  field: p.field,
                });
              }
            : undefined,
        });

        let row: any;
        let created = false;
        if (existingRow) {
          row = await deps.supabase.updatePropostaForUser(loaded.ctx.userId, String(existingRow.id), {
            campos_formulario: adapted.campos,
            projeto_id: projetoId,
            gerado_com_ia: true,
            status: "em_redacao",
            progresso: Math.min(85, 20 + adapted.fieldsAdapted.length * 4),
            proxima_etapa: "Revisar seções adaptadas pela IA ao edital",
          });
        } else {
          row = await deps.supabase.createProposta({
            userId: loaded.ctx.userId,
            editalId,
            campos_formulario: adapted.campos,
            gerado_com_ia: true,
            projetoId,
            empresaId: projeto.empresa_id ? String(projeto.empresa_id) : null,
          });
          created = true;
          row = await deps.supabase.updatePropostaForUser(loaded.ctx.userId, String(row.id), {
            status: "em_redacao",
            progresso: Math.min(85, 20 + adapted.fieldsAdapted.length * 4),
            proxima_etapa: "Revisar seções adaptadas pela IA ao edital",
          });
        }

        const full = await deps.supabase.getPropostaForUser(loaded.ctx.userId, String(row.id));
        const body = {
          row: full || row,
          created,
          adapted: true,
          fields_adapted: adapted.fieldsAdapted,
          fields_failed: adapted.fieldsFailed,
        };
        if (stream) {
          writeNdjson({ type: "done", ...body });
          res!.end();
          return { status: 0, body: null };
        }
        return { status: 200, body };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao gerar proposta a partir do projeto";
        const status = isOllamaConnectionError(e) ? 503 : 500;
        if (stream) {
          writeNdjson({ type: "error", error: msg });
          res!.end();
          return { status: 0, body: null };
        }
        return { status, body: { error: msg } };
      }
    },
  };
}

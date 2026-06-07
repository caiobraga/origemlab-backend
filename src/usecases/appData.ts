import type { Request } from "express";
import type { AppConfig } from "../config.js";
import type { SupabaseGateway } from "../infra/gateways.js";
import type { AuthUseCases } from "./auth.js";
import { handleEditalChat } from "./editalChat.js";
import {
  FREE_EDITAIS_PER_MONTH,
  applyFreeCatalogListLimit,
  canAccessEditalCatalog,
  subscriptionLimitBody,
} from "../lib/subscriptionEntitlements.js";
import { loadSubscriptionContext, requireProSubscription } from "./subscriptionGuard.js";

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
};

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
      const { count, rows } = await deps.supabase.adminListEditais({
        limit,
        offset,
        q: q || undefined,
        fonte: fonte || undefined,
        status: status || undefined,
        ativo: ativo || undefined,
      });

      let visibleRows = rows;
      const catalogTotal = count ?? rows.length;
      if (loaded.ctx.tier === "free" && guardDeps.enforce !== false) {
        const accessedIds = loaded.ctx.entitlements.usage?.editais_views?.accessed_ids ?? [];
        visibleRows = applyFreeCatalogListLimit(rows, accessedIds);
      }

      return {
        status: 200,
        body: {
          count: catalogTotal,
          limit,
          offset,
          rows: visibleRows,
          catalog_locked_count:
            loaded.ctx.tier === "free" && guardDeps.enforce !== false
              ? Math.max(0, catalogTotal - visibleRows.length)
              : 0,
          entitlements: loaded.ctx.entitlements,
        },
      };
    },

    async getEdital(req) {
      const loaded = await loadSubscriptionContext(req, guardDeps);
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };

      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };

      if (loaded.ctx.tier === "free" && guardDeps.enforce !== false) {
        const usage = loaded.ctx.entitlements.usage?.editais_views;
        if (!canAccessEditalCatalog(loaded.ctx.tier, id, usage)) {
          return {
            status: 403,
            body: subscriptionLimitBody(usage?.used ?? FREE_EDITAIS_PER_MONTH, usage?.limit ?? FREE_EDITAIS_PER_MONTH),
          };
        }

        const access = await deps.supabase.recordEditalCatalogAccess(
          loaded.ctx.userId,
          id,
          FREE_EDITAIS_PER_MONTH,
        );
        if (!access.allowed) {
          return {
            status: 403,
            body: subscriptionLimitBody(access.used, access.limit),
          };
        }
        loaded.ctx.entitlements = {
          ...loaded.ctx.entitlements,
          usage: {
            editais_views: {
              used: access.used,
              limit: access.limit,
              accessed_ids: access.accessedIds,
            },
          },
        };
      }

      const row = await deps.supabase.adminGetEditalById(id);
      return row
        ? { status: 200, body: { row, entitlements: loaded.ctx.entitlements } }
        : { status: 404, body: { error: "Não encontrado" } };
    },

    async listPropostas(req) {
      const loaded = await requireProSubscription(req, guardDeps, "propostas");
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const { count, rows } = await deps.supabase.adminListPropostas({
        limit: 200,
        offset: 0,
        userId: loaded.ctx.userId,
      });
      return { status: 200, body: { count, rows } };
    },

    async getProposta(req) {
      const loaded = await requireProSubscription(req, guardDeps, "propostas");
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      const { rows } = await deps.supabase.adminListPropostas({
        limit: 1,
        offset: 0,
        userId: loaded.ctx.userId,
      });
      const row = (rows as any[]).find((r) => (r as any).id === id) || null;
      return row ? { status: 200, body: { row } } : { status: 404, body: { error: "Não encontrado" } };
    },

    async createProposta(req) {
      const loaded = await requireProSubscription(req, guardDeps, "propostas");
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const editalId = String((req as any).body?.edital_id || (req as any).body?.editalId || "").trim();
      if (!editalId) return { status: 400, body: { error: "edital_id obrigatório" } };
      const campos = (req as any).body?.campos_formulario ?? (req as any).body?.camposIniciais ?? {};
      const gerado = Boolean((req as any).body?.gerado_com_ia ?? false);
      if (gerado && guardDeps.enforce !== false) {
        const ai = await requireProSubscription(req, guardDeps, "ai_proposal");
        if (!ai.ok) return { status: ai.status, body: ai.body };
      }
      const row = await deps.supabase.createProposta({
        userId: loaded.ctx.userId,
        editalId,
        campos_formulario: campos,
        gerado_com_ia: gerado,
      });
      return { status: 200, body: { row } };
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
      const n = await deps.supabase.refreshMyIndicacoes(loaded.ctx.userId, limit);
      return { status: 200, body: { refreshed: n } };
    },

    async fetchIndicacoes(req) {
      const loaded = await requireProSubscription(req, guardDeps, "indicacoes");
      if (!loaded.ok) return { status: loaded.status, body: loaded.body };
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20));
      const rows = await deps.supabase.fetchMyIndicacoes(loaded.ctx.userId, limit);
      return { status: 200, body: { rows } };
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
      const patch = (req as any).body || {};
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
  };
}

import type { Request } from "express";
import type { AppConfig } from "../config.js";
import type { SupabaseGateway } from "../infra/gateways.js";
import type { AuthUseCases } from "./auth.js";

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
};

export function buildAppDataUseCases(deps: {
  config: AppConfig;
  supabase: SupabaseGateway;
  auth: AuthUseCases;
}): AppDataUseCases {
  async function sessionUserId(req: Request): Promise<string | null> {
    try {
      return await deps.auth.requireSessionUserId(req);
    } catch {
      return null;
    }
  }

  return {
    async listEditais(req) {
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
      return { status: 200, body: { count, limit, offset, rows } };
    },

    async getEdital(req) {
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      // Reuse adminListEditais with filter
      const { rows } = await deps.supabase.adminListEditais({ limit: 1, offset: 0, q: undefined, fonte: undefined, status: undefined, ativo: "" });
      const row = (rows as any[]).find((r) => (r as any).id === id) || null;
      return row ? { status: 200, body: { row } } : { status: 404, body: { error: "Não encontrado" } };
    },

    async listPropostas(req) {
      const userId = await sessionUserId(req);
      if (!userId) return { status: 401, body: { error: "unauthenticated" } };
      const { count, rows } = await deps.supabase.adminListPropostas({ limit: 200, offset: 0, userId });
      return { status: 200, body: { count, rows } };
    },

    async getProposta(req) {
      const userId = await sessionUserId(req);
      if (!userId) return { status: 401, body: { error: "unauthenticated" } };
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      const { rows } = await deps.supabase.adminListPropostas({ limit: 1, offset: 0, userId });
      const row = (rows as any[]).find((r) => (r as any).id === id) || null;
      return row ? { status: 200, body: { row } } : { status: 404, body: { error: "Não encontrado" } };
    },

    async createProposta(req) {
      const userId = await sessionUserId(req);
      if (!userId) return { status: 401, body: { error: "unauthenticated" } };
      const editalId = String((req as any).body?.edital_id || (req as any).body?.editalId || "").trim();
      if (!editalId) return { status: 400, body: { error: "edital_id obrigatório" } };
      const campos = (req as any).body?.campos_formulario ?? (req as any).body?.camposIniciais ?? {};
      const gerado = Boolean((req as any).body?.gerado_com_ia ?? false);
      const row = await deps.supabase.createProposta({
        userId,
        editalId,
        campos_formulario: campos,
        gerado_com_ia: gerado,
      });
      return { status: 200, body: { row } };
    },

    async patchProposta(req) {
      const userId = await sessionUserId(req);
      if (!userId) return { status: 401, body: { error: "unauthenticated" } };
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      const patch = (req as any).body || {};
      const row = await deps.supabase.updatePropostaForUser(userId, id, patch);
      return { status: 200, body: { row } };
    },

    async deleteProposta(req) {
      const userId = await sessionUserId(req);
      if (!userId) return { status: 401, body: { error: "unauthenticated" } };
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      await deps.supabase.deletePropostaForUser(userId, id);
      return { status: 200, body: { ok: true } };
    },

    async refreshIndicacoes(req) {
      const userId = await sessionUserId(req);
      if (!userId) return { status: 401, body: { error: "unauthenticated" } };
      const limit = Math.min(50, Math.max(1, Number((req as any).body?.limit ?? 20)));
      const n = await deps.supabase.refreshMyIndicacoes(userId, limit);
      return { status: 200, body: { refreshed: n } };
    },

    async fetchIndicacoes(req) {
      const userId = await sessionUserId(req);
      if (!userId) return { status: 401, body: { error: "unauthenticated" } };
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20));
      const rows = await deps.supabase.fetchMyIndicacoes(userId, limit);
      return { status: 200, body: { rows } };
    },

    async getProfile(req) {
      const userId = await sessionUserId(req);
      if (!userId) return { status: 401, body: { error: "unauthenticated" } };
      const row = await deps.supabase.getProfile(userId);
      return { status: 200, body: { row } };
    },

    async patchProfile(req) {
      const userId = await sessionUserId(req);
      if (!userId) return { status: 401, body: { error: "unauthenticated" } };
      const patch = (req as any).body || {};
      const row = await deps.supabase.updateProfile(userId, patch);
      return { status: 200, body: { row } };
    },

    async referralStats(req) {
      const userId = await sessionUserId(req);
      if (!userId) return { status: 401, body: { error: "unauthenticated" } };
      const row = await deps.supabase.getReferralStats(userId);
      return { status: 200, body: row };
    },
  };
}


import type { Request } from "express";
import type { AppConfig } from "../config.js";
import type { StripeGateway, SupabaseGateway } from "../infra/gateways.js";
import { HttpError } from "../http/errors.js";
import { getBearerToken } from "../http/auth.js";

async function assertAdmin(supabase: SupabaseGateway, req: Request) {
  const token = getBearerToken(req);
  if (!token) throw new HttpError(401, "Faça login.");
  const user = await supabase.getUserFromAccessToken(token);
  if (!user) throw new HttpError(401, "Sessão inválida.");
  if (!supabase.isConfigured) throw new HttpError(503, "Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
  const isAdmin = await supabase.profileIsAdmin(user.id);
  if (!isAdmin) throw new HttpError(403, "Acesso negado (admin).");
  return { user };
}

export type AdminUseCases = {
  listUsers(req: Request): Promise<{ status: number; body: any }>;
  patchUser(req: Request): Promise<{ status: number; body: any }>;
  listBillingPlans(req: Request): Promise<{ status: number; body: any }>;
  upsertBillingPlan(req: Request): Promise<{ status: number; body: any }>;
  listPropostas(req: Request): Promise<{ status: number; body: any }>;
  updateProposta(req: Request): Promise<{ status: number; body: any }>;
  listEditais(req: Request): Promise<{ status: number; body: any }>;
  updateEdital(req: Request): Promise<{ status: number; body: any }>;
  listRedacoes(req: Request): Promise<{ status: number; body: any }>;
  updateRedacaoStatus(req: Request): Promise<{ status: number; body: any }>;
};

export function buildAdminUseCases(deps: { config: AppConfig; stripe: StripeGateway; supabase: SupabaseGateway }): AdminUseCases {
  return {
    async listUsers(req) {
      await assertAdmin(deps.supabase, req);

      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
      const perPage = Math.min(200, Math.max(1, parseInt(String(req.query.perPage || "50"), 10) || 50));

      const { users: authUsers } = await deps.supabase.adminListUsers({ page, perPage });
      const userIds = (authUsers || []).map((u: any) => u.id);
      const profiles = userIds.length ? await deps.supabase.profilesByUserIds(userIds) : [];
      const byUser = new Map((profiles || []).map((p: any) => [p.user_id, p]));

      const users = (authUsers || []).map((u: any) => {
        const p = byUser.get(u.id) || null;
        return {
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          email_confirmed_at: u.email_confirmed_at,
          banned_until: u.banned_until ?? null,
          is_admin: p?.is_admin ?? false,
          is_blocked: p?.is_blocked ?? false,
          user_type: p?.user_type ?? null,
          has_cnpj: p?.has_cnpj ?? null,
          cnpj: p?.cnpj ?? null,
          lattes_id: p?.lattes_id ?? null,
          profile_created_at: p?.criado_em ?? null,
          subscription_plan_key: p?.subscription_plan_key ?? null,
          subscription_status: p?.subscription_status ?? null,
        };
      });

      return { status: 200, body: { page, perPage, users } };
    },

    async patchUser(req) {
      await assertAdmin(deps.supabase, req);

      const userId = String(req.params.userId || "").trim();
      if (!userId) return { status: 400, body: { error: "userId inválido" } };

      const is_admin = (req as any).body?.is_admin;
      const is_blocked = (req as any).body?.is_blocked;
      if (is_admin === undefined && is_blocked === undefined) {
        return { status: 400, body: { error: "Envie is_admin e/ou is_blocked" } };
      }

      const profile = await deps.supabase.upsertProfileFlags(userId, {
        is_admin: is_admin === undefined ? undefined : Boolean(is_admin),
        is_blocked: is_blocked === undefined ? undefined : Boolean(is_blocked),
      });

      return { status: 200, body: { profile } };
    },

    async listBillingPlans(req) {
      await assertAdmin(deps.supabase, req);
      const rows = await deps.supabase.listBillingPlans();
      return { status: 200, body: { rows: rows || [] } };
    },

    async upsertBillingPlan(req) {
      await assertAdmin(deps.supabase, req);

      const planKey = String(req.params.planKey || "").trim().toLowerCase();
      if (!planKey) return { status: 400, body: { error: "planKey inválido" } };

      const title = String((req as any).body?.title || "").trim();
      const currency = String((req as any).body?.currency || "brl").trim().toLowerCase();
      const interval = String((req as any).body?.interval || "month").trim().toLowerCase();
      const unitAmountCents = Number((req as any).body?.unit_amount_cents);
      const active = (req as any).body?.active === undefined ? true : Boolean((req as any).body?.active);

      if (!title) return { status: 400, body: { error: "title obrigatório" } };
      if (!/^[a-z]{3}$/.test(currency)) return { status: 400, body: { error: "currency inválida" } };
      if (interval !== "month") return { status: 400, body: { error: "interval inválido (use month)" } };
      if (!Number.isFinite(unitAmountCents) || unitAmountCents <= 0) {
        return { status: 400, body: { error: "unit_amount_cents inválido" } };
      }

      const stripeKey =
        deps.config.stripe.secretKey;
      if (!stripeKey) {
        return { status: 503, body: { error: "Stripe não configurado (AISELFIE_STRIPE_SECRET_KEY)" } };
      }

      const existing = await deps.supabase.getBillingPlan(planKey);

      const productId = await deps.stripe.createOrUpdateProduct({
        existingProductId: existing?.stripe_product_id ?? null,
        title,
        planKey,
      });

      const priceId = await deps.stripe.createPrice({
        productId,
        currency,
        unitAmountCents: Math.round(unitAmountCents),
        planKey,
      });

      const prevPriceId: string | null = existing?.stripe_price_id ?? null;
      if (prevPriceId && prevPriceId !== priceId) {
        await deps.stripe.deactivatePrice(prevPriceId);
      }

      const row: any = {
        plan_key: planKey,
        title,
        currency,
        interval: "month",
        unit_amount_cents: Math.round(unitAmountCents),
        stripe_product_id: productId,
        stripe_price_id: priceId,
        active,
        updated_at: new Date().toISOString(),
      };

      const saved = await deps.supabase.upsertBillingPlan(row);
      return { status: 200, body: { row: saved, stripe: { product_id: productId, price_id: priceId } } };
    },

    async listPropostas(req) {
      await assertAdmin(deps.supabase, req);
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
      const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10) || 0);
      const status = String(req.query.status || "").trim();
      const userId = String(req.query.userId || "").trim();
      const editalId = String(req.query.editalId || "").trim();

      const { count, rows } = await deps.supabase.adminListPropostas({
        limit,
        offset,
        status: status || undefined,
        userId: userId || undefined,
        editalId: editalId || undefined,
      });
      return { status: 200, body: { count, limit, offset, rows } };
    },

    async updateProposta(req) {
      await assertAdmin(deps.supabase, req);
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };

      const status = (req as any).body?.status != null ? String((req as any).body.status).trim() : null;
      const progresso = (req as any).body?.progresso != null ? Number((req as any).body.progresso) : null;

      const allowedStatuses = ["rascunho", "em_redacao", "revisao", "submetida", "aprovada", "rejeitada"];
      if (status != null && !allowedStatuses.includes(status)) {
        return { status: 400, body: { error: "status inválido" } };
      }
      if (progresso != null && (!Number.isFinite(progresso) || progresso < 0 || progresso > 100)) {
        return { status: 400, body: { error: "progresso inválido" } };
      }
      if (status == null && progresso == null) {
        return { status: 400, body: { error: "Envie status e/ou progresso" } };
      }

      const patch: any = {};
      if (status != null) patch.status = status;
      if (progresso != null) patch.progresso = Math.round(progresso);
      const row = await deps.supabase.adminUpdateProposta(id, patch);
      return { status: 200, body: { row } };
    },

    async listEditais(req) {
      await assertAdmin(deps.supabase, req);
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

    async updateEdital(req) {
      await assertAdmin(deps.supabase, req);
      const id = String(req.params.id || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };

      const body = (req as any).body || {};
      const patch: any = {};
      const allowedText = [
        "numero",
        "titulo",
        "descricao",
        "status",
        "valor",
        "valor_projeto",
        "prazo_inscricao",
        "area",
        "orgao",
        "fonte",
        "link",
        "sobre_programa",
        "criterios_elegibilidade",
      ];
      for (const k of allowedText) {
        if (body[k] !== undefined) patch[k] = body[k] === null ? null : String(body[k]);
      }
      if (body.data_publicacao !== undefined) patch.data_publicacao = body.data_publicacao || null;
      if (body.data_encerramento !== undefined) patch.data_encerramento = body.data_encerramento || null;
      if (body.is_researcher !== undefined) patch.is_researcher = body.is_researcher === null ? null : Boolean(body.is_researcher);
      if (body.is_company !== undefined) patch.is_company = body.is_company === null ? null : Boolean(body.is_company);

      if (Object.keys(patch).length === 0) {
        return { status: 400, body: { error: "Nada para atualizar" } };
      }

      const row = await deps.supabase.adminUpdateEdital(id, patch);
      return { status: 200, body: { row } };
    },

    async listRedacoes(req) {
      await assertAdmin(deps.supabase, req);
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
      const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10) || 0);
      const status = String(req.query.status || "").trim();
      const userId = String(req.query.userId || "").trim();
      const propostaId = String(req.query.propostaId || "").trim();

      const { count, rows } = await deps.supabase.adminListRedacoes({
        limit,
        offset,
        status: status || undefined,
        userId: userId || undefined,
        propostaId: propostaId || undefined,
      });
      return { status: 200, body: { count, limit, offset, rows } };
    },

    async updateRedacaoStatus(req) {
      await assertAdmin(deps.supabase, req);
      const id = String(req.params.id || "").trim();
      const status = String((req as any).body?.status || "").trim();
      if (!id) return { status: 400, body: { error: "id inválido" } };
      if (!status) return { status: 400, body: { error: "status inválido" } };
      const row = await deps.supabase.adminUpdateRedacaoStatus(id, status);
      return { status: 200, body: { row } };
    },
  };
}


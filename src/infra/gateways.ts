import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { AppConfig } from "../config.js";

export type StripeGateway = {
  hasStripe: boolean;
  createCheckoutSession(input: {
    priceId: string;
    userId: string;
    userEmail?: string | null;
    successUrl: string;
    cancelUrl: string;
    planKey: string;
  }): Promise<{ url: string | null }>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  constructWebhookEvent(input: { rawBody: Buffer; signature: string }): Stripe.Event;
  retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  createOrUpdateProduct(input: { existingProductId: string | null; title: string; planKey: string }): Promise<string>;
  createPrice(input: {
    productId: string;
    currency: string;
    unitAmountCents: number;
    planKey: string;
  }): Promise<string>;
  deactivatePrice(priceId: string): Promise<void>;
};

export type SupabaseGateway = {
  isConfigured: boolean;
  getUserFromAccessToken(token: string): Promise<User | null>;
  adminListUsers(input: { page: number; perPage: number }): Promise<{ users: any[] }>;
  profilesByUserIds(userIds: string[]): Promise<any[]>;
  profileIsAdmin(userId: string): Promise<boolean>;
  upsertProfileFlags(userId: string, patch: { is_admin?: boolean; is_blocked?: boolean }): Promise<any>;
  listBillingPlans(): Promise<any[]>;
  upsertBillingPlan(row: any): Promise<any>;
  getBillingPlan(planKey: string): Promise<any | null>;
  getActivePriceIdForPlan(planKey: string): Promise<string | null>;
  getStripeCustomerIdForUser(userId: string): Promise<string | null>;
  updateProfileByUserId(userId: string, patch: Record<string, any>): Promise<void>;
  findUserIdByStripeSubscriptionId(subId: string): Promise<string | null>;
  clearSubscriptionBySubscriptionId(subId: string): Promise<void>;
  adminListPropostas(input: {
    limit: number;
    offset: number;
    status?: string;
    userId?: string;
    editalId?: string;
  }): Promise<{ count: number | null; rows: any[] }>;
  adminUpdateProposta(id: string, patch: { status?: string; progresso?: number }): Promise<any>;
  adminListEditais(input: {
    limit: number;
    offset: number;
    q?: string;
    fonte?: string;
    status?: string;
    ativo?: string;
  }): Promise<{ count: number | null; rows: any[] }>;
  adminUpdateEdital(id: string, patch: Record<string, any>): Promise<any>;
  adminListRedacoes(input: {
    limit: number;
    offset: number;
    status?: string;
    userId?: string;
    propostaId?: string;
  }): Promise<{ count: number | null; rows: any[] }>;
  adminUpdateRedacaoStatus(id: string, status: string): Promise<any>;
};

function createServiceSupabase(config: AppConfig): SupabaseClient | null {
  const url = config.supabase.url;
  const key = config.supabase.serviceRoleKey;
  if (!url || !key) return null;
  return createClient(url, key);
}

export function buildGateways(config: AppConfig): { stripe: StripeGateway; supabase: SupabaseGateway } {
  const supabase = createServiceSupabase(config);

  const stripeKey = config.stripe.secretKey;
  const webhookSecret = config.stripe.webhookSecret;
  const stripe = stripeKey ? new Stripe(stripeKey) : null;

  const stripeGateway: StripeGateway = {
    hasStripe: !!stripe,
    async createCheckoutSession(input) {
      if (!stripe) throw new Error("Stripe not configured");
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.userId,
        customer_email: input.userEmail || undefined,
        metadata: {
          supabase_user_id: input.userId,
          plan_key: input.planKey,
        },
        subscription_data: {
          metadata: {
            supabase_user_id: input.userId,
            plan_key: input.planKey,
          },
        },
      });
      return { url: session.url };
    },
    async createPortalSession(input) {
      if (!stripe) throw new Error("Stripe not configured");
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      return { url: session.url };
    },
    constructWebhookEvent(input) {
      if (!stripe || !webhookSecret) throw new Error("Stripe not configured");
      return stripe.webhooks.constructEvent(input.rawBody, input.signature, webhookSecret);
    },
    async retrieveSubscription(subscriptionId) {
      if (!stripe) throw new Error("Stripe not configured");
      return await stripe.subscriptions.retrieve(subscriptionId);
    },
    async createOrUpdateProduct(input) {
      if (!stripe) throw new Error("Stripe not configured");
      if (!input.existingProductId) {
        const product = await stripe.products.create({
          name: input.title,
          metadata: { plan_key: input.planKey },
        });
        return product.id;
      }
      await stripe.products.update(input.existingProductId, { name: input.title });
      return input.existingProductId;
    },
    async createPrice(input) {
      if (!stripe) throw new Error("Stripe not configured");
      const price = await stripe.prices.create({
        product: input.productId,
        currency: input.currency,
        unit_amount: Math.round(input.unitAmountCents),
        recurring: { interval: "month" },
        nickname: `${input.planKey}:${input.currency}:${input.unitAmountCents}`,
        metadata: { plan_key: input.planKey },
      });
      return price.id;
    },
    async deactivatePrice(priceId) {
      if (!stripe) throw new Error("Stripe not configured");
      try {
        await stripe.prices.update(priceId, { active: false });
      } catch {
        // ignore
      }
    },
  };

  const supabaseGateway: SupabaseGateway = {
    isConfigured: !!supabase,
    async getUserFromAccessToken(token) {
      if (!supabase) return null;
      const { data, error } = await supabase.auth.getUser(token);
      if (error) return null;
      return data.user ?? null;
    },
    async adminListUsers({ page, perPage }) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(error.message);
      return { users: data?.users || [] };
    },
    async profilesByUserIds(userIds) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data } = await supabase
        .from("profiles")
        .select(
          "user_id, is_admin, is_blocked, user_type, has_cnpj, cnpj, lattes_id, criado_em, subscription_plan_key, subscription_status, stripe_customer_id, stripe_subscription_id",
        )
        .in("user_id", userIds);
      return data || [];
    },
    async profileIsAdmin(userId) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(`Erro ao ler perfil admin: ${error.message}`);
      return Boolean((data as any)?.is_admin);
    },
    async upsertProfileFlags(userId, patch) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const row: any = { user_id: userId };
      if (patch.is_admin !== undefined) row.is_admin = Boolean(patch.is_admin);
      if (patch.is_blocked !== undefined) row.is_blocked = Boolean(patch.is_blocked);
      const { data, error } = await supabase
        .from("profiles")
        .upsert(row, { onConflict: "user_id" })
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async listBillingPlans() {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("billing_plans")
        .select("*")
        .order("plan_key", { ascending: true });
      if (error) throw new Error(error.message);
      return data || [];
    },
    async upsertBillingPlan(row) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("billing_plans")
        .upsert(row, { onConflict: "plan_key" })
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async getBillingPlan(planKey) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("billing_plans")
        .select("*")
        .eq("plan_key", planKey)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },
    async getActivePriceIdForPlan(planKey) {
      if (!supabase) return null;
      const { data, error } = await supabase
        .from("billing_plans")
        .select("stripe_price_id")
        .eq("plan_key", planKey)
        .eq("active", true)
        .maybeSingle();
      if (error) return null;
      const id = (data as any)?.stripe_price_id;
      return typeof id === "string" && id.trim() ? id.trim() : null;
    },
    async getStripeCustomerIdForUser(userId) {
      if (!supabase) throw new Error("Supabase service role não configurada");
      const { data, error } = await supabase
        .from("profiles")
        .select("stripe_customer_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return null;
      const id = (data as any)?.stripe_customer_id;
      return typeof id === "string" && id.trim() ? id.trim() : null;
    },
    async updateProfileByUserId(userId, patch) {
      if (!supabase) throw new Error("Supabase service role not configured");
      const { error } = await supabase.from("profiles").update(patch).eq("user_id", userId);
      if (error) throw error;
    },
    async findUserIdByStripeSubscriptionId(subId) {
      if (!supabase) return null;
      const { data } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("stripe_subscription_id", subId)
        .maybeSingle();
      const userId = (data as any)?.user_id;
      return typeof userId === "string" && userId.trim() ? userId : null;
    },
    async clearSubscriptionBySubscriptionId(subId) {
      if (!supabase) throw new Error("Supabase service role not configured");
      const { error } = await supabase
        .from("profiles")
        .update({
          subscription_status: "canceled",
          stripe_subscription_id: null,
          subscription_price_id: null,
          subscription_current_period_end: null,
          subscription_plan_key: null,
        })
        .eq("stripe_subscription_id", subId);
      if (error) throw error;
    },

    async adminListPropostas({ limit, offset, status, userId, editalId }) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      let q = supabase
        .from("propostas")
        .select("id,user_id,edital_id,status,progresso,gerado_com_ia,criado_em,atualizado_em", { count: "exact" })
        .order("atualizado_em", { ascending: false });
      if (status) q = q.eq("status", status);
      if (userId) q = q.eq("user_id", userId);
      if (editalId) q = q.eq("edital_id", editalId);
      q = q.range(offset, offset + limit - 1);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { count: count ?? null, rows: data || [] };
    },

    async adminUpdateProposta(id, patch) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("propostas")
        .update(patch)
        .eq("id", id)
        .select("id,status,progresso,atualizado_em")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    async adminListEditais({ limit, offset, q: qtext, fonte, status, ativo }) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");

      // Dashboard filtering logic (ported from originlab/server/api/admin.ts)
      const startOfToday = () => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
      };
      const parseDate = (raw: unknown): Date | null => {
        if (raw == null) return null;
        const s = String(raw).trim();
        if (!s || /invalid date/i.test(s)) return null;
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
      };
      const extrairDeadlineSubmissao = (timeline: any): Date | null => {
        if (!timeline) return null;
        const obj =
          typeof timeline === "string"
            ? (() => {
                try {
                  return JSON.parse(timeline);
                } catch {
                  return null;
                }
              })()
            : timeline;
        if (!obj) return null;
        const fases = obj?.fases;
        if (!Array.isArray(fases) || fases.length === 0) return null;
        const withDates = fases
          .map((f: any) => {
            const nome = String(f?.nome || "").toLowerCase();
            const df = parseDate(f?.data_fim) || null;
            return { nome, df };
          })
          .filter((x: any) => x.df);
        if (withDates.length === 0) return null;
        const submissao = withDates.filter(
          (x: any) => x.nome.includes("submiss") || x.nome.includes("propost"),
        );
        const arr = (submissao.length ? submissao : withDates) as Array<{ df: Date }>;
        const max = new Date(Math.max(...arr.map((x) => x.df.getTime())));
        return isNaN(max.getTime()) ? null : max;
      };
      const extrairDataMaisRecentePrazo = (prazo: string | null | undefined): Date | null => {
        if (!prazo || prazo === "Não informado") return null;
        const s = String(prazo);
        const dates: Date[] = [];
        const pushIf = (v: string) => {
          const d = parseDate(v);
          if (d) dates.push(d);
        };
        (s.match(/\d{4}-\d{2}-\d{2}/g) || []).forEach(pushIf);
        (s.match(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}/g) || []).forEach(pushIf);
        (s.match(/\b\d{1,2}\s+de\s+[A-Za-zÀ-ÿçÇ]+\s+de\s+\d{4}\b/gi) || []).forEach(pushIf);
        if (dates.length === 0) return null;
        const max = new Date(Math.max(...dates.map((d) => d.getTime())));
        return isNaN(max.getTime()) ? null : max;
      };
      const isEditalAtivoDashboard = (row: any): boolean => {
        const hoje = startOfToday();
        const dl = extrairDeadlineSubmissao(row.timeline_estimada);
        if (dl) {
          const fim = new Date(dl);
          fim.setHours(23, 59, 59, 999);
          return hoje.getTime() <= fim.getTime();
        }
        const prazoDate = extrairDataMaisRecentePrazo(row.prazo_inscricao || null);
        if (prazoDate) {
          const fim = new Date(prazoDate);
          fim.setHours(23, 59, 59, 999);
          return hoje.getTime() <= fim.getTime();
        }
        if (row.data_encerramento) {
          const d = parseDate(row.data_encerramento);
          if (d) {
            d.setHours(23, 59, 59, 999);
            return hoje.getTime() <= d.getTime();
          }
        }
        const st = String(row.status || "").toLowerCase().trim();
        if (st === "encerrado" || st === "finalizado") return false;
        return true;
      };

      if (ativo === "dashboard") {
        let q = supabase
          .from("editais_corretos")
          .select(
            "id,numero,titulo,descricao,fonte,status,data_publicacao,data_encerramento,valor,valor_projeto,prazo_inscricao,area,orgao,link,is_researcher,is_company,timeline_estimada,validado_em,criado_em,atualizado_em",
          )
          .order("validado_em", { ascending: false })
          .range(0, 999);
        if (fonte) q = q.eq("fonte", fonte);
        if (status) q = q.eq("status", status);
        if (qtext) {
          const like = `%${qtext}%`;
          q = q.or(
            `titulo.ilike.${like},descricao.ilike.${like},numero.ilike.${like},orgao.ilike.${like},area.ilike.${like}`,
          );
        }
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const rows = (data || [])
          .filter((r: any) => r.is_researcher === true || r.is_company === true)
          .filter((r: any) => isEditalAtivoDashboard(r));
        const paged = rows.slice(offset, offset + limit);
        return { count: rows.length, rows: paged };
      }

      let q = supabase
        .from("editais_corretos")
        .select(
          "id,numero,titulo,descricao,fonte,status,data_publicacao,data_encerramento,valor,valor_projeto,prazo_inscricao,area,orgao,link,is_researcher,is_company,validado_em,criado_em,atualizado_em",
          { count: "exact" },
        )
        .order("validado_em", { ascending: false });
      if (fonte) q = q.eq("fonte", fonte);
      if (status) q = q.eq("status", status);
      if (qtext) {
        const like = `%${qtext}%`;
        q = q.or(
          `titulo.ilike.${like},descricao.ilike.${like},numero.ilike.${like},orgao.ilike.${like},area.ilike.${like}`,
        );
      }
      if (ativo === "1" || ativo === "0") {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, "0");
        const dd = String(today.getDate()).padStart(2, "0");
        const todayIso = `${yyyy}-${mm}-${dd}`;
        if (ativo === "1") q = q.or(`data_encerramento.gte.${todayIso},status.ilike.%abert%`);
        else q = q.or(`data_encerramento.lt.${todayIso},status.ilike.%encerr%,status.ilike.%finaliz%`);
      }
      q = q.range(offset, offset + limit - 1);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { count: count ?? null, rows: data || [] };
    },

    async adminUpdateEdital(id, patch) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("editais_corretos")
        .update(patch)
        .eq("id", id)
        .select(
          "id,numero,titulo,descricao,fonte,status,data_publicacao,data_encerramento,valor,valor_projeto,prazo_inscricao,area,orgao,link,is_researcher,is_company,validado_em,criado_em,atualizado_em",
        )
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    async adminListRedacoes({ limit, offset, status, userId, propostaId }) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      let q = supabase
        .from("redacoes_ai")
        .select("id,user_id,proposta_id,edital_id,field_id,field_name,status,model,provider,created_at,updated_at", { count: "exact" })
        .order("created_at", { ascending: false });
      if (status) q = q.eq("status", status);
      if (userId) q = q.eq("user_id", userId);
      if (propostaId) q = q.eq("proposta_id", propostaId);
      q = q.range(offset, offset + limit - 1);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { count: count ?? null, rows: data || [] };
    },

    async adminUpdateRedacaoStatus(id, status) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("redacoes_ai")
        .update({ status })
        .eq("id", id)
        .select("id,status,updated_at")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  };

  return { stripe: stripeGateway, supabase: supabaseGateway };
}


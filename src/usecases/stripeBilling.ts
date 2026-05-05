import type { Request } from "express";
import type { AppConfig } from "../config.js";
import type { StripeGateway, SupabaseGateway } from "../infra/gateways.js";
import { HttpError } from "../http/errors.js";
import { getBearerToken } from "../http/auth.js";

function appBaseUrl(config: AppConfig, req: Request): string {
  const fromEnv = config.appBaseUrl?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const origin = req.headers.origin;
  if (origin && /^https?:\/\//i.test(origin)) return String(origin).replace(/\/$/, "");
  return "http://localhost:5173";
}

async function getUserFromBearer(supabase: SupabaseGateway, req: Request) {
  const token = getBearerToken(req);
  if (!token) return { user: null as any, error: "no_bearer" as const };
  const user = await supabase.getUserFromAccessToken(token);
  if (!supabase.isConfigured) return { user: null as any, error: "no_supabase" as const };
  if (!user) return { user: null as any, error: "invalid_token" as const };
  return { user, error: null as null };
}

export type StripeBillingUseCases = {
  createCheckoutSession(req: Request): Promise<{ status: number; body: any }>;
  createPortalSession(req: Request): Promise<{ status: number; body: any }>;
};

export function buildStripeBillingUseCases(deps: {
  config: AppConfig;
  stripe: StripeGateway;
  supabase: SupabaseGateway;
}): StripeBillingUseCases {
  return {
    async createCheckoutSession(req) {
      if (!deps.stripe.hasStripe) {
        return {
          status: 503,
          body: { error: "Stripe não configurado (AISELFIE_STRIPE_SECRET_KEY)" },
        };
      }

      const { user, error: authErr } = await getUserFromBearer(deps.supabase, req);
      if (!user) {
        return {
          status: 401,
          body: {
            error:
              authErr === "no_bearer"
                ? "Faça login para assinar."
                : "Sessão inválida ou servidor sem Supabase service role.",
          },
        };
      }

      const planKey = String((req as any).body?.planKey || "").trim();
      if (planKey !== "pro" && planKey !== "empresas") {
        return { status: 400, body: { error: "planKey inválido" } };
      }

      const priceId = await deps.supabase.getActivePriceIdForPlan(planKey);
      if (!priceId) {
        return {
          status: 503,
          body: {
            error:
              planKey === "pro"
                ? "Plano Pro não configurado. Defina `billing_plans.stripe_price_id` via /admin → Pagamentos."
                : "Plano Empresas não configurado. Defina `billing_plans.stripe_price_id` via /admin → Pagamentos.",
          },
        };
      }

      const base = appBaseUrl(deps.config, req);
      try {
        const session = await deps.stripe.createCheckoutSession({
          priceId,
          userId: user.id,
          userEmail: user.email,
          // On return from checkout, keep user in /perfil.
          successUrl: `${base}/perfil?checkout=success`,
          cancelUrl: `${base}/perfil?checkout=cancel`,
          planKey,
        });
        return { status: 200, body: { url: session.url } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "checkout failed";
        return { status: 500, body: { error: msg } };
      }
    },

    async createPortalSession(req) {
      if (!deps.stripe.hasStripe) {
        return { status: 503, body: { error: "Stripe não configurado" } };
      }

      const { user } = await getUserFromBearer(deps.supabase, req);
      if (!user) return { status: 401, body: { error: "Não autorizado" } };

      if (!deps.supabase.isConfigured) {
        return { status: 503, body: { error: "Supabase service role não configurada" } };
      }

      const customerId = await deps.supabase.getStripeCustomerIdForUser(user.id);
      if (!customerId) {
        return {
          status: 400,
          body: { error: "Nenhum cliente Stripe vinculado. Assine um plano primeiro." },
        };
      }

      const base = appBaseUrl(deps.config, req);
      try {
        const session = await deps.stripe.createPortalSession({
          customerId,
          returnUrl: `${base}/perfil`,
        });
        return { status: 200, body: { url: session.url } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "portal failed";
        return { status: 500, body: { error: msg } };
      }
    },
  };
}


import express from "express";
import Stripe from "stripe";
import { getServiceSupabase } from "../lib/stripeSubscriptionSync.js";

const router = express.Router();

const stripeSecret =
  process.env.AISELFIE_STRIPE_SECRET_KEY?.trim() ||
  process.env.STRIPE_SECRET_KEY?.trim() ||
  "";

function getStripe(): Stripe | null {
  return stripeSecret ? new Stripe(stripeSecret) : null;
}

function appBaseUrl(req: express.Request): string {
  const fromEnv = process.env.APP_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const origin = req.headers.origin;
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/$/, "");
  return "http://localhost:5173";
}

async function priceIdForPlanFromDb(planKey: string): Promise<string | null> {
  const supabase = getServiceSupabase();
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
}

async function getUserFromBearer(req: express.Request) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer "))
    return { user: null as null, error: "no_bearer" as const };
  const token = auth.slice(7).trim();
  const supabase = getServiceSupabase();
  if (!supabase) return { user: null as null, error: "no_supabase" as const };
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user)
    return { user: null as null, error: "invalid_token" as const };
  return { user, error: null as null };
}

router.post("/stripe/create-checkout-session", async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({
      error: "Stripe não configurado (AISELFIE_STRIPE_SECRET_KEY ou STRIPE_SECRET_KEY)",
    });
  }

  const { user, error: authErr } = await getUserFromBearer(req);
  if (!user) {
    return res.status(401).json({
      error:
        authErr === "no_bearer"
          ? "Faça login para assinar."
          : "Sessão inválida ou servidor sem Supabase service role.",
    });
  }

  const planKey = String(req.body?.planKey || "").trim();
  if (planKey !== "pro" && planKey !== "empresas") {
    return res.status(400).json({ error: "planKey inválido" });
  }

  const priceId = await priceIdForPlanFromDb(planKey);
  if (!priceId) {
    return res.status(503).json({
      error:
        planKey === "pro"
          ? "Plano Pro não configurado. Defina `billing_plans.stripe_price_id` via /admin → Pagamentos."
          : "Plano Empresas não configurado. Defina `billing_plans.stripe_price_id` via /admin → Pagamentos.",
    });
  }

  const base = appBaseUrl(req);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/dashboard?checkout=success`,
      cancel_url: `${base}/planos`,
      client_reference_id: user.id,
      customer_email: user.email || undefined,
      metadata: {
        supabase_user_id: user.id,
        plan_key: planKey,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          plan_key: planKey,
        },
      },
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.error("create-checkout-session:", e);
    const msg = e instanceof Error ? e.message : "checkout failed";
    return res.status(500).json({ error: msg });
  }
});

router.post("/stripe/create-portal-session", async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ error: "Stripe não configurado" });
  }

  const { user } = await getUserFromBearer(req);
  if (!user) {
    return res.status(401).json({ error: "Não autorizado" });
  }

  const supabase = getServiceSupabase();
  if (!supabase) {
    return res.status(503).json({ error: "Supabase service role não configurada" });
  }

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profErr || !profile?.stripe_customer_id) {
    return res.status(400).json({
      error: "Nenhum cliente Stripe vinculado. Assine um plano primeiro.",
    });
  }

  const base = appBaseUrl(req);

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${base}/perfil`,
    });
    return res.json({ url: session.url });
  } catch (e) {
    console.error("create-portal-session:", e);
    const msg = e instanceof Error ? e.message : "portal failed";
    return res.status(500).json({ error: msg });
  }
});

export default router;


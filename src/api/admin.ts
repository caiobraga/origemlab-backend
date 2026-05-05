import express from "express";
import { getServiceSupabase } from "../lib/stripeSubscriptionSync.js";

const router = express.Router();

async function getUserFromBearer(req: express.Request) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer "))
    return {
      user: null as null,
      token: null as null,
      error: "no_bearer" as const,
    };
  const token = auth.slice(7).trim();
  const supabase = getServiceSupabase();
  if (!supabase)
    return {
      user: null as null,
      token: null as null,
      error: "no_supabase" as const,
    };
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user)
    return {
      user: null as null,
      token: null as null,
      error: "invalid_token" as const,
    };
  return { user, token, error: null as null };
}

async function assertAdmin(req: express.Request, res: express.Response) {
  const { user, error } = await getUserFromBearer(req);
  if (!user) {
    res
      .status(401)
      .json({ error: error === "no_bearer" ? "Faça login." : "Sessão inválida." });
    return null;
  }
  const supabase = getServiceSupabase();
  if (!supabase) {
    res.status(503).json({ error: "Servidor sem SUPABASE_SERVICE_ROLE_KEY." });
    return null;
  }
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profErr) {
    res.status(500).json({ error: `Erro ao ler perfil admin: ${profErr.message}` });
    return null;
  }
  if (!profile?.is_admin) {
    res.status(403).json({ error: "Acesso negado (admin)." });
    return null;
  }
  return { user, supabase };
}

router.get("/admin/users", async (req, res) => {
  const ctx = await assertAdmin(req, res);
  if (!ctx) return;
  const { supabase } = ctx;

  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const perPage = Math.min(
    200,
    Math.max(1, parseInt(String(req.query.perPage || "50"), 10) || 50),
  );

  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
  if (error) return res.status(500).json({ error: error.message });

  const userIds = (data?.users || []).map((u) => u.id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select(
      "user_id, is_admin, is_blocked, user_type, has_cnpj, cnpj, lattes_id, criado_em, subscription_plan_key, subscription_status",
    )
    .in("user_id", userIds);
  const byUser = new Map((profiles || []).map((p: any) => [p.user_id, p]));

  const users = (data?.users || []).map((u) => {
    const p = byUser.get(u.id) || null;
    return {
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      email_confirmed_at: u.email_confirmed_at,
      banned_until: (u as any).banned_until ?? null,
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

  return res.json({ page, perPage, users });
});

router.patch("/admin/users/:userId", async (req, res) => {
  const ctx = await assertAdmin(req, res);
  if (!ctx) return;
  const { supabase } = ctx;
  const userId = String(req.params.userId || "").trim();
  if (!userId) return res.status(400).json({ error: "userId inválido" });

  const is_admin = req.body?.is_admin;
  const is_blocked = req.body?.is_blocked;
  if (is_admin === undefined && is_blocked === undefined) {
    return res.status(400).json({ error: "Envie is_admin e/ou is_blocked" });
  }

  const patch: any = { user_id: userId };
  if (is_admin !== undefined) patch.is_admin = Boolean(is_admin);
  if (is_blocked !== undefined) patch.is_blocked = Boolean(is_blocked);

  const { data, error } = await supabase
    .from("profiles")
    .upsert(patch, { onConflict: "user_id" })
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ profile: data });
});

router.get("/admin/billing/plans", async (req, res) => {
  const ctx = await assertAdmin(req, res);
  if (!ctx) return;
  const { supabase } = ctx;

  const { data, error } = await supabase
    .from("billing_plans")
    .select("*")
    .order("plan_key", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ rows: data || [] });
});

router.put("/admin/billing/plans/:planKey", async (req, res) => {
  const ctx = await assertAdmin(req, res);
  if (!ctx) return;
  const { supabase } = ctx;
  const planKey = String(req.params.planKey || "").trim().toLowerCase();
  if (!planKey) return res.status(400).json({ error: "planKey inválido" });

  const title = String(req.body?.title || "").trim();
  const currency = String(req.body?.currency || "brl")
    .trim()
    .toLowerCase();
  const interval = String(req.body?.interval || "month")
    .trim()
    .toLowerCase();
  const unitAmountCents = Number(req.body?.unit_amount_cents);
  const active =
    req.body?.active === undefined ? true : Boolean(req.body?.active);

  if (!title) return res.status(400).json({ error: "title obrigatório" });
  if (!/^[a-z]{3}$/.test(currency))
    return res.status(400).json({ error: "currency inválida" });
  if (interval !== "month")
    return res.status(400).json({ error: "interval inválido (use month)" });
  if (!Number.isFinite(unitAmountCents) || unitAmountCents <= 0) {
    return res.status(400).json({ error: "unit_amount_cents inválido" });
  }

  const stripeKey =
    process.env.AISELFIE_STRIPE_SECRET_KEY?.trim() || "";
  if (!stripeKey)
    return res
      .status(503)
      .json({ error: "Stripe não configurado (AISELFIE_STRIPE_SECRET_KEY)" });

  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(stripeKey);

  const { data: existing, error: e0 } = await supabase
    .from("billing_plans")
    .select("*")
    .eq("plan_key", planKey)
    .maybeSingle();
  if (e0) return res.status(500).json({ error: e0.message });

  let productId: string | null = (existing as any)?.stripe_product_id ?? null;
  if (!productId) {
    const product = await stripe.products.create({
      name: title,
      metadata: { plan_key: planKey },
    });
    productId = product.id;
  } else if ((existing as any)?.title && (existing as any).title !== title) {
    await stripe.products.update(productId, { name: title });
  }

  const price = await stripe.prices.create({
    product: productId,
    currency,
    unit_amount: Math.round(unitAmountCents),
    recurring: { interval: "month" },
    nickname: `${planKey}:${currency}:${unitAmountCents}`,
    metadata: { plan_key: planKey },
  });

  const prevPriceId: string | null = (existing as any)?.stripe_price_id ?? null;
  if (prevPriceId && prevPriceId !== price.id) {
    try {
      await stripe.prices.update(prevPriceId, { active: false });
    } catch {
      // ignore
    }
  }

  const row: any = {
    plan_key: planKey,
    title,
    currency,
    interval: "month",
    unit_amount_cents: Math.round(unitAmountCents),
    stripe_product_id: productId,
    stripe_price_id: price.id,
    active,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("billing_plans")
    .upsert(row, { onConflict: "plan_key" })
    .select("*")
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({
    row: data,
    stripe: { product_id: productId, price_id: price.id },
  });
});

export default router;


import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "../infra/supabaseClient.js";

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

function getServiceSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServerSupabaseClient(url, key);
}

function isMissingSubscriptionColumnError(error: { message?: string; code?: string } | null): boolean {
  const msg = String(error?.message || "");
  const code = String(error?.code || "");
  return (
    code === "PGRST204" ||
    /could not find the .*column/i.test(msg) ||
    /schema cache/i.test(msg)
  );
}

export function subscriptionRowFromStripe(
  customerId: string,
  subscription: Stripe.Subscription,
): Record<string, string | null> {
  const priceId = subscription.items.data[0]?.price?.id ?? null;
  const planKey =
    (subscription.metadata?.plan_key as string | undefined)?.trim() || null;
  const periodEnd = (subscription as { current_period_end?: number }).current_period_end;
  return {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    subscription_price_id: priceId,
    subscription_current_period_end:
      typeof periodEnd === "number" && Number.isFinite(periodEnd)
        ? new Date(periodEnd * 1000).toISOString()
        : null,
    subscription_plan_key: planKey,
  };
}

export function mergeProfileWithAuthSubscription(
  profile: Record<string, any>,
  authUser?: { user_metadata?: Record<string, unknown> } | null,
): Record<string, any> {
  const sub = authUser?.user_metadata?.subscription;
  if (!sub || typeof sub !== "object") return profile;
  const s = sub as Record<string, unknown>;
  return {
    ...profile,
    stripe_customer_id: profile.stripe_customer_id ?? s.stripe_customer_id ?? null,
    stripe_subscription_id: profile.stripe_subscription_id ?? s.stripe_subscription_id ?? null,
    subscription_status: profile.subscription_status ?? s.subscription_status ?? null,
    subscription_plan_key: profile.subscription_plan_key ?? s.subscription_plan_key ?? null,
    subscription_price_id: profile.subscription_price_id ?? s.subscription_price_id ?? null,
    subscription_current_period_end:
      profile.subscription_current_period_end ?? s.subscription_current_period_end ?? null,
  };
}

async function applySubscriptionToAuthMetadata(
  supabase: SupabaseClient,
  userId: string,
  row: Record<string, string | null>,
): Promise<void> {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw error;
  const metadata = {
    ...(data.user?.user_metadata || {}),
    subscription: row,
  };
  const { error: upErr } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: metadata,
  });
  if (upErr) throw upErr;
}

export async function applySubscriptionToProfile(
  stripe: Stripe,
  userId: string,
  customerId: string,
  subscriptionId: string,
): Promise<void> {
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Supabase service role not configured");

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const row = subscriptionRowFromStripe(customerId, subscription);

  const { error } = await supabase.from("profiles").update(row).eq("user_id", userId);
  if (error && isMissingSubscriptionColumnError(error)) {
    await applySubscriptionToAuthMetadata(supabase, userId, row);
    return;
  }
  if (error) throw error;
}

export async function clearSubscriptionBySubscriptionId(
  stripeSubscriptionId: string,
): Promise<void> {
  const supabase = getServiceSupabase();
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
    .eq("stripe_subscription_id", stripeSubscriptionId);

  if (error && isMissingSubscriptionColumnError(error)) {
    const { data } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("stripe_subscription_id", stripeSubscriptionId)
      .maybeSingle();
    if (data?.user_id) {
      await applySubscriptionToAuthMetadata(supabase, data.user_id, {
        stripe_customer_id: null,
        stripe_subscription_id: null,
        subscription_status: "canceled",
        subscription_price_id: null,
        subscription_current_period_end: null,
        subscription_plan_key: null,
      });
    }
    return;
  }
  if (error) throw error;
}

function stripeCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer,
): string | null {
  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object" && "id" in customer) return customer.id;
  return null;
}

/** Busca assinatura ativa mais recente no Stripe (por e-mail) e grava no perfil. */
export async function syncActiveSubscriptionForUser(
  stripe: Stripe,
  userId: string,
  email?: string | null,
): Promise<{ synced: boolean; planKey?: string | null; subscriptionId?: string }> {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return { synced: false };

  const customers = await stripe.customers.list({ email: normalizedEmail, limit: 10 });
  let best: Stripe.Subscription | null = null;
  let bestCustomerId: string | null = null;

  for (const customer of customers.data) {
    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: "all",
      limit: 10,
    });
    for (const sub of subs.data) {
      if (!ACTIVE_STATUSES.has(sub.status)) continue;
      if (!best || sub.created > best.created) {
        best = sub;
        bestCustomerId = customer.id;
      }
    }
  }

  if (!best || !bestCustomerId) return { synced: false };

  await applySubscriptionToProfile(stripe, userId, bestCustomerId, best.id);
  return {
    synced: true,
    planKey: best.metadata?.plan_key || null,
    subscriptionId: best.id,
  };
}

export { getServiceSupabase };

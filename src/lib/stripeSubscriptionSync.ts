import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getServiceSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export function subscriptionRowFromStripe(
  customerId: string,
  subscription: Stripe.Subscription,
): Record<string, string | null> {
  const priceId = subscription.items.data[0]?.price?.id ?? null;
  const planKey =
    (subscription.metadata?.plan_key as string | undefined)?.trim() || null;
  return {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    subscription_price_id: priceId,
    subscription_current_period_end: new Date(
      // Some stripe typings vary across versions; runtime field exists.
      ((subscription as any).current_period_end as number) * 1000,
    ).toISOString(),
    subscription_plan_key: planKey,
  };
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

  const { error } = await supabase
    .from("profiles")
    .update(row)
    .eq("user_id", userId);
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

  if (error) throw error;
}

export { getServiceSupabase };


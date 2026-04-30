import type { Request } from "express";
import type Stripe from "stripe";
import type { AppConfig } from "../config.js";
import type { StripeGateway, SupabaseGateway } from "../infra/gateways.js";

function stripeCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer,
): string | null {
  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object" && "id" in customer) {
    return customer.id;
  }
  return null;
}

function subscriptionRowFromStripe(
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
      ((subscription as any).current_period_end as number) * 1000,
    ).toISOString(),
    subscription_plan_key: planKey,
  };
}

export type StripeWebhookUseCase = {
  handle(req: Request): Promise<{ status: number; body: string | object }>;
};

export function buildStripeWebhookUseCase(deps: {
  config: AppConfig;
  stripe: StripeGateway;
  supabase: SupabaseGateway;
}): StripeWebhookUseCase {
  return {
    async handle(req) {
      if (!deps.stripe.hasStripe || !deps.config.stripe.webhookSecret) {
        console.error(
          "Stripe webhook: AISELFIE_STRIPE_SECRET_KEY/AISELFIE_STRIPE_WEBHOOK_SECRET (or STRIPE_*) missing",
        );
        return { status: 503, body: "Stripe not configured" };
      }

      const sig = req.headers["stripe-signature"];
      if (!sig || typeof sig !== "string") {
        return { status: 400, body: "Missing stripe-signature" };
      }

      const raw = (req as any).body;
      if (!Buffer.isBuffer(raw)) {
        return { status: 400, body: "Expected raw body" };
      }

      let event: Stripe.Event;
      try {
        event = deps.stripe.constructWebhookEvent({ rawBody: raw, signature: sig });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "verify failed";
        console.error("Stripe webhook signature:", msg);
        return { status: 400, body: `Webhook Error: ${msg}` };
      }

      try {
        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            if (session.mode !== "subscription") break;
            const userId =
              session.client_reference_id || session.metadata?.supabase_user_id;
            const subId = session.subscription;
            const customerId = session.customer;
            if (
              !userId ||
              typeof subId !== "string" ||
              typeof customerId !== "string"
            ) {
              console.warn(
                "checkout.session.completed: missing user/subscription/customer",
              );
              break;
            }
            const subscription = await deps.stripe.retrieveSubscription(subId);
            const row = subscriptionRowFromStripe(customerId, subscription);
            await deps.supabase.updateProfileByUserId(userId, row);
            break;
          }
          case "customer.subscription.updated": {
            const subscription = event.data.object as Stripe.Subscription;
            const userId = subscription.metadata?.supabase_user_id;
            const customerId = stripeCustomerId(subscription.customer);
            if (!customerId) break;

            if (!userId) {
              const inferredUserId = await deps.supabase.findUserIdByStripeSubscriptionId(
                subscription.id,
              );
              if (inferredUserId) {
                const row = subscriptionRowFromStripe(customerId, subscription);
                await deps.supabase.updateProfileByUserId(inferredUserId, row);
              }
            } else {
              const row = subscriptionRowFromStripe(customerId, subscription);
              await deps.supabase.updateProfileByUserId(userId, row);
            }
            break;
          }
          case "customer.subscription.deleted": {
            const subscription = event.data.object as Stripe.Subscription;
            await deps.supabase.clearSubscriptionBySubscriptionId(subscription.id);
            break;
          }
          default:
            break;
        }
      } catch (e) {
        console.error("Stripe webhook handler error:", e);
        return { status: 500, body: { error: "handler failed" } };
      }

      return { status: 200, body: { received: true } };
    },
  };
}


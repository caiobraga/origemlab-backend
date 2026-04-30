import type { Request, Response } from "express";
import Stripe from "stripe";
import {
  applySubscriptionToProfile,
  clearSubscriptionBySubscriptionId,
  getServiceSupabase,
} from "../lib/stripeSubscriptionSync.js";

const stripeSecret =
  process.env.AISELFIE_STRIPE_SECRET_KEY?.trim() ||
  process.env.STRIPE_SECRET_KEY?.trim() ||
  "";
const webhookSecret =
  process.env.AISELFIE_STRIPE_WEBHOOK_SECRET?.trim() ||
  process.env.STRIPE_WEBHOOK_SECRET?.trim() ||
  "";

function stripeCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer,
): string | null {
  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object" && "id" in customer) {
    return customer.id;
  }
  return null;
}

export default async function stripeWebhookHandler(req: Request, res: Response) {
  if (!stripeSecret || !webhookSecret) {
    console.error(
      "Stripe webhook: AISELFIE_STRIPE_SECRET_KEY/AISELFIE_STRIPE_WEBHOOK_SECRET (or STRIPE_*) missing",
    );
    return res.status(503).send("Stripe not configured");
  }

  const stripe = new Stripe(stripeSecret);
  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    return res.status(400).send("Missing stripe-signature");
  }

  let event: Stripe.Event;
  try {
    const raw = req.body;
    if (!Buffer.isBuffer(raw)) {
      return res.status(400).send("Expected raw body");
    }
    event = stripe.webhooks.constructEvent(raw, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "verify failed";
    console.error("Stripe webhook signature:", msg);
    return res.status(400).send(`Webhook Error: ${msg}`);
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
        await applySubscriptionToProfile(stripe, userId, customerId, subId);
        break;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.supabase_user_id;
        const customerId = stripeCustomerId(subscription.customer);
        if (!userId && customerId) {
          const supabase = getServiceSupabase();
          if (supabase) {
            const { data } = await supabase
              .from("profiles")
              .select("user_id")
              .eq("stripe_subscription_id", subscription.id)
              .maybeSingle();
            if (data?.user_id) {
              await applySubscriptionToProfile(
                stripe,
                data.user_id,
                customerId,
                subscription.id,
              );
            }
          }
        } else if (userId && customerId) {
          await applySubscriptionToProfile(
            stripe,
            userId,
            customerId,
            subscription.id,
          );
        }
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await clearSubscriptionBySubscriptionId(subscription.id);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("Stripe webhook handler error:", e);
    return res.status(500).json({ error: "handler failed" });
  }

  res.json({ received: true });
}


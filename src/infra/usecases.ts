import type { AppConfig } from "../config.js";
import type { StripeGateway, SupabaseGateway } from "./gateways.js";
import { buildStripeBillingUseCases } from "../usecases/stripeBilling.js";
import { buildStripeWebhookUseCase } from "../usecases/stripeWebhook.js";
import { buildAdminUseCases } from "../usecases/admin.js";
import { buildAiTextUseCases } from "../usecases/aiText.js";

export function buildUseCases(deps: { config: AppConfig; gateways: { stripe: StripeGateway; supabase: SupabaseGateway } }) {
  return {
    stripeBilling: buildStripeBillingUseCases({
      config: deps.config,
      stripe: deps.gateways.stripe,
      supabase: deps.gateways.supabase,
    }),
    stripeWebhook: buildStripeWebhookUseCase({
      config: deps.config,
      stripe: deps.gateways.stripe,
      supabase: deps.gateways.supabase,
    }),
    admin: buildAdminUseCases({
      config: deps.config,
      stripe: deps.gateways.stripe,
      supabase: deps.gateways.supabase,
    }),
    aiText: buildAiTextUseCases({
      config: deps.config,
      supabase: deps.gateways.supabase,
    }),
  };
}


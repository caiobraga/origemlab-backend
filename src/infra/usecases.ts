import type { AppConfig } from "../config.js";
import type { StripeGateway, SupabaseGateway } from "./gateways.js";
import { buildStripeBillingUseCases } from "../usecases/stripeBilling.js";
import { buildStripeWebhookUseCase } from "../usecases/stripeWebhook.js";
import { buildAdminUseCases } from "../usecases/admin.js";
import { buildAiTextUseCases } from "../usecases/aiText.js";
import { buildAuthUseCases } from "../usecases/auth.js";
import { createInMemorySessionStore } from "./sessionStore.js";
import { buildSupabaseAuthGateway } from "./authGateway.js";
import { buildAppDataUseCases } from "../usecases/appData.js";

export function buildUseCases(deps: { config: AppConfig; gateways: { stripe: StripeGateway; supabase: SupabaseGateway } }) {
  const sessions = createInMemorySessionStore();
  const authGateway = buildSupabaseAuthGateway(deps.config);
  const auth = buildAuthUseCases({ config: deps.config, sessions, auth: authGateway });
  return {
    auth,
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
    app: buildAppDataUseCases({
      config: deps.config,
      supabase: deps.gateways.supabase,
      auth,
    }),
  };
}


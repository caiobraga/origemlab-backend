import type { Request } from "express";
import type { SupabaseGateway } from "../infra/gateways.js";
import type { AuthUseCases } from "./auth.js";
import {
  buildEntitlementsPayload,
  hasProFeatures,
  resolvePlanTier,
  subscriptionRequiredBody,
  type PlanTier,
} from "../lib/subscriptionEntitlements.js";
import { mergeProfileWithAuthSubscription } from "../lib/stripeSubscriptionSync.js";

export type SubscriptionContext = {
  userId: string;
  profile: Record<string, any>;
  tier: PlanTier;
  entitlements: ReturnType<typeof buildEntitlementsPayload>;
};

type GuardDeps = {
  supabase: SupabaseGateway;
  auth: AuthUseCases;
  enforce?: boolean;
};

export async function loadSubscriptionContext(
  req: Request,
  deps: GuardDeps,
): Promise<{ ok: true; ctx: SubscriptionContext } | { ok: false; status: number; body: any }> {
  let userId: string;
  try {
    userId = await deps.auth.requireSessionUserId(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "supabase_unreachable") {
      return { ok: false, status: 503, body: { error: "supabase_unreachable" } };
    }
    return { ok: false, status: 401, body: { error: "unauthenticated" } };
  }

  const profileRaw = (await deps.supabase.getProfile(userId)) || {};
  let authUser: { user_metadata?: Record<string, unknown> } | null = null;
  try {
    authUser = await deps.supabase.getAuthUserById(userId);
  } catch {
    // metadata opcional
  }
  const profile = mergeProfileWithAuthSubscription(profileRaw, authUser);
  if (profile.is_blocked) {
    return { ok: false, status: 403, body: { error: "account_blocked", message: "Conta bloqueada." } };
  }

  const tier = resolvePlanTier(profile);
  let editaisViewsUsed = 0;
  let accessedEditalIds: string[] = [];
  if (tier === "free") {
    try {
      const usage = await deps.supabase.getEditalCatalogUsage(userId);
      editaisViewsUsed = usage.used;
      accessedEditalIds = usage.accessedIds;
    } catch (e) {
      console.warn(
        "[subscription_usage] Não foi possível carregar uso do catálogo; tratando como 0 views.",
        e instanceof Error ? e.message : e,
      );
    }
  }

  return {
    ok: true,
    ctx: {
      userId,
      profile,
      tier,
      entitlements: buildEntitlementsPayload(tier, { editaisViewsUsed, accessedEditalIds }),
    },
  };
}

export async function requireProSubscription(
  req: Request,
  deps: GuardDeps,
  feature: string,
): Promise<{ ok: true; ctx: SubscriptionContext } | { ok: false; status: number; body: any }> {
  const loaded = await loadSubscriptionContext(req, deps);
  if (!loaded.ok) return loaded;

  if (deps.enforce === false) return loaded;
  if (!hasProFeatures(loaded.ctx.tier)) {
    return {
      ok: false,
      status: 403,
      body: subscriptionRequiredBody(feature, loaded.ctx.tier),
    };
  }
  return loaded;
}

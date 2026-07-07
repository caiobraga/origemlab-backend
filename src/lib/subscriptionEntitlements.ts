/** Planos e limites alinhados a Pricing.tsx / Planos.tsx */

export const FREE_EDITAIS_PER_MONTH = 3;

export type PlanTier = "free" | "pro" | "empresas" | "institucional";

export type SubscriptionProfile = {
  is_admin?: boolean | null;
  is_blocked?: boolean | null;
  subscription_status?: string | null;
  subscription_plan_key?: string | null;
};

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export function resolvePlanTier(profile: SubscriptionProfile | null | undefined): PlanTier {
  if (!profile) return "free";

  const status = String(profile.subscription_status || "").trim();
  const key = String(profile.subscription_plan_key || "").trim();
  if (!ACTIVE_STATUSES.has(status)) return "free";

  if (key === "empresas") return "empresas";
  if (key === "institucional") return "institucional";
  if (key === "pro") return "pro";
  return "free";
}

export function hasProFeatures(tier: PlanTier): boolean {
  return tier !== "free";
}

export function planDisplayName(tier: PlanTier): string {
  if (tier === "pro") return "Pro";
  if (tier === "empresas") return "Empresas";
  if (tier === "institucional") return "Institucional";
  return "Gratuito";
}

export type EntitlementsPayload = {
  tier: PlanTier;
  plan_name: string;
  pro_features: boolean;
  limits: {
    editais_per_month: number | null;
  };
  features: {
    editais_catalog: boolean;
    edital_chat: boolean;
    ai_proposal: boolean;
    propostas: boolean;
    indicacoes: boolean;
    dashboard_metrics: boolean;
  };
  usage?: {
    editais_views: { used: number; limit: number; accessed_ids: string[] };
  };
};

export function canAccessEditalCatalog(
  tier: PlanTier,
  editalId: string,
  usage?: { used: number; limit: number; accessed_ids: string[] },
): boolean {
  if (hasProFeatures(tier)) return true;
  if (!usage) return false;
  const id = String(editalId || "").trim();
  if (id && usage.accessed_ids.includes(id)) return true;
  return usage.used < usage.limit;
}

/** Plano gratuito: no máximo N editais visíveis no catálogo (prioriza já abertos no mês). */
export function applyFreeCatalogListLimit<T extends { id: string }>(
  rows: T[],
  accessedIds: string[],
  maxVisible = FREE_EDITAIS_PER_MONTH,
): T[] {
  if (maxVisible <= 0) return [];
  const accessedSet = new Set(accessedIds.map(String));
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const accessedRows = accessedIds
    .map((id) => byId.get(String(id)))
    .filter((row): row is T => Boolean(row));
  const rest = rows.filter((r) => !accessedSet.has(String(r.id)));
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const row of [...accessedRows, ...rest]) {
    const id = String(row.id);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
    if (merged.length >= maxVisible) break;
  }
  return merged;
}

export function buildEntitlementsPayload(
  tier: PlanTier,
  usage?: { editaisViewsUsed: number; accessedEditalIds?: string[] },
): EntitlementsPayload {
  const pro = hasProFeatures(tier);
  const limit = pro ? null : FREE_EDITAIS_PER_MONTH;
  const accessedIds = (usage?.accessedEditalIds ?? []).map(String);

  return {
    tier,
    plan_name: planDisplayName(tier),
    pro_features: pro,
    limits: {
      editais_per_month: limit,
    },
    features: {
      editais_catalog: true,
      edital_chat: pro,
      ai_proposal: pro,
      propostas: pro,
      indicacoes: pro,
      dashboard_metrics: pro,
    },
    usage: limit
      ? {
          editais_views: {
            used: usage?.editaisViewsUsed ?? accessedIds.length,
            limit,
            accessed_ids: accessedIds,
          },
        }
      : undefined,
  };
}

export function subscriptionRequiredBody(feature: string, tier: PlanTier) {
  return {
    error: "subscription_required",
    feature,
    plan: tier,
    message:
      tier === "free"
        ? "Este recurso faz parte do plano Pro. Assine em /planos para desbloquear."
        : "Assinatura necessária para este recurso.",
    upgrade_url: "/planos",
  };
}

export function subscriptionLimitBody(used: number, limit: number) {
  return {
    error: "subscription_limit",
    feature: "editais_catalog",
    message: `Plano gratuito: até ${limit} editais por mês (${used}/${limit} usados). Assine o Pro para acesso ilimitado.`,
    used,
    limit,
    upgrade_url: "/planos",
  };
}

export function currentMonthKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

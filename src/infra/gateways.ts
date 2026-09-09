import type { SupabaseClient, User } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { AppConfig } from "../config.js";
import { createServerSupabaseClient } from "./supabaseClient.js";
import { isEditalAtivoByDatePatterns } from "../lib/editalActiveByDatePatterns.js";
import { computeArrecadacaoCatalogo } from "../lib/editalValorStats.js";
import { currentMonthKey, FREE_EDITAIS_PER_MONTH } from "../lib/subscriptionEntitlements.js";
import { syncActiveSubscriptionForUser } from "../lib/stripeSubscriptionSync.js";

export type StripeGateway = {
  hasStripe: boolean;
  createCheckoutSession(input: {
    priceId: string;
    userId: string;
    userEmail?: string | null;
    successUrl: string;
    cancelUrl: string;
    planKey: string;
  }): Promise<{ url: string | null }>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  constructWebhookEvent(input: { rawBody: Buffer; signature: string }): Stripe.Event;
  retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  createOrUpdateProduct(input: { existingProductId: string | null; title: string; planKey: string }): Promise<string>;
  createPrice(input: {
    productId: string;
    currency: string;
    unitAmountCents: number;
    planKey: string;
  }): Promise<string>;
  deactivatePrice(priceId: string): Promise<void>;
  syncSubscriptionForUser(
    userId: string,
    email?: string | null,
  ): Promise<{ synced: boolean; planKey?: string | null; subscriptionId?: string }>;
};

export type SupabaseGateway = {
  isConfigured: boolean;
  getUserFromAccessToken(token: string): Promise<User | null>;
  getAuthUserById(userId: string): Promise<User | null>;
  adminListUsers(input: { page: number; perPage: number }): Promise<{ users: any[] }>;
  profilesByUserIds(userIds: string[]): Promise<any[]>;
  profileIsAdmin(userId: string): Promise<boolean>;
  upsertProfileFlags(userId: string, patch: { is_admin?: boolean; is_blocked?: boolean }): Promise<any>;
  listBillingPlans(): Promise<any[]>;
  upsertBillingPlan(row: any): Promise<any>;
  getBillingPlan(planKey: string): Promise<any | null>;
  getActivePriceIdForPlan(planKey: string): Promise<string | null>;
  getStripeCustomerIdForUser(userId: string): Promise<string | null>;
  updateProfileByUserId(userId: string, patch: Record<string, any>): Promise<void>;
  findUserIdByStripeSubscriptionId(subId: string): Promise<string | null>;
  clearSubscriptionBySubscriptionId(subId: string): Promise<void>;
  adminListPropostas(input: {
    limit: number;
    offset: number;
    status?: string;
    userId?: string;
    editalId?: string;
    empresaId?: string;
  }): Promise<{ count: number | null; rows: any[] }>;
  adminUpdateProposta(id: string, patch: { status?: string; progresso?: number }): Promise<any>;
  adminListEditais(input: {
    limit: number;
    offset: number;
    q?: string;
    fonte?: string;
    status?: string;
    ativo?: string;
  }): Promise<{ count: number | null; rows: any[] }>;
  adminUpdateEdital(id: string, patch: Record<string, any>): Promise<any>;
  adminGetEditalDocuments(input: {
    editalId: string;
    limit: number;
    offset: number;
  }): Promise<{
    edital_id: string;
    pdfs: any[];
    pdfs_total: number;
    pdfs_processed: number;
    documents_total: number;
    documents_missing_embeddings: number;
    documents_rows: any[];
    extraction: any | null;
  }>;
  adminListRedacoes(input: {
    limit: number;
    offset: number;
    status?: string;
    userId?: string;
    propostaId?: string;
  }): Promise<{ count: number | null; rows: any[] }>;
  adminUpdateRedacaoStatus(id: string, status: string): Promise<any>;
  // App (user-scoped)
  createProposta(input: {
    userId: string;
    editalId: string;
    campos_formulario: any;
    gerado_com_ia: boolean;
    projetoId?: string | null;
    empresaId?: string | null;
  }): Promise<any>;
  getPropostaForUser(userId: string, propostaId: string): Promise<any | null>;
  updatePropostaForUser(userId: string, propostaId: string, patch: Record<string, any>): Promise<any>;
  deletePropostaForUser(userId: string, propostaId: string): Promise<void>;
  refreshMyIndicacoes(userId: string, limit: number, empresaId?: string | null): Promise<number>;
  fetchMyIndicacoes(userId: string, limit: number, empresaId?: string | null): Promise<any[]>;
  getProfile(userId: string): Promise<any | null>;
  updateProfile(userId: string, patch: Record<string, any>): Promise<any>;
  // Empresas (consultor)
  listEmpresasForUser(userId: string): Promise<any[]>;
  getEmpresaForUser(userId: string, empresaId: string): Promise<any | null>;
  createEmpresa(input: {
    userId: string;
    razao_social: string;
    nome_fantasia?: string | null;
    cnpj?: string | null;
    area?: string | null;
    dados?: Record<string, unknown>;
  }): Promise<any>;
  updateEmpresaForUser(userId: string, empresaId: string, patch: Record<string, any>): Promise<any>;
  deleteEmpresaForUser(userId: string, empresaId: string): Promise<void>;
  // Projetos
  listProjetosForUser(userId: string, empresaId?: string): Promise<any[]>;
  getProjetoForUser(userId: string, projetoId: string): Promise<any | null>;
  createProjeto(input: {
    userId: string;
    titulo: string;
    resumo?: string | null;
    objetivos?: string | null;
    area?: string | null;
    publico_alvo?: string;
    status?: string;
    empresa_id?: string | null;
    conteudo?: Record<string, unknown>;
  }): Promise<any>;
  updateProjetoForUser(userId: string, projetoId: string, patch: Record<string, any>): Promise<any>;
  deleteProjetoForUser(userId: string, projetoId: string): Promise<void>;
  matchEditaisForProjeto(userId: string, projetoId: string, limit: number): Promise<any[]>;
  getReferralStats(userId: string): Promise<{ convites: number; conversoes: number; ganhos: number; potencial: number }>;
  fetchAiFieldContext(input: {
    editalId?: string;
    propostaId?: string;
    projetoId?: string;
  }): Promise<{ editalSummary: string; formSummary: string }>;
  fetchEditalChatContext(input: {
    editalId: string;
    query: string;
    maxChunks?: number;
  }): Promise<{ editalSummary: string; excerpts: string[] }>;
  getEditalCatalogUsage(userId: string): Promise<{ used: number; accessedIds: string[] }>;
  getEditalCatalogUsageCount(userId: string): Promise<number>;
  getPublicCatalogStats(): Promise<{
    editaisCorretosCount: number;
    editaisAnalisadosCount: number;
    fontesCount: number;
    potencialBRL: number;
    editaisComValor: number;
  }>;
  recordEditalCatalogAccess(
    userId: string,
    editalId: string,
    limit: number,
  ): Promise<{ allowed: boolean; used: number; limit: number; accessedIds: string[] }>;
  adminGetEditalById(id: string): Promise<any | null>;
};

function createServiceSupabase(config: AppConfig): SupabaseClient | null {
  const url = config.supabase.url;
  const key = config.supabase.serviceRoleKey;
  if (!url || !key) return null;
  return createServerSupabaseClient(url, key);
}

const INDICACAO_AREA_TERMS: Record<string, string[]> = {
  tech: ["tecnologia", "tecnológico", "inovação", "software", "digital", "ti", "robótica", "ia", "inteligência artificial"],
  health: ["saúde", "health", "medicina", "biotecnologia", "farmácia"],
  agro: ["agro", "agronegócio", "agricultura", "rural", "agrícola", "alimentos"],
  energy: ["energia", "energético", "sustentável", "renovável", "bioenergia"],
  bio: ["bio", "biotecnologia", "biologia", "genética"],
};

function normalizeIndicacaoText(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const EDITAL_USAGE_METRIC = "edital_catalog_views";
const memEditalUsage = new Map<string, { period: string; ids: Set<string> }>();

function memEditalUsageBucket(userId: string) {
  const period = currentMonthKey();
  const cur = memEditalUsage.get(userId);
  if (!cur || cur.period !== period) {
    const next = { period, ids: new Set<string>() };
    memEditalUsage.set(userId, next);
    return next;
  }
  return cur;
}

let warnedMissingSubscriptionUsageTable = false;

/** PostgREST usa PGRST205 (schema cache); Postgres usa 42P01 — ambos quando a tabela não existe. */
function isMissingSubscriptionUsageTable(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = String(error?.code || "");
  const msg = String(error?.message || "");
  if (code === "42P01" || code === "PGRST205" || code === "PGRST200") return true;
  return /subscription_usage|schema cache|could not find the table/i.test(msg);
}

function warnMissingSubscriptionUsageTableOnce(context: string, error: { code?: string; message?: string }) {
  if (warnedMissingSubscriptionUsageTable) return;
  warnedMissingSubscriptionUsageTable = true;
  console.warn(
    `[subscription_usage] Tabela ausente (${context}); usando contador em memória. ` +
      `Execute origemlab-services/sql/20260607_subscription_usage.sql no Supabase. (${error.message || error.code})`,
  );
}

function parseIndicacaoDate(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!s || /invalid date/i.test(s)) return null;
  const iso = s.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (iso) {
    const d = new Date(`${iso}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }
  const br = s.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
  if (br) {
    const d = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  const brShort = s.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})\b/);
  if (brShort) {
    const yy = Number(brShort[3]);
    const year = yy <= 69 ? 2000 + yy : 1900 + yy;
    const d = new Date(year, Number(brShort[2]) - 1, Number(brShort[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  // Textos longos / JSON: pegar a data mais tardia mencionada
  const tokens = s.match(/\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/g) || [];
  const dates: Date[] = [];
  for (const token of tokens) {
    const d = parseIndicacaoDate(token);
    if (d) dates.push(d);
  }
  if (dates.length) return new Date(Math.max(...dates.map((d) => d.getTime())));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function editalIndicacaoDeadline(row: any): Date | null {
  const timeline = typeof row.timeline_estimada === "string" ? (() => {
    try {
      return JSON.parse(row.timeline_estimada);
    } catch {
      return null;
    }
  })() : row.timeline_estimada;
  const fases = Array.isArray(timeline?.fases) ? timeline.fases : [];

  const isSubmissaoOuInscricao = (fase: any): boolean => {
    const nome = String(fase?.nome || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return (
      nome.includes("submiss") ||
      nome.includes("envio") ||
      nome.includes("inscri") ||
      nome.includes("propost")
    );
  };

  const fasesPreferidas = fases.filter(isSubmissaoOuInscricao);
  const fasesAlvo = fasesPreferidas.length > 0 ? fasesPreferidas : fases;

  const timelineDates = fasesAlvo
    .map((f: any) => parseIndicacaoDate(f?.data_fim) || parseIndicacaoDate(f?.prazo) || parseIndicacaoDate(f?.fim))
    .filter(Boolean) as Date[];
  if (timelineDates.length) return new Date(Math.max(...timelineDates.map((d) => d.getTime())));

  const prazo = parseIndicacaoDate(row.prazo_inscricao);
  if (prazo) return prazo;
  return parseIndicacaoDate(row.data_encerramento);
}

function scoreIndicacao(profile: any, edital: any): { score: number; motivos: string[] } {
  const motivos: string[] = [];
  let score = 10;

  const rawType = String(profile?.user_type || "pesquisador");
  const userType =
    rawType === "pessoa-empresa" || rawType === "ambos" ? "consultor" : rawType;

  if (userType === "pesquisador") {
    if (edital.is_researcher === true) {
      score += 45;
      motivos.push("Elegível para pesquisadores/ICTs");
    } else if (edital.is_researcher === false) {
      score -= 50;
      motivos.push("Não parece voltado a pesquisadores");
    }
  } else if (userType === "consultor") {
    if (edital.is_company === true) {
      score += 45;
      motivos.push("Elegível para empresas/startups");
    } else if (edital.is_company === false) {
      score -= 50;
      motivos.push("Não parece voltado a empresas");
    }
  } else {
    if (edital.is_researcher === true || edital.is_company === true) {
      score += 35;
      motivos.push("Compatível com seu tipo de perfil");
    }
  }

  const profileArea = String(profile?.area || "").trim();
  if (profileArea) {
    const terms = INDICACAO_AREA_TERMS[profileArea] || [profileArea];
    const haystack = normalizeIndicacaoText(
      [edital.area, edital.titulo, edital.descricao, edital.sobre_programa, edital.criterios_elegibilidade].join(" "),
    );
    const matched = terms.find((t) => haystack.includes(normalizeIndicacaoText(t)));
    if (matched) {
      score += 25;
      motivos.push("Área alinhada ao seu perfil");
    }
  }

  const deadline = editalIndicacaoDeadline(edital);
  if (deadline) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(deadline);
    end.setHours(23, 59, 59, 999);
    if (end.getTime() >= today.getTime()) {
      score += 15;
      motivos.push("Prazo ainda aberto");
    } else {
      score -= 35;
      motivos.push("Prazo possivelmente encerrado");
    }
  } else {
    score += 5;
    motivos.push("Prazo não identificado automaticamente");
  }

  if (edital.valor_projeto || edital.valor) {
    score += 5;
    motivos.push("Possui informação de valor/financiamento");
  }
  if (edital.sobre_programa || edital.criterios_elegibilidade) score += 5;

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  return { score: finalScore, motivos: [...new Set(motivos)].slice(0, 5) };
}

function scoreProjetoContraEdital(projeto: any, edital: any): { score: number; motivos: string[] } {
  const motivos: string[] = [];
  let score = 10;

  const publico = String(projeto?.publico_alvo || "ambos");
  if (publico === "pesquisador") {
    if (edital.is_researcher === true) {
      score += 40;
      motivos.push("Edital alinhado a pesquisadores");
    } else if (edital.is_researcher === false) {
      score -= 40;
      motivos.push("Edital não voltado a pesquisadores");
    }
  } else if (publico === "empresa") {
    if (edital.is_company === true) {
      score += 40;
      motivos.push("Edital alinhado a empresas");
    } else if (edital.is_company === false) {
      score -= 40;
      motivos.push("Edital não voltado a empresas");
    }
  } else {
    if (edital.is_researcher === true || edital.is_company === true) {
      score += 30;
      motivos.push("Público do projeto compatível com o edital");
    }
  }

  const projetoArea = String(projeto?.area || "").trim();
  const conteudo = projeto?.conteudo && typeof projeto.conteudo === "object" ? projeto.conteudo : {};
  const palavras = Array.isArray(conteudo.palavras_chave)
    ? conteudo.palavras_chave.map(String)
    : [];
  const projetoHay = normalizeIndicacaoText(
    [
      projeto?.titulo,
      projeto?.resumo,
      projeto?.objetivos,
      projeto?.area,
      conteudo.origem?.tipo,
      conteudo.origem?.descricao,
      ...palavras,
      conteudo.resumo_executivo,
      conteudo.caracterizacao_problema,
      conteudo.objetivo_geral,
      conteudo.objetivos_especificos,
      conteudo.metodologia,
      conteudo.cronograma,
      conteudo.resultados_esperados,
      conteudo.impactos,
      conteudo.equipe,
      conteudo.instituicoes,
      conteudo.orcamento_estimado,
      conteudo.referencias,
      conteudo.texto_completo,
      // fallback: qualquer JSON legado
      JSON.stringify(conteudo),
    ]
      .filter(Boolean)
      .join(" "),
  );
  const editalHay = normalizeIndicacaoText(
    [edital.area, edital.titulo, edital.descricao, edital.sobre_programa, edital.criterios_elegibilidade].join(" "),
  );

  if (projetoArea) {
    const terms = INDICACAO_AREA_TERMS[projetoArea] || [projetoArea];
    const matched = terms.find((t) => editalHay.includes(normalizeIndicacaoText(t)));
    if (matched) {
      score += 30;
      motivos.push("Área do projeto alinhada ao edital");
    }
  }

  // Sobreposição lexical simples (tokens >= 4 chars)
  const tokens = [...new Set(projetoHay.split(/[^a-z0-9]+/).filter((t) => t.length >= 4))].slice(0, 80);
  let hits = 0;
  for (const t of tokens) {
    if (editalHay.includes(t)) hits += 1;
  }
  if (hits >= 5) {
    score += Math.min(30, hits * 2);
    motivos.push("Conteúdo escrito do projeto compatível com o edital");
  } else if (hits >= 3) {
    score += Math.min(25, hits * 3);
    motivos.push("Conteúdo do projeto compatível com o edital");
  } else if (hits >= 1) {
    score += hits * 4;
  }

  const deadline = editalIndicacaoDeadline(edital);
  if (deadline) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(deadline);
    end.setHours(23, 59, 59, 999);
    if (end.getTime() >= today.getTime()) {
      score += 15;
      motivos.push("Prazo ainda aberto");
    } else {
      score -= 35;
      motivos.push("Prazo possivelmente encerrado");
    }
  }

  if (edital.valor_projeto || edital.valor) score += 5;

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  return { score: finalScore, motivos: [...new Set(motivos)].slice(0, 5) };
}

async function refreshMyIndicacoesFallback(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
  empresaId?: string | null,
): Promise<number> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("user_id,user_type,area,curriculum_data")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);

  let scoringProfile: Record<string, unknown> = profile || { user_type: "pesquisador" };
  const scopedEmpresaId = empresaId ? String(empresaId).trim() : "";

  if (scopedEmpresaId) {
    const { data: empresa, error: empresaError } = await supabase
      .from("empresas")
      .select("id,owner_user_id,area,dados,razao_social")
      .eq("id", scopedEmpresaId)
      .eq("owner_user_id", userId)
      .maybeSingle();
    if (empresaError) throw new Error(empresaError.message);
    if (!empresa) throw new Error("empresa_id inválido ou sem permissão");
    const dados = empresa.dados && typeof empresa.dados === "object" ? (empresa.dados as Record<string, unknown>) : {};
    scoringProfile = {
      user_type: "consultor",
      area: empresa.area || profile?.area || "",
      curriculum_data: {
        resumo: dados.descricao || empresa.razao_social || "",
      },
    };
  }

  const { data: editais, error: editaisError } = await supabase
    .from("editais_corretos")
    .select(
      "id,numero,titulo,descricao,data_encerramento,status,valor,valor_projeto,prazo_inscricao,area,orgao,fonte,link,is_researcher,is_company,sobre_programa,criterios_elegibilidade,timeline_estimada,validado_em,criado_em,atualizado_em",
    )
    .order("validado_em", { ascending: false })
    .limit(500);
  if (editaisError) throw new Error(editaisError.message);

  const ranked = (editais || [])
    .map((edital: any) => {
      const scored = scoreIndicacao(scoringProfile, edital);
      return { edital, ...scored };
    })
    .filter((x) => x.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(50, limit)));

  let del = supabase.from("edital_indicacoes").delete().eq("user_id", userId);
  del = scopedEmpresaId ? del.eq("empresa_id", scopedEmpresaId) : del.is("empresa_id", null);
  const { error: deleteError } = await del;
  if (deleteError) throw new Error(deleteError.message);

  if (!ranked.length) return 0;

  const rows = ranked.map((x) => ({
    user_id: userId,
    empresa_id: scopedEmpresaId || null,
    edital_id: x.edital.id,
    score: x.score,
    motivos: x.motivos,
    gerado_em: new Date().toISOString(),
  }));
  const { error: insertError } = await supabase.from("edital_indicacoes").insert(rows);
  if (insertError) throw new Error(insertError.message);
  return rows.length;
}

export function buildGateways(config: AppConfig): { stripe: StripeGateway; supabase: SupabaseGateway } {
  const supabase = createServiceSupabase(config);

  const stripeKey = config.stripe.secretKey;
  const webhookSecret = config.stripe.webhookSecret;
  const stripe = stripeKey ? new Stripe(stripeKey) : null;

  const stripeGateway: StripeGateway = {
    hasStripe: !!stripe,
    async createCheckoutSession(input) {
      if (!stripe) throw new Error("Stripe not configured");
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.userId,
        customer_email: input.userEmail || undefined,
        metadata: {
          supabase_user_id: input.userId,
          plan_key: input.planKey,
        },
        subscription_data: {
          metadata: {
            supabase_user_id: input.userId,
            plan_key: input.planKey,
          },
        },
      });
      return { url: session.url };
    },
    async createPortalSession(input) {
      if (!stripe) throw new Error("Stripe not configured");
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      return { url: session.url };
    },
    constructWebhookEvent(input) {
      if (!stripe || !webhookSecret) throw new Error("Stripe not configured");
      return stripe.webhooks.constructEvent(input.rawBody, input.signature, webhookSecret);
    },
    async retrieveSubscription(subscriptionId) {
      if (!stripe) throw new Error("Stripe not configured");
      return await stripe.subscriptions.retrieve(subscriptionId);
    },
    async createOrUpdateProduct(input) {
      if (!stripe) throw new Error("Stripe not configured");
      if (!input.existingProductId) {
        const product = await stripe.products.create({
          name: input.title,
          metadata: { plan_key: input.planKey },
        });
        return product.id;
      }
      await stripe.products.update(input.existingProductId, { name: input.title });
      return input.existingProductId;
    },
    async createPrice(input) {
      if (!stripe) throw new Error("Stripe not configured");
      const price = await stripe.prices.create({
        product: input.productId,
        currency: input.currency,
        unit_amount: Math.round(input.unitAmountCents),
        recurring: { interval: "month" },
        nickname: `${input.planKey}:${input.currency}:${input.unitAmountCents}`,
        metadata: { plan_key: input.planKey },
      });
      return price.id;
    },
    async deactivatePrice(priceId) {
      if (!stripe) throw new Error("Stripe not configured");
      try {
        await stripe.prices.update(priceId, { active: false });
      } catch {
        // ignore
      }
    },
    async syncSubscriptionForUser(userId, email) {
      if (!stripe) throw new Error("Stripe not configured");
      return syncActiveSubscriptionForUser(stripe, userId, email);
    },
  };

  const supabaseGateway: SupabaseGateway = {
    isConfigured: !!supabase,
    async getUserFromAccessToken(token) {
      if (!supabase) return null;
      const { data, error } = await supabase.auth.getUser(token);
      if (error) return null;
      return data.user ?? null;
    },
    async getAuthUserById(userId) {
      if (!supabase) return null;
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error) return null;
      return data.user ?? null;
    },
    async adminListUsers({ page, perPage }) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(error.message);
      return { users: data?.users || [] };
    },
    async profilesByUserIds(userIds) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data } = await supabase
        .from("profiles")
        .select(
          "user_id, is_admin, is_blocked, user_type, has_cnpj, cnpj, lattes_id, criado_em, subscription_plan_key, subscription_status, stripe_customer_id, stripe_subscription_id",
        )
        .in("user_id", userIds);
      return data || [];
    },
    async profileIsAdmin(userId) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(`Erro ao ler perfil admin: ${error.message}`);
      return Boolean((data as any)?.is_admin);
    },
    async upsertProfileFlags(userId, patch) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const row: any = { user_id: userId };
      if (patch.is_admin !== undefined) row.is_admin = Boolean(patch.is_admin);
      if (patch.is_blocked !== undefined) row.is_blocked = Boolean(patch.is_blocked);
      const { data, error } = await supabase
        .from("profiles")
        .upsert(row, { onConflict: "user_id" })
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async listBillingPlans() {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("billing_plans")
        .select("*")
        .order("plan_key", { ascending: true });
      if (error) throw new Error(error.message);
      return data || [];
    },
    async upsertBillingPlan(row) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("billing_plans")
        .upsert(row, { onConflict: "plan_key" })
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async getBillingPlan(planKey) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("billing_plans")
        .select("*")
        .eq("plan_key", planKey)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },
    async getActivePriceIdForPlan(planKey) {
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
    },
    async getStripeCustomerIdForUser(userId) {
      if (!supabase) throw new Error("Supabase service role não configurada");
      const { data, error } = await supabase
        .from("profiles")
        .select("stripe_customer_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return null;
      const id = (data as any)?.stripe_customer_id;
      return typeof id === "string" && id.trim() ? id.trim() : null;
    },
    async updateProfileByUserId(userId, patch) {
      if (!supabase) throw new Error("Supabase service role not configured");
      const { error } = await supabase.from("profiles").update(patch).eq("user_id", userId);
      if (error) throw error;
    },
    async findUserIdByStripeSubscriptionId(subId) {
      if (!supabase) return null;
      const { data } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("stripe_subscription_id", subId)
        .maybeSingle();
      const userId = (data as any)?.user_id;
      return typeof userId === "string" && userId.trim() ? userId : null;
    },
    async clearSubscriptionBySubscriptionId(subId) {
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
        .eq("stripe_subscription_id", subId);
      if (error) throw error;
    },

    async adminListPropostas({ limit, offset, status, userId, editalId, empresaId }) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      let q = supabase
        .from("propostas")
        .select(
          "id,user_id,edital_id,empresa_id,projeto_id,status,progresso,gerado_com_ia,criado_em,atualizado_em",
          { count: "exact" },
        )
        .order("atualizado_em", { ascending: false });
      if (status) q = q.eq("status", status);
      if (userId) q = q.eq("user_id", userId);
      if (editalId) q = q.eq("edital_id", editalId);
      if (empresaId) q = q.eq("empresa_id", empresaId);
      q = q.range(offset, offset + limit - 1);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { count: count ?? null, rows: data || [] };
    },

    async adminUpdateProposta(id, patch) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("propostas")
        .update(patch)
        .eq("id", id)
        .select("id,status,progresso,atualizado_em")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    async adminListEditais({ limit, offset, q: qtext, fonte, status, ativo }) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");

      // Dashboard: edital ativo = janela MM/AAAA (mês atual → dez) + anos +1…+4
      const isEditalAtivoDashboard = (row: any): boolean =>
        isEditalAtivoByDatePatterns({
          titulo: row.titulo,
          descricao: row.descricao,
          prazo_inscricao: row.prazo_inscricao,
          data_encerramento: row.data_encerramento,
          timeline_estimada: row.timeline_estimada,
          status: row.status,
          numero: row.numero,
        });

      if (ativo === "dashboard") {
        let q = supabase
          .from("editais_corretos")
          .select(
            "id,numero,titulo,descricao,fonte,status,data_publicacao,data_encerramento,valor,valor_projeto,prazo_inscricao,area,orgao,link,is_researcher,is_company,timeline_estimada,validado_em,criado_em,atualizado_em",
          )
          .order("validado_em", { ascending: false })
          .range(0, 999);
        if (fonte) q = q.eq("fonte", fonte);
        if (status) q = q.eq("status", status);
        if (qtext) {
          const like = `%${qtext}%`;
          q = q.or(
            `titulo.ilike.${like},descricao.ilike.${like},numero.ilike.${like},orgao.ilike.${like},area.ilike.${like}`,
          );
        }
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const rows = (data || [])
          .filter((r: any) => r.is_researcher === true || r.is_company === true)
          .filter((r: any) => isEditalAtivoDashboard(r));
        const paged = rows.slice(offset, offset + limit);
        return { count: rows.length, rows: paged };
      }

      let q = supabase
        .from("editais_corretos")
        .select(
          "id,numero,titulo,descricao,fonte,status,data_publicacao,data_encerramento,valor,valor_projeto,prazo_inscricao,area,orgao,link,is_researcher,is_company,timeline_estimada,validado_em,criado_em,atualizado_em",
          { count: "exact" },
        )
        .order("validado_em", { ascending: false });
      if (fonte) q = q.eq("fonte", fonte);
      if (status) q = q.eq("status", status);
      if (qtext) {
        const like = `%${qtext}%`;
        q = q.or(
          `titulo.ilike.${like},descricao.ilike.${like},numero.ilike.${like},orgao.ilike.${like},area.ilike.${like}`,
        );
      }
      if (ativo === "1" || ativo === "0") {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, "0");
        const dd = String(today.getDate()).padStart(2, "0");
        const todayIso = `${yyyy}-${mm}-${dd}`;
        if (ativo === "1") q = q.or(`data_encerramento.gte.${todayIso},status.ilike.%abert%`);
        else q = q.or(`data_encerramento.lt.${todayIso},status.ilike.%encerr%,status.ilike.%finaliz%`);
      }
      q = q.range(offset, offset + limit - 1);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { count: count ?? null, rows: data || [] };
    },

    async adminGetEditalById(id) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const safeId = String(id || "").trim();
      if (!safeId) return null;
      const { data, error } = await supabase
        .from("editais_corretos")
        .select(
          "id,numero,titulo,descricao,fonte,status,data_publicacao,data_encerramento,valor,valor_projeto,prazo_inscricao,area,orgao,link,is_researcher,is_company,timeline_estimada,sobre_programa,criterios_elegibilidade,localizacao,vagas,validado_em,criado_em,atualizado_em",
        )
        .eq("id", safeId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },

    async adminUpdateEdital(id, patch) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("editais_corretos")
        .update(patch)
        .eq("id", id)
        .select(
          "id,numero,titulo,descricao,fonte,status,data_publicacao,data_encerramento,valor,valor_projeto,prazo_inscricao,area,orgao,link,is_researcher,is_company,validado_em,criado_em,atualizado_em",
        )
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    async adminGetEditalDocuments({ editalId, limit, offset }) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const eid = String(editalId).trim();
      if (!eid) throw new Error("editalId inválido");

      // PDFs status
      const { data: pdfsData, error: pdfsErr } = await supabase
        .from("edital_pdfs")
        .select("id,file_id,edital_id,caminho_storage,nome_arquivo,url_original,tamanho_bytes,tipo_mime,is_processed")
        .eq("edital_id", eid)
        .order("criado_em", { ascending: false });
      if (pdfsErr) throw new Error(pdfsErr.message);
      const pdfs = (pdfsData || []) as any[];
      const pdfs_total = pdfs.length;
      const pdfs_processed = pdfs.filter((p) => p?.is_processed === true).length;

      // Documents counts
      const countDocs = await supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("metadata->>edital_id", eid);
      if (countDocs.error) throw new Error(countDocs.error.message);
      const documents_total = countDocs.count ?? 0;

      const countMissing = await supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("metadata->>edital_id", eid)
        .is("embedding", null);
      if (countMissing.error) throw new Error(countMissing.error.message);
      const documents_missing_embeddings = countMissing.count ?? 0;

      // Documents rows (paged) - do not return full embeddings
      const rangeStart = Math.max(0, offset);
      const rangeEnd = rangeStart + Math.max(1, limit) - 1;
      const { data: docsData, error: docsErr } = await supabase
        .from("documents")
        .select("id,file_id,content,metadata,embedding")
        .eq("metadata->>edital_id", eid)
        .order("id", { ascending: true })
        .range(rangeStart, rangeEnd);
      if (docsErr) throw new Error(docsErr.message);
      const documents_rows = (docsData || []).map((r: any) => ({
        id: r.id,
        file_id: r.file_id ?? null,
        metadata: r.metadata ?? null,
        has_embedding: Array.isArray(r.embedding) ? r.embedding.length > 0 : Boolean(r.embedding),
        content_preview:
          typeof r.content === "string" ? r.content.trim().slice(0, 1200) : "",
      }));

      // Last extraction results (if available) live in `editais` (not `editais_corretos`)
      const { data: extraction, error: extErr } = await supabase
        .from("editais")
        .select(
          "id,informacoes_processadas_em,valor_projeto,prazo_inscricao,localizacao,vagas,is_researcher,is_company,sobre_programa,criterios_elegibilidade,timeline_estimada,atualizado_em",
        )
        .eq("id", eid)
        .maybeSingle();
      if (extErr) throw new Error(extErr.message);

      return {
        edital_id: eid,
        pdfs,
        pdfs_total,
        pdfs_processed,
        documents_total,
        documents_missing_embeddings,
        documents_rows,
        extraction: extraction || null,
      };
    },

    async adminListRedacoes({ limit, offset, status, userId, propostaId }) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      let q = supabase
        .from("redacoes_ai")
        .select("id,user_id,proposta_id,edital_id,field_id,field_name,status,model,provider,created_at,updated_at", { count: "exact" })
        .order("created_at", { ascending: false });
      if (status) q = q.eq("status", status);
      if (userId) q = q.eq("user_id", userId);
      if (propostaId) q = q.eq("proposta_id", propostaId);
      q = q.range(offset, offset + limit - 1);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { count: count ?? null, rows: data || [] };
    },

    async adminUpdateRedacaoStatus(id, status) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("redacoes_ai")
        .update({ status })
        .eq("id", id)
        .select("id,status,updated_at")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    async createProposta(input) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const projetoId = input.projetoId ? String(input.projetoId).trim() : "";
      let empresaId = input.empresaId ? String(input.empresaId).trim() : "";

      if (projetoId) {
        const { data: projeto, error: projetoError } = await supabase
          .from("projetos")
          .select("id,owner_user_id,empresa_id")
          .eq("id", projetoId)
          .eq("owner_user_id", input.userId)
          .maybeSingle();
        if (projetoError) throw new Error(projetoError.message);
        if (!projeto) throw new Error("projeto_id inválido ou sem permissão");
        if (!empresaId && projeto.empresa_id) empresaId = String(projeto.empresa_id);
      }

      if (empresaId) {
        const { data: empresa, error: empresaError } = await supabase
          .from("empresas")
          .select("id")
          .eq("id", empresaId)
          .eq("owner_user_id", input.userId)
          .maybeSingle();
        if (empresaError) throw new Error(empresaError.message);
        if (!empresa) throw new Error("empresa_id inválido ou sem permissão");
      }

      const { data, error } = await supabase
        .from("propostas")
        .insert({
          edital_id: input.editalId,
          user_id: input.userId,
          status: "rascunho",
          progresso: 0,
          campos_formulario: input.campos_formulario || {},
          gerado_com_ia: input.gerado_com_ia,
          ...(projetoId ? { projeto_id: projetoId } : {}),
          ...(empresaId ? { empresa_id: empresaId } : {}),
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    async getPropostaForUser(userId, propostaId) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("propostas")
        .select("*")
        .eq("id", propostaId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;

      let edital_titulo: string | null = null;
      let edital_orgao: string | null = null;
      let edital_valor: string | null = null;
      let edital_fonte: string | null = null;

      const editalId = String((data as any).edital_id || "").trim();
      if (editalId) {
        const { data: edCorreto } = await supabase
          .from("editais_corretos")
          .select("titulo,orgao,valor_projeto,fonte")
          .eq("id", editalId)
          .maybeSingle();
        const ed = edCorreto as any;
        if (ed) {
          edital_titulo = ed.titulo ?? null;
          edital_orgao = ed.orgao ?? null;
          edital_valor = ed.valor_projeto ?? null;
          edital_fonte = ed.fonte ?? null;
        } else {
          const { data: edRaw } = await supabase
            .from("editais")
            .select("titulo,orgao,valor_projeto,fonte")
            .eq("id", editalId)
            .maybeSingle();
          const raw = edRaw as any;
          if (raw) {
            edital_titulo = raw.titulo ?? null;
            edital_orgao = raw.orgao ?? null;
            edital_valor = raw.valor_projeto ?? null;
            edital_fonte = raw.fonte ?? null;
          }
        }
      }

      return {
        ...(data as any),
        edital_titulo,
        edital_orgao,
        edital_valor,
        edital_fonte,
      };
    },

    async updatePropostaForUser(userId, propostaId, patch) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("propostas")
        .update(patch)
        .eq("id", propostaId)
        .eq("user_id", userId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    async deletePropostaForUser(userId, propostaId) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { error } = await supabase.from("propostas").delete().eq("id", propostaId).eq("user_id", userId);
      if (error) throw new Error(error.message);
    },

    async refreshMyIndicacoes(userId, limit, empresaId) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const scoped = empresaId ? String(empresaId).trim() : "";
      if (scoped) {
        const owned = await this.getEmpresaForUser(userId, scoped);
        if (!owned) throw new Error("empresa_id inválido ou sem permissão");
      }
      const rpcArgs: Record<string, unknown> = { p_user_id: userId, p_limit: limit };
      if (scoped) rpcArgs.p_empresa_id = scoped;
      const { data, error } = await supabase.rpc("refresh_my_indicacoes", rpcArgs as any);
      if (error) {
        const msg = String(error.message || "");
        if (/refresh_my_indicacoes|schema cache|function .*not found|could not find the function|p_empresa_id/i.test(msg)) {
          console.warn(`[indicacoes] RPC refresh_my_indicacoes ausente/incompatível; usando fallback local. (${msg})`);
          return refreshMyIndicacoesFallback(supabase, userId, limit, scoped || null);
        }
        throw new Error(error.message);
      }
      return typeof data === "number" ? data : Number(data ?? 0);
    },

    async fetchMyIndicacoes(userId, limit, empresaId) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const scoped = empresaId ? String(empresaId).trim() : "";
      let q = supabase
        .from("edital_indicacoes")
        .select("edital_id,empresa_id,score,motivos,gerado_em")
        .eq("user_id", userId)
        .order("score", { ascending: false })
        .order("gerado_em", { ascending: false })
        .limit(limit);
      q = scoped ? q.eq("empresa_id", scoped) : q.is("empresa_id", null);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = data || [];
      const ids = [...new Set(rows.map((r: any) => String(r.edital_id || "").trim()).filter(Boolean))];
      if (!ids.length) return [];

      const { data: editais, error: editaisError } = await supabase
        .from("editais_corretos")
        .select("*")
        .in("id", ids);
      if (editaisError) throw new Error(editaisError.message);

      const byId = new Map((editais || []).map((e: any) => [String(e.id), e]));
      return rows
        .map((r: any) => ({
          score: r.score,
          motivos: r.motivos,
          gerado_em: r.gerado_em,
          empresa_id: r.empresa_id ?? null,
          edital: byId.get(String(r.edital_id)) || null,
        }))
        .filter((r: any) => r.edital != null);
    },

    async getProfile(userId) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },

    async updateProfile(userId, patch) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const normalized = { ...patch };
      if (normalized.user_type === "pessoa-empresa" || normalized.user_type === "ambos") {
        normalized.user_type = "consultor";
      }
      // NOT NULL em profiles: nunca gravar null via upsert parcial.
      for (const key of ["data_collection_consent", "has_cnpj", "user_type"] as const) {
        if (normalized[key] === null || normalized[key] === undefined) {
          delete normalized[key];
        }
      }
      const { data, error } = await supabase
        .from("profiles")
        .upsert({ user_id: userId, ...normalized }, { onConflict: "user_id" })
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },

    async listEmpresasForUser(userId) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("empresas")
        .select("*")
        .eq("owner_user_id", userId)
        .order("atualizado_em", { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },

    async getEmpresaForUser(userId, empresaId) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("empresas")
        .select("*")
        .eq("id", empresaId)
        .eq("owner_user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },

    async createEmpresa(input) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const cnpj = input.cnpj ? String(input.cnpj).replace(/\D/g, "").slice(0, 14) : null;
      const { data, error } = await supabase
        .from("empresas")
        .insert({
          owner_user_id: input.userId,
          razao_social: String(input.razao_social || "").trim() || "Empresa",
          nome_fantasia: input.nome_fantasia ? String(input.nome_fantasia).trim() : null,
          cnpj: cnpj || null,
          area: input.area ? String(input.area).trim() : null,
          dados: input.dados || {},
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    async updateEmpresaForUser(userId, empresaId, patch) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const allowed: Record<string, any> = { atualizado_em: new Date().toISOString() };
      for (const key of ["razao_social", "nome_fantasia", "area", "dados"] as const) {
        if (patch[key] !== undefined) allowed[key] = patch[key];
      }
      if (patch.cnpj !== undefined) {
        allowed.cnpj = patch.cnpj == null ? null : String(patch.cnpj).replace(/\D/g, "").slice(0, 14) || null;
      }
      const { data, error } = await supabase
        .from("empresas")
        .update(allowed)
        .eq("id", empresaId)
        .eq("owner_user_id", userId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    async deleteEmpresaForUser(userId, empresaId) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { error } = await supabase.from("empresas").delete().eq("id", empresaId).eq("owner_user_id", userId);
      if (error) throw new Error(error.message);
    },

    async listProjetosForUser(userId, empresaId) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      let q = supabase
        .from("projetos")
        .select("*")
        .eq("owner_user_id", userId)
        .order("atualizado_em", { ascending: false });
      if (empresaId) q = q.eq("empresa_id", empresaId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    },

    async getProjetoForUser(userId, projetoId) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data, error } = await supabase
        .from("projetos")
        .select("*")
        .eq("id", projetoId)
        .eq("owner_user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },

    async createProjeto(input) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      if (input.empresa_id) {
        const owned = await this.getEmpresaForUser(input.userId, input.empresa_id);
        if (!owned) throw new Error("empresa_id inválido ou sem permissão");
      }
      const publico = ["pesquisador", "empresa", "ambos"].includes(String(input.publico_alvo || ""))
        ? String(input.publico_alvo)
        : "ambos";
      const status = ["rascunho", "ativo", "arquivado"].includes(String(input.status || ""))
        ? String(input.status)
        : "rascunho";
      const { data, error } = await supabase
        .from("projetos")
        .insert({
          owner_user_id: input.userId,
          empresa_id: input.empresa_id || null,
          titulo: String(input.titulo || "").trim() || "Projeto sem título",
          resumo: input.resumo ? String(input.resumo).trim() : null,
          objetivos: input.objetivos ? String(input.objetivos).trim() : null,
          area: input.area ? String(input.area).trim() : null,
          publico_alvo: publico,
          status,
          conteudo: input.conteudo || {},
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    async updateProjetoForUser(userId, projetoId, patch) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const allowed: Record<string, any> = { atualizado_em: new Date().toISOString() };
      for (const key of ["titulo", "resumo", "objetivos", "area", "conteudo"] as const) {
        if (patch[key] !== undefined) allowed[key] = patch[key];
      }
      if (patch.publico_alvo !== undefined) {
        if (!["pesquisador", "empresa", "ambos"].includes(String(patch.publico_alvo))) {
          throw new Error("publico_alvo inválido");
        }
        allowed.publico_alvo = patch.publico_alvo;
      }
      if (patch.status !== undefined) {
        if (!["rascunho", "ativo", "arquivado"].includes(String(patch.status))) {
          throw new Error("status inválido");
        }
        allowed.status = patch.status;
      }
      if (patch.empresa_id !== undefined) {
        if (patch.empresa_id) {
          const owned = await this.getEmpresaForUser(userId, String(patch.empresa_id));
          if (!owned) throw new Error("empresa_id inválido ou sem permissão");
          allowed.empresa_id = patch.empresa_id;
        } else {
          allowed.empresa_id = null;
        }
      }
      const { data, error } = await supabase
        .from("projetos")
        .update(allowed)
        .eq("id", projetoId)
        .eq("owner_user_id", userId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },

    async deleteProjetoForUser(userId, projetoId) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { error } = await supabase.from("projetos").delete().eq("id", projetoId).eq("owner_user_id", userId);
      if (error) throw new Error(error.message);
    },

    async matchEditaisForProjeto(userId, projetoId, limit) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const projeto = await this.getProjetoForUser(userId, projetoId);
      if (!projeto) throw new Error("Projeto não encontrado");

      const { data: editais, error } = await supabase
        .from("editais_corretos")
        .select(
          "id,numero,titulo,descricao,data_encerramento,status,valor,valor_projeto,prazo_inscricao,area,orgao,fonte,link,is_researcher,is_company,sobre_programa,criterios_elegibilidade,timeline_estimada,criado_em,atualizado_em",
        )
        .order("validado_em", { ascending: false })
        .range(0, 499);
      if (error) throw new Error(error.message);

      const ranked = (editais || [])
        .map((edital: any) => {
          const { score, motivos } = scoreProjetoContraEdital(projeto, edital);
          return { score, motivos, edital };
        })
        .filter((r) => r.score >= 25)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return ranked;
    },

    async getReferralStats(userId) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const { data } = await supabase.from("referrals").select("status, ganhos_referrer").eq("referrer_id", userId);
      const referrals = (data as any[]) || [];
      const conversoes = referrals.filter((r) => r.status === "convertido").length;
      const ganhos = referrals.reduce((sum, r) => sum + (Number(r.ganhos_referrer) || 0), 0);
      const credito = 50;
      return { convites: referrals.length, conversoes, ganhos: Math.round(ganhos), potencial: conversoes * credito };
    },

    async fetchAiFieldContext(input) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");

      let editalId = input.editalId ? String(input.editalId).trim() : "";
      let formSummary = "";

      if (input.propostaId) {
        const pid = String(input.propostaId).trim();
        const { data: prop, error: propErr } = await supabase
          .from("propostas")
          .select("edital_id, campos_formulario")
          .eq("id", pid)
          .maybeSingle();
        if (propErr) throw new Error(propErr.message);
        if (prop?.edital_id && !editalId) editalId = String(prop.edital_id);
        if (prop?.campos_formulario) {
          try {
            const raw = JSON.stringify(prop.campos_formulario);
            formSummary = raw.length > 6000 ? `${raw.slice(0, 6000)}\n…` : raw;
          } catch {
            formSummary = "";
          }
        }
      }

      if (!formSummary && input.projetoId) {
        const projetoId = String(input.projetoId).trim();
        const { data: proj, error: projErr } = await supabase
          .from("projetos")
          .select("titulo,resumo,objetivos,area,publico_alvo,conteudo")
          .eq("id", projetoId)
          .maybeSingle();
        if (projErr) throw new Error(projErr.message);
        if (proj) {
          try {
            const payload = {
              tipo: "projeto",
              titulo: proj.titulo,
              resumo: proj.resumo,
              objetivos: proj.objetivos,
              area: proj.area,
              publico_alvo: proj.publico_alvo,
              conteudo: proj.conteudo,
            };
            const raw = JSON.stringify(payload);
            formSummary = raw.length > 6000 ? `${raw.slice(0, 6000)}\n…` : raw;
          } catch {
            formSummary = "";
          }
        }
      }

      let editalSummary = "";
      if (editalId) {
        const { data: ed, error: edErr } = await supabase
          .from("editais")
          .select(
            "numero,titulo,fonte,orgao,sobre_programa,criterios_elegibilidade,valor_projeto,prazo_inscricao,localizacao,vagas",
          )
          .eq("id", editalId)
          .maybeSingle();
        if (edErr) throw new Error(edErr.message);
        if (ed) {
          const lines = [
            ed.numero ? `Número: ${ed.numero}` : "",
            ed.titulo ? `Título: ${ed.titulo}` : "",
            ed.fonte ? `Fonte: ${ed.fonte}` : "",
            ed.orgao ? `Órgão: ${ed.orgao}` : "",
            ed.sobre_programa ? `Sobre: ${String(ed.sobre_programa).slice(0, 1500)}` : "",
            ed.criterios_elegibilidade
              ? `Elegibilidade: ${String(ed.criterios_elegibilidade).slice(0, 1200)}`
              : "",
            ed.valor_projeto ? `Valor: ${ed.valor_projeto}` : "",
            ed.prazo_inscricao ? `Prazo: ${ed.prazo_inscricao}` : "",
            ed.localizacao ? `Local: ${ed.localizacao}` : "",
            ed.vagas ? `Vagas: ${ed.vagas}` : "",
          ].filter(Boolean);
          editalSummary = lines.join("\n");
        }
      }

      return { editalSummary, formSummary };
    },

    async fetchEditalChatContext(input) {
      if (!supabase) throw new Error("Servidor sem SUPABASE_SERVICE_ROLE_KEY.");
      const editalId = String(input.editalId || "").trim();
      if (!editalId) throw new Error("editalId inválido");
      const maxChunks = Math.min(6, Math.max(1, input.maxChunks ?? 4));

      let ed: Record<string, any> | null = null;
      const { data: correto, error: corrErr } = await supabase
        .from("editais_corretos")
        .select(
          "numero,titulo,fonte,orgao,descricao,sobre_programa,criterios_elegibilidade,valor_projeto,prazo_inscricao,localizacao,vagas,timeline_estimada",
        )
        .eq("id", editalId)
        .maybeSingle();
      if (corrErr) throw new Error(corrErr.message);
      if (correto) ed = correto as Record<string, any>;
      else {
        const { data: raw, error: rawErr } = await supabase
          .from("editais")
          .select(
            "numero,titulo,fonte,orgao,descricao,sobre_programa,criterios_elegibilidade,valor_projeto,prazo_inscricao,localizacao,vagas,timeline_estimada",
          )
          .eq("id", editalId)
          .maybeSingle();
        if (rawErr) throw new Error(rawErr.message);
        ed = (raw as Record<string, any>) || null;
      }

      let editalSummary = "";
      if (ed) {
        const lines = [
          ed.numero ? `Número: ${ed.numero}` : "",
          ed.titulo ? `Título: ${ed.titulo}` : "",
          ed.fonte ? `Fonte: ${ed.fonte}` : "",
          ed.orgao ? `Órgão: ${ed.orgao}` : "",
          ed.descricao ? `Descrição: ${String(ed.descricao).slice(0, 800)}` : "",
          ed.sobre_programa ? `Sobre: ${String(ed.sobre_programa).slice(0, 1200)}` : "",
          ed.criterios_elegibilidade
            ? `Elegibilidade: ${String(ed.criterios_elegibilidade).slice(0, 1000)}`
            : "",
          ed.valor_projeto ? `Valor: ${ed.valor_projeto}` : "",
          ed.prazo_inscricao ? `Prazo: ${ed.prazo_inscricao}` : "",
          ed.localizacao ? `Local: ${ed.localizacao}` : "",
          ed.vagas ? `Vagas: ${ed.vagas}` : "",
        ].filter(Boolean);
        editalSummary = lines.join("\n");
      }

      const { data: docs, error: docsErr } = await supabase
        .from("documents")
        .select("content")
        .eq("metadata->>edital_id", editalId)
        .not("content", "is", null)
        .order("id", { ascending: true })
        .limit(24);
      if (docsErr) throw new Error(docsErr.message);

      const queryWords = String(input.query || "")
        .toLowerCase()
        .split(/\s+/)
        .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
        .filter((w) => w.length > 3);

      const scored = (docs || [])
        .map((row: any) => {
          const content = String(row?.content || "").trim();
          if (!content) return { content: "", score: 0 };
          const lower = content.toLowerCase();
          let score = 0;
          for (const w of queryWords) {
            if (lower.includes(w)) score += 1;
          }
          return { content, score };
        })
        .filter((x) => x.content);

      scored.sort((a, b) => b.score - a.score || b.content.length - a.content.length);
      const withHits = scored.filter((x) => x.score > 0);
      const pool = withHits.length > 0 ? withHits : scored;
      const excerpts = pool.slice(0, maxChunks).map((x) => x.content.slice(0, 1800));

      return { editalSummary, excerpts };
    },

    async getEditalCatalogUsage(userId) {
      if (!supabase) {
        const bucket = memEditalUsageBucket(userId);
        return { used: bucket.ids.size, accessedIds: [...bucket.ids] };
      }
      const periodKey = currentMonthKey();
      const { data, error } = await supabase
        .from("subscription_usage")
        .select("unique_ids")
        .eq("user_id", userId)
        .eq("metric", EDITAL_USAGE_METRIC)
        .eq("period_key", periodKey)
        .maybeSingle();
      if (error) {
        if (isMissingSubscriptionUsageTable(error)) {
          warnMissingSubscriptionUsageTableOnce("getEditalCatalogUsage", error);
          const bucket = memEditalUsageBucket(userId);
          return { used: bucket.ids.size, accessedIds: [...bucket.ids] };
        }
        throw new Error(error.message);
      }
      const accessedIds = Array.isArray((data as any)?.unique_ids)
        ? (data as any).unique_ids.map(String)
        : [];
      return { used: accessedIds.length, accessedIds };
    },

    async getEditalCatalogUsageCount(userId) {
      const usage = await this.getEditalCatalogUsage(userId);
      return usage.used;
    },

    async recordEditalCatalogAccess(userId, editalId, limit) {
      const safeLimit = Math.max(1, limit || FREE_EDITAIS_PER_MONTH);
      const edital = String(editalId || "").trim();
      if (!edital) return { allowed: false, used: 0, limit: safeLimit, accessedIds: [] };

      const recordInMemory = () => {
        const bucket = memEditalUsageBucket(userId);
        if (bucket.ids.has(edital)) {
          return { allowed: true, used: bucket.ids.size, limit: safeLimit, accessedIds: [...bucket.ids] };
        }
        if (bucket.ids.size >= safeLimit) {
          return { allowed: false, used: bucket.ids.size, limit: safeLimit, accessedIds: [...bucket.ids] };
        }
        bucket.ids.add(edital);
        return { allowed: true, used: bucket.ids.size, limit: safeLimit, accessedIds: [...bucket.ids] };
      };

      if (!supabase) return recordInMemory();

      const periodKey = currentMonthKey();
      const { data, error } = await supabase
        .from("subscription_usage")
        .select("unique_ids,count")
        .eq("user_id", userId)
        .eq("metric", EDITAL_USAGE_METRIC)
        .eq("period_key", periodKey)
        .maybeSingle();

      if (error) {
        if (isMissingSubscriptionUsageTable(error)) {
          warnMissingSubscriptionUsageTableOnce("recordEditalCatalogAccess", error);
          return recordInMemory();
        }
        throw new Error(error.message);
      }

      const ids: string[] = Array.isArray((data as any)?.unique_ids)
        ? (data as any).unique_ids.map(String)
        : [];
      if (ids.includes(edital)) {
        return { allowed: true, used: ids.length, limit: safeLimit, accessedIds: ids };
      }
      if (ids.length >= safeLimit) {
        return { allowed: false, used: ids.length, limit: safeLimit, accessedIds: ids };
      }

      const nextIds = [...ids, edital];
      const row = {
        user_id: userId,
        metric: EDITAL_USAGE_METRIC,
        period_key: periodKey,
        count: nextIds.length,
        unique_ids: nextIds,
        updated_at: new Date().toISOString(),
      };
      const { error: upsertErr } = await supabase
        .from("subscription_usage")
        .upsert(row, { onConflict: "user_id,metric,period_key" });
      if (upsertErr) {
        if (isMissingSubscriptionUsageTable(upsertErr)) {
          warnMissingSubscriptionUsageTableOnce("recordEditalCatalogAccess upsert", upsertErr);
          return recordInMemory();
        }
        throw new Error(upsertErr.message);
      }
      return { allowed: true, used: nextIds.length, limit: safeLimit, accessedIds: nextIds };
    },

    async getPublicCatalogStats() {
      if (!supabase) {
        return {
          editaisCorretosCount: 0,
          editaisAnalisadosCount: 0,
          fontesCount: 0,
          potencialBRL: 0,
          editaisComValor: 0,
        };
      }

      const [corretosCountRes, analisadosCountRes] = await Promise.all([
        supabase.from("editais_corretos").select("id", { count: "exact", head: true }),
        supabase.from("editais").select("id", { count: "exact", head: true }),
      ]);
      if (corretosCountRes.error) throw new Error(corretosCountRes.error.message);
      if (analisadosCountRes.error) throw new Error(analisadosCountRes.error.message);

      const fontes = new Set<string>();
      const valorRows: Array<{ valor_projeto?: unknown; valor?: unknown }> = [];
      const pageSize = 1000;
      let from = 0;
      for (;;) {
        const to = from + pageSize - 1;
        const { data, error } = await supabase
          .from("editais_corretos")
          .select("fonte,valor_projeto,valor")
          .range(from, to);
        if (error) throw new Error(error.message);
        const batch = data ?? [];
        for (const row of batch) {
          const fonte = String((row as any).fonte || "").trim();
          if (fonte) fontes.add(fonte);
          valorRows.push({
            valor_projeto: (row as any).valor_projeto,
            valor: (row as any).valor,
          });
        }
        if (batch.length < pageSize) break;
        from += pageSize;
      }

      const arrecadacao = computeArrecadacaoCatalogo(valorRows);
      return {
        editaisCorretosCount: corretosCountRes.count ?? 0,
        editaisAnalisadosCount: analisadosCountRes.count ?? 0,
        fontesCount: fontes.size,
        potencialBRL: arrecadacao.totalBRL,
        editaisComValor: arrecadacao.editaisComValor,
      };
    },
  };

  return { stripe: stripeGateway, supabase: supabaseGateway };
}


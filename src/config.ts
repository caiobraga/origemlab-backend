export type AppConfig = {
  port: number;
  /** Comma-separated origins or '*' */
  corsAllowOrigin: string;
  /** Base URL do app (front) para redirects do Stripe e CORS */
  appBaseUrl: string;
  /** Origens extras do front (CSV), ex.: CloudFront + S3 website */
  frontOrigins: string;
  auth: {
    cookieName: string;
    cookieSecure: boolean;
  };
  ollama: {
    baseUrl: string;
    model: string;
    timeoutMs: number;
  };
  webSearch: {
    tavilyApiKey: string | null;
    serperApiKey: string | null;
    maxQueries: number;
    maxResults: number;
  };
  supabase: {
    url: string | null;
    serviceRoleKey: string | null;
    anonKey: string | null;
  };
  stripe: {
    secretKey: string | null;
    webhookSecret: string | null;
  };
  /** When false, skips plan checks (dev only). Default: enforce. */
  subscriptionEnforce: boolean;
};

function readString(name: string): string | null {
  const v = process.env[name];
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t : null;
}

function readNumber(name: string, fallback: number): number {
  const raw = readString(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

export function loadConfig(): AppConfig {
  const port = readNumber("PORT", 8080);

  const corsAllowOrigin = readString("CORS_ALLOW_ORIGIN") ?? "*";

  // If empty, the HTTP layer may fall back to request Origin.
  const appBaseUrl = normalizeBaseUrl(readString("APP_BASE_URL") ?? "");
  const frontOrigins = readString("FRONT_ORIGINS") ?? "";

  const cookieName = readString("AUTH_COOKIE_NAME") ?? "origemlab_session";
  const cookieSecureRaw = readString("AUTH_COOKIE_SECURE");
  const cookieSecure =
    cookieSecureRaw != null
      ? cookieSecureRaw.toLowerCase() === "true"
      : (process.env.NODE_ENV ?? "").toLowerCase() === "production";

  const ollamaBaseUrl = normalizeBaseUrl(
    readString("OLLAMA_BASE_URL") ??
      "http://origemlab-ollama-nlb-312422980eebe2d0.elb.us-east-1.amazonaws.com:11434",
  );
  const ollamaModel = readString("OLLAMA_MODEL") ?? "qwen2.5:3b-instruct-q4_K_M";
  const ollamaTimeoutMs = readNumber("OLLAMA_TIMEOUT_MS", 180000);

  const supabaseUrl = readString("SUPABASE_URL") ?? readString("VITE_SUPABASE_URL");
  const supabaseServiceRoleKey =
    readString("SUPABASE_SERVICE_ROLE_KEY") ?? readString("VITE_SUPABASE_SERVICE_ROLE_KEY");
  const supabaseAnonKey = readString("SUPABASE_ANON_KEY") ?? readString("VITE_SUPABASE_ANON_KEY");

  const stripeSecretKey = readString("AISELFIE_STRIPE_SECRET_KEY");
  const stripeWebhookSecret = readString("AISELFIE_STRIPE_WEBHOOK_SECRET");

  return {
    port,
    corsAllowOrigin,
    appBaseUrl,
    frontOrigins,
    auth: {
      cookieName,
      cookieSecure,
    },
    ollama: {
      baseUrl: ollamaBaseUrl,
      model: ollamaModel,
      timeoutMs: ollamaTimeoutMs,
    },
    webSearch: {
      tavilyApiKey: readString("TAVILY_API_KEY"),
      serperApiKey: readString("SERPER_API_KEY"),
      maxQueries: Math.min(8, Math.max(1, readNumber("WEB_SEARCH_MAX_QUERIES", 4))),
      maxResults: Math.min(10, Math.max(1, readNumber("WEB_SEARCH_MAX_RESULTS", 5))),
    },
    supabase: {
      url: supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      anonKey: supabaseAnonKey,
    },
    stripe: {
      secretKey: stripeSecretKey,
      webhookSecret: stripeWebhookSecret,
    },
    subscriptionEnforce: (readString("SUBSCRIPTION_ENFORCE") ?? "true").toLowerCase() !== "false",
  };
}


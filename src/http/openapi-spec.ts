/**
 * OpenAPI 3.0 — alinhado a `http/router.ts`. Cookie = AUTH_COOKIE_NAME no servidor.
 */
export function buildOpenApiDocument(sessionCookieName: string): Record<string, unknown> {
  const e = (desc: string) => ({
    description: desc,
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } },
  });

  const cookieAuth: Record<string, unknown> = {
    type: "apiKey",
    in: "cookie",
    name: sessionCookieName,
    description: `Sessão após POST /api/auth/sign-in (httpOnly).`,
  };

  return {
    openapi: "3.0.3",
    info: {
      title: "Origemlab API",
      version: "1.0.0",
      description:
        "Cookie de sessão no login. Admin / Stripe checkout: `Authorization: Bearer <jwt>`. Webhook Stripe usa corpo bruto.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "Health" },
      { name: "Auth" },
      { name: "Editais" },
      { name: "App" },
      { name: "Stripe" },
      { name: "AI" },
      { name: "Admin" },
    ],
    components: {
      securitySchemes: {
        SessionCookie: cookieAuth,
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Access token Supabase.",
        },
      },
      schemas: {
        ErrorBody: {
          type: "object",
          properties: { error: { type: "string" } },
        },
        SignInBody: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", format: "password" },
          },
        },
        SignUpBody: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", format: "password" },
          },
        },
        CheckoutBody: {
          type: "object",
          required: ["planKey"],
          properties: { planKey: { type: "string", enum: ["pro", "empresas"] } },
        },
        GenerateFieldTextBody: {
          type: "object",
          required: ["field_name"],
          properties: {
            edital_id: { type: "string" },
            proposta_id: { type: "string" },
            field_name: { type: "string" },
            field_description: { type: "string" },
            word_limit: { type: "number" },
            char_limit: { type: "number" },
          },
          description: "Informe edital_id ou proposta_id.",
        },
        ImproveTextBody: {
          type: "object",
          required: ["field_name", "current_text"],
          properties: {
            edital_id: { type: "string" },
            proposta_id: { type: "string" },
            field_name: { type: "string" },
            field_description: { type: "string" },
            current_text: { type: "string" },
            word_limit: { type: "number" },
            char_limit: { type: "number" },
          },
        },
        CreatePropostaBody: {
          type: "object",
          required: ["edital_id"],
          properties: {
            edital_id: { type: "string" },
            editalId: { type: "string" },
            campos_formulario: { type: "object", additionalProperties: true },
            camposIniciais: { type: "object", additionalProperties: true },
            gerado_com_ia: { type: "boolean" },
          },
        },
        PatchBody: { type: "object", additionalProperties: true },
        RefreshIndicacoesBody: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
        },
        AdminPatchUserBody: {
          type: "object",
          properties: {
            is_admin: { type: "boolean" },
            is_blocked: { type: "boolean" },
          },
        },
        AdminUpsertPlanBody: {
          type: "object",
          required: ["title", "unit_amount_cents"],
          properties: {
            title: { type: "string" },
            currency: { type: "string", default: "brl" },
            interval: { type: "string", enum: ["month"], default: "month" },
            unit_amount_cents: { type: "integer", minimum: 1 },
            active: { type: "boolean" },
          },
        },
        AdminUpdatePropostaBody: {
          type: "object",
          properties: {
            status: { type: "string" },
            progresso: { type: "number" },
          },
        },
        AdminRedacaoStatusBody: {
          type: "object",
          required: ["status"],
          properties: { status: { type: "string" } },
        },
      },
    },
    paths: {
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Health check",
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
            },
          },
        },
      },
      "/api/stripe/webhook": {
        post: {
          tags: ["Stripe"],
          summary: "Stripe webhook (corpo bruto)",
          description: "Express usa `raw` nesta rota; testes manuais podem falhar na assinatura.",
          requestBody: {
            content: {
              "application/json": { schema: { type: "object" } },
            },
          },
          responses: { "200": { description: "OK" }, "400": { description: "Erro" } },
        },
      },
      "/api/auth/sign-in": {
        post: {
          tags: ["Auth"],
          summary: "Login",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/SignInBody" } } },
          },
          responses: {
            "200": { description: "Cookie definido", content: { "application/json": { schema: { type: "object" } } } },
            "400": e("Validação"),
            "401": e("Credenciais / Supabase"),
          },
        },
      },
      "/api/auth/sign-up": {
        post: {
          tags: ["Auth"],
          summary: "Cadastro",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/SignUpBody" } } },
          },
          responses: {
            "200": { description: "OK" },
            "400": e("Erro"),
          },
        },
      },
      "/api/auth/sign-out": {
        post: {
          tags: ["Auth"],
          summary: "Logout",
          security: [{ SessionCookie: [] }],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/auth/me": {
        get: {
          tags: ["Auth"],
          summary: "Sessão atual",
          security: [{ SessionCookie: [] }],
          responses: { "200": { description: "user ou null", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
      "/api/editais": {
        get: {
          tags: ["Editais"],
          summary: "Listar editais",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "fonte", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "ativo", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/editais/{id}": {
        get: {
          tags: ["Editais"],
          summary: "Detalhe edital",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK" }, "404": e("Não encontrado") },
        },
      },
      "/api/propostas": {
        get: {
          tags: ["App"],
          summary: "Listar propostas",
          security: [{ SessionCookie: [] }],
          responses: { "200": { description: "OK" }, "401": e("Não autenticado") },
        },
        post: {
          tags: ["App"],
          summary: "Criar proposta",
          security: [{ SessionCookie: [] }],
          requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/CreatePropostaBody" } } } },
          responses: { "200": { description: "OK" }, "400": e("Validação"), "401": e("Não autenticado") },
        },
      },
      "/api/propostas/{id}": {
        get: {
          tags: ["App"],
          summary: "Obter proposta",
          security: [{ SessionCookie: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK" }, "401": e("Não autenticado"), "404": e("Não encontrado") },
        },
        patch: {
          tags: ["App"],
          summary: "Atualizar proposta",
          security: [{ SessionCookie: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/PatchBody" } } } },
          responses: { "200": { description: "OK" }, "401": e("Não autenticado") },
        },
        delete: {
          tags: ["App"],
          summary: "Eliminar proposta",
          security: [{ SessionCookie: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK" }, "401": e("Não autenticado") },
        },
      },
      "/api/indicacoes/refresh": {
        post: {
          tags: ["App"],
          summary: "Refresh indicações",
          security: [{ SessionCookie: [] }],
          requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/RefreshIndicacoesBody" } } } },
          responses: { "200": { description: "OK" }, "401": e("Não autenticado") },
        },
      },
      "/api/indicacoes": {
        get: {
          tags: ["App"],
          summary: "Listar indicações",
          security: [{ SessionCookie: [] }],
          parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          responses: { "200": { description: "OK" }, "401": e("Não autenticado") },
        },
      },
      "/api/profile": {
        get: {
          tags: ["App"],
          summary: "Perfil",
          security: [{ SessionCookie: [] }],
          responses: { "200": { description: "OK" }, "401": e("Não autenticado") },
        },
        patch: {
          tags: ["App"],
          summary: "Atualizar perfil",
          security: [{ SessionCookie: [] }],
          requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/PatchBody" } } } },
          responses: { "200": { description: "OK" }, "401": e("Não autenticado") },
        },
      },
      "/api/referrals/stats": {
        get: {
          tags: ["App"],
          summary: "Referral stats",
          security: [{ SessionCookie: [] }],
          responses: { "200": { description: "OK" }, "401": e("Não autenticado") },
        },
      },
      "/api/stripe/create-checkout-session": {
        post: {
          tags: ["Stripe"],
          summary: "Stripe Checkout",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CheckoutBody" } } },
          },
          responses: { "200": { description: "URL checkout" }, "401": e("Não autorizado") },
        },
      },
      "/api/stripe/create-portal-session": {
        post: {
          tags: ["Stripe"],
          summary: "Stripe Portal",
          security: [{ BearerAuth: [] }],
          responses: { "200": { description: "URL portal" }, "401": e("Não autorizado") },
        },
      },
      "/api/generate-field-text": {
        post: {
          tags: ["AI"],
          summary: "Gerar texto (Ollama)",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/GenerateFieldTextBody" } } },
          },
          responses: { "200": { description: "OK" }, "400": e("Validação"), "500": e("Erro") },
        },
      },
      "/api/improve-text": {
        post: {
          tags: ["AI"],
          summary: "Melhorar texto (Ollama)",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ImproveTextBody" } } },
          },
          responses: { "200": { description: "OK" }, "400": e("Validação"), "500": e("Erro") },
        },
      },
      "/api/admin/users": {
        get: {
          tags: ["Admin"],
          summary: "Listar utilizadores",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer" } },
            { name: "perPage", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": { description: "OK" }, "401": e("Auth"), "403": e("Admin") },
        },
      },
      "/api/admin/users/{userId}": {
        patch: {
          tags: ["Admin"],
          summary: "Flags utilizador",
          security: [{ BearerAuth: [] }],
          parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/AdminPatchUserBody" } } },
          },
          responses: { "200": { description: "OK" }, "400": e("Validação"), "401": e("Auth"), "403": e("Admin") },
        },
      },
      "/api/admin/billing/plans": {
        get: {
          tags: ["Admin"],
          summary: "Planos billing",
          security: [{ BearerAuth: [] }],
          responses: { "200": { description: "OK" }, "401": e("Auth"), "403": e("Admin") },
        },
      },
      "/api/admin/billing/plans/{planKey}": {
        put: {
          tags: ["Admin"],
          summary: "Upsert plano",
          security: [{ BearerAuth: [] }],
          parameters: [{ name: "planKey", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/AdminUpsertPlanBody" } } },
          },
          responses: { "200": { description: "OK" }, "400": e("Validação"), "401": e("Auth"), "403": e("Admin") },
        },
      },
      "/api/admin/propostas": {
        get: {
          tags: ["Admin"],
          summary: "Propostas (admin)",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "userId", in: "query", schema: { type: "string" } },
            { name: "editalId", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" }, "401": e("Auth"), "403": e("Admin") },
        },
      },
      "/api/admin/propostas/{id}": {
        patch: {
          tags: ["Admin"],
          summary: "Atualizar proposta (admin)",
          security: [{ BearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/AdminUpdatePropostaBody" } } } },
          responses: { "200": { description: "OK" }, "401": e("Auth"), "403": e("Admin") },
        },
      },
      "/api/admin/editais": {
        get: {
          tags: ["Admin"],
          summary: "Editais (admin)",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "fonte", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "ativo", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" }, "401": e("Auth"), "403": e("Admin") },
        },
      },
      "/api/admin/editais/{id}": {
        patch: {
          tags: ["Admin"],
          summary: "Atualizar edital (admin)",
          security: [{ BearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/PatchBody" } } } },
          responses: { "200": { description: "OK" }, "401": e("Auth"), "403": e("Admin") },
        },
      },
      "/api/admin/redacoes": {
        get: {
          tags: ["Admin"],
          summary: "Redações (admin)",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "userId", in: "query", schema: { type: "string" } },
            { name: "propostaId", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" }, "401": e("Auth"), "403": e("Admin") },
        },
      },
      "/api/admin/redacoes/{id}": {
        patch: {
          tags: ["Admin"],
          summary: "Status redação",
          security: [{ BearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/AdminRedacaoStatusBody" } } },
          },
          responses: { "200": { description: "OK" }, "401": e("Auth"), "403": e("Admin") },
        },
      },
    },
  };
}

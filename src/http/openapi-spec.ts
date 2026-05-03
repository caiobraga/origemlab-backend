/**
 * OpenAPI 3.0 document for Swagger UI (`/`).
 * Mantido alinhado a `router.ts`; cookie de sessão segue `AUTH_COOKIE_NAME` no servidor.
 */
export function buildOpenApiDocument(sessionCookieName: string): Record<string, unknown> {
  const sessionCookie: Record<string, unknown> = {
    type: "apiKey",
    in: "cookie",
    name: sessionCookieName,
    description: `Sessão após POST /api/auth/sign-in (cookie httpOnly). Nome padrão: origemlab_session; em produção use o valor de AUTH_COOKIE_NAME.`,
  };

  return {
    openapi: "3.0.3",
    info: {
      title: "Origemlab API",
      version: "1.0.0",
      description:
        "Backend HTTP. **Sessão de usuário:** cookie definido no login. **Admin / Stripe checkout:** header `Authorization: Bearer <access_token_jwt>`. " +
        "O webhook Stripe usa corpo bruto JSON; testes manuais pelo Swagger podem falhar na verificação de assinatura.",
    },
    servers: [{ url: "/", description: "Mesmo host da API (ou preencha o host no Swagger: Servers)" }],
    tags: [
      { name: "Health", description: "Liveness" },
      { name: "Auth", description: "Login por cookie" },
      { name: "Editais", description: "Catálogo público" },
      { name: "App", description: "Requer sessão (cookie)" },
      { name: "Stripe", description: "Checkout e portal (Bearer); webhook" },
      { name: "AI", description: "Geração de texto (Ollama)" },
      { name: "Admin", description: "Bearer + perfil admin" },
    ],
    components: {
      securitySchemes: {
        SessionCookie: sessionCookie,
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Access token do Supabase (Authorization: Bearer ...). Usado em /api/admin/* e billing.",
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
          description: "Informe `edital_id` ou `proposta_id` (pelo menos um).",
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
          description: "Informe `edital_id` ou `proposta_id` (pelo menos um), além de `field_name` e `current_text`.",
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
        PatchPropostaBody: { type: "object", additionalProperties: true },
        PatchProfileBody: { type: "object", additionalProperties: true },
        RefreshIndicacoesBody: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
        },
        AdminPatchUserBody: {
          type: "object",
          properties: {
            is_admin: { type: "boolean" },
            is_blocked: { type: "boolean" },
          },
          description: "Pelo menos um campo obrigatório.",
        },
        AdminUpsertPlanBody: {
          type: "object",
          required: ["title", "unit_amount_cents"],
          properties: {
            title: { type: "string" },
            currency: { type: "string", default: "brl", example: "brl" },
            interval: { type: "string", default: "month", enum: ["month"] },
            unit_amount_cents: { type: "integer", minimum: 1 },
            active: { type: "boolean", default: true },
          },
        },
        AdminUpdatePropostaBody: {
          type: "object",
          properties: {
            status: { type: "string" },
            progresso: { type: "number" },
          },
        },
        AdminPatchEditalBody: { type: "object", additionalProperties: true },
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
          responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } } },
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
            "200": { description: "Cookie de sessão definido", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } },
            "400": { description: "Validação", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "401": { description: "Credenciais / Supabase", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/auth/sign-up": {
        post: {
          tags: ["Auth"],
          summary: "Cadastro (opcionalmente faz login em seguida)",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/SignUpBody" } } },
          },
          responses: {
            "200": { description: "Sucesso / login", content: { "application/json": { schema: { type: "object" } } } },
            "400": { description: "Erro Supabase / validação", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/auth/sign-out": {
        post: {
          tags: ["Auth"],
          summary: "Logout",
          security: [{ SessionCookie: [] }],
          responses: {
            "200": { description: "Cookie limpo", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } },
          },
        },
      },
      "/api/auth/me": {
        get: {
          tags: ["Auth"],
          summary: "Usuário da sessão",
          security: [{ SessionCookie: [] }],
          responses: {
            "200": {
              description: "user ou null",
              content: { "application/json": { schema: { type: "object", properties: { user: { type: "object", nullable: true } } } } },
            },
          },
        },
      },
      "/api/editais": {
        get: {
          tags: ["Editais"],
          summary: "Listar editais (público)",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
            { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "fonte", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "ativo", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "Lista paginada", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
      "/api/editais/{id}": {
        get: {
          tags: ["Editais"],
          summary: "Detalhe edital (público)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "404": { description: "Não encontrado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/propostas": {
        get: {
          tags: ["App"],
          summary: "Listar propostas do usuário",
          security: [{ SessionCookie: [] }],
          responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } } },
        },
        post: {
          tags: ["App"],
          summary: "Criar proposta",
          security: [{ SessionCookie: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreatePropostaBody" } } },
          },
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "400": { description: "Validação", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/propostas/{id}": {
        get: {
          tags: ["App"],
          summary: "Obter proposta",
          security: [{ SessionCookie: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "404": { description: "Não encontrado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
        patch: {
          tags: ["App"],
          summary: "Atualizar proposta",
          security: [{ SessionCookie: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/PatchPropostaBody" } } } },
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
        delete: {
          tags: ["App"],
          summary: "Remover proposta",
          security: [{ SessionCookie: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/indicacoes/refresh": {
        post: {
          tags: ["App"],
          summary: "Atualizar indicações",
          security: [{ SessionCookie: [] }],
          requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/RefreshIndicacoesBody" } } } },
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { refreshed: { type: "integer" } } } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/indicacoes": {
        get: {
          tags: ["App"],
          summary: "Listar indicações",
          security: [{ SessionCookie: [] }],
          parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 20 } }],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/profile": {
        get: {
          tags: ["App"],
          summary: "Perfil",
          security: [{ SessionCookie: [] }],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
        patch: {
          tags: ["App"],
          summary: "Atualizar perfil",
          security: [{ SessionCookie: [] }],
          requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/PatchProfileBody" } } } },
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/referrals/stats": {
        get: {
          tags: ["App"],
          summary: "Estatísticas de referral",
          security: [{ SessionCookie: [] }],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/stripe/create-checkout-session": {
        post: {
          tags: ["Stripe"],
          summary: "Stripe Checkout (plano)",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CheckoutBody" } } },
          },
          responses: {
            "200": { description: "URL do checkout", content: { "application/json": { schema: { type: "object", properties: { url: { type: "string" } } } } } },
            "401": { description: "Não autorizado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/stripe/create-portal-session": {
        post: {
          tags: ["Stripe"],
          summary: "Stripe Customer Portal",
          security: [{ BearerAuth: [] }],
          responses: {
            "200": { description: "URL do portal", content: { "application/json": { schema: { type: "object", properties: { url: { type: "string" } } } } } },
            "401": { description: "Não autorizado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/stripe/webhook": {
        post: {
          tags: ["Stripe"],
          summary: "Webhook Stripe (corpo bruto)",
          description:
            "O servidor usa `express.raw` nesta rota. Testes pelo Swagger normalmente enviam JSON; a assinatura Stripe pode falhar. Prefira `stripe trigger` ou o dashboard.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", description: "Evento Stripe (JSON bruto)" },
              },
            },
          },
          responses: { "200": { description: "Processado ou ignorado" }, "400": { description: "Erro de assinatura / payload" } },
        },
      },
      "/api/generate-field-text": {
        post: {
          tags: ["AI"],
          summary: "Gerar texto de campo (Ollama)",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/GenerateFieldTextBody" } } },
          },
          responses: {
            "200": { description: "Texto gerado", content: { "application/json": { schema: { type: "object" } } } },
            "400": { description: "Validação", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "500": { description: "Erro Ollama", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
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
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: { type: "object", properties: { improved_text: { type: "string" } } } } },
            },
            "400": { description: "Validação", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "500": { description: "Erro Ollama", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/admin/users": {
        get: {
          tags: ["Admin"],
          summary: "Listar usuários",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "perPage", in: "query", schema: { type: "integer", default: 50 } },
          ],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "403": { description: "Não admin", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/admin/users/{userId}": {
        patch: {
          tags: ["Admin"],
          summary: "Atualizar flags de usuário",
          security: [{ BearerAuth: [] }],
          parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/AdminPatchUserBody" } } },
          },
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "400": { description: "Validação", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "403": { description: "Não admin", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/admin/billing/plans": {
        get: {
          tags: ["Admin"],
          summary: "Listar planos de billing",
          security: [{ BearerAuth: [] }],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/admin/billing/plans/{planKey}": {
        put: {
          tags: ["Admin"],
          summary: "Criar/atualizar plano (Stripe + DB)",
          security: [{ BearerAuth: [] }],
          parameters: [{ name: "planKey", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/AdminUpsertPlanBody" } } },
          },
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "400": { description: "Validação", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "403": { description: "Não admin", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/admin/propostas": {
        get: {
          tags: ["Admin"],
          summary: "Listar propostas (admin)",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
            { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "userId", in: "query", schema: { type: "string" } },
            { name: "editalId", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "403": { description: "Não admin", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/admin/propostas/{id}": {
        patch: {
          tags: ["Admin"],
          summary: "Atualizar proposta (admin)",
          security: [{ BearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/AdminUpdatePropostaBody" } } } },
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "403": { description: "Não admin", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/admin/editais": {
        get: {
          tags: ["Admin"],
          summary: "Listar editais (admin)",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
            { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "fonte", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "ativo", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "403": { description: "Não admin", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/admin/editais/{id}": {
        patch: {
          tags: ["Admin"],
          summary: "Atualizar edital (admin)",
          security: [{ BearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/AdminPatchEditalBody" } } } },
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "403": { description: "Não admin", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/admin/redacoes": {
        get: {
          tags: ["Admin"],
          summary: "Listar redações (admin)",
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
            { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "userId", in: "query", schema: { type: "string" } },
            { name: "propostaId", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "403": { description: "Não admin", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
      "/api/admin/redacoes/{id}": {
        patch: {
          tags: ["Admin"],
          summary: "Atualizar status da redação",
          security: [{ BearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/AdminRedacaoStatusBody" } } },
          },
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Não autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
            "403": { description: "Não admin", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } } } },
          },
        },
      },
    },
  };
}
